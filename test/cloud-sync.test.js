const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;
const docs = new Map();
let offline = false;
let profileUnavailable = false;
let commits = 0;
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const record = (durationMs) => ({ durationMs, visits: 1, title: "Example", url: "https://example.com/" });
function device(deviceId, durationMs, roundTrip = clone) {
  const store = { deviceId, dailyStats: { "2026-10-19": { "example.com": record(durationMs) } }, reports: [],
    settings: { deviceName: deviceId, idleThresholdSeconds: 60, email: { token: `secret-${deviceId}`, enabled: false } },
    cloudAuth: { uid: "same-user", email: "user@example.com", idToken: "same-user", refreshToken: "refresh", expiresAt: Date.now() + 3600000 } };
  const storage = {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, roundTrip(store[key])])); },
    async set(values) { Object.assign(store, clone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  };
  const context = vm.createContext({ crypto, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URLSearchParams, URL, btoa, atob,
    AbortController, chrome: { storage: { local: storage } }, fetch: async (url, options = {}) => {
      if (offline) throw Error("offline");
      const parsed = new URL(url);
      if (parsed.hostname === "lh3.googleusercontent.com") return {
        ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer
      };
      const prefix = "/v1/";
      const name = decodeURIComponent(parsed.pathname.slice(prefix.length));
      const token = options.headers.Authorization?.replace("Bearer ", "") || "";
      const uid = token.includes(".") ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub : token;
      const result = (body, status = 200) => ({ ok: status < 400, status, json: async () => clone(body) });
      if (parsed.hostname === "identitytoolkit.googleapis.com" && profileUnavailable) return result({ error: { message: "lookup unavailable" } }, 403);
      if (parsed.hostname === "identitytoolkit.googleapis.com") return result({ users: [{
        localId: "same-user", displayName: "Test User", photoUrl: "https://lh3.googleusercontent.com/test-avatar"
      }] });
      if (name.endsWith(":commit")) {
        commits++;
        for (const write of JSON.parse(options.body).writes) {
          const target = write.update?.name || write.delete;
          if (!target.includes(`/users/${uid}/`)) return result({ error: { message: "PERMISSION_DENIED" } }, 403);
          if (write.delete) docs.delete(write.delete);
          else docs.set(write.update.name, clone(write.update));
        }
        return result({});
      }
      if (!name.includes(`/users/${uid}/`)) return result({ error: { message: "PERMISSION_DENIED" } }, 403);
      if (parsed.searchParams.has("pageSize")) {
        const matches = [...docs.values()].filter((doc) => doc.name.startsWith(name + "/")
          && !doc.name.slice(name.length + 1).includes("/"));
        return result({ documents: matches });
      }
      return docs.has(name) ? result(docs.get(name)) : result({ error: { message: "NOT_FOUND" } }, 404);
    } });
  context.self = context;
  for (const file of ["lib.js", "firebase-config.js", "sync-core.js", "stats-store.js", "cloud-sync.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  }
  context.TimeLensCloud.configure({ lock: (task) => task(), applySettings: (settings) => storage.set({ settings }) });
  return { store, cloud: context.TimeLensCloud, core: context.TimeLensSyncCore, stats: context.TimeLensStats };
}
(async () => {
  const home = device("home", 1000, ordered);
  const office = device("office", 2000);
  assert.equal((await home.cloud.kick()).ok, true);
  assert.equal(home.store.cloudAuth.displayName, "Test User");
  assert.equal(home.store.cloudAuth.photoURL, "https://lh3.googleusercontent.com/test-avatar");
  assert.equal(home.store.cloudAuth.avatarDataUrl, "data:image/png;base64,iVBORw==", "cache the Google image locally");
  profileUnavailable = true;
  home.store.cloudAuth.idToken = `header.${Buffer.from(JSON.stringify({ sub: "same-user", name: "谷歌用户", picture: "https://lh3.googleusercontent.com/token-avatar" })).toString("base64url")}.signature`;
  delete home.store.cloudAuth.avatarDataUrl;
  assert.equal((await home.cloud.kick()).ok, true);
  assert.equal(home.store.cloudAuth.displayName, "谷歌用户", "retain UTF-8 Google profile claims when lookup fails");
  assert.equal(home.store.cloudAuth.photoURL, "https://lh3.googleusercontent.com/token-avatar");
  assert.equal(home.store.cloudAuth.avatarDataUrl, "data:image/png;base64,iVBORw==");
  profileUnavailable = false;
  assert.equal((await office.cloud.kick()).ok, true);
  await home.cloud.kick();
  const total = async (d) => d.core.stats(await d.stats.read(), d.store.cloudCache)["2026-10-19"]["example.com"].durationMs;
  assert.equal(await total(home), 3000);
  assert.equal(await total(office), 3000);
  const before = commits;
  await home.cloud.kick(); await office.cloud.kick();
  assert.equal(commits, before, "unchanged sync must not rewrite data");
  assert.equal(await total(home), 3000, "repeated sync must not add the same device twice");
  assert.equal((await home.stats.read())["2026-10-19"]["example.com"].durationMs, 1000, "remote stats never enter own source");
  assert.equal(home.store.settings.email.token, "secret-home");
  assert.equal(office.store.settings.email.token, "secret-office");
  assert.ok(!JSON.stringify([...docs.values()]).includes("secret-home"), "gateway tokens must not reach Firestore");
  home.store.settings.idleThresholdSeconds = 120;
  home.store.cloudSettingsPending = true;
  await home.cloud.kick(); await office.cloud.kick();
  assert.equal(office.store.settings.idleThresholdSeconds, 120);
  assert.equal(office.store.settings.deviceName, "office");
  assert.equal(home.core.stats(await home.stats.read(), home.store.cloudCache, "office")["2026-10-19"]["example.com"].durationMs, 2000,
    "selecting a device shows only that device's records");
  const originalOfficeId = office.store.deviceId;
  await home.cloud.renameDevice("office", "Office renamed from home");
  assert.equal(home.store.cloudCache.office.name, "Office renamed from home");
  await office.cloud.kick(); await home.cloud.kick();
  assert.equal(office.store.deviceId, originalOfficeId, "renaming must never alter the device ID");
  assert.equal(office.store.settings.deviceName, "Office renamed from home");
  assert.equal(home.store.cloudDevices.find((device) => device.id === "office").name, "Office renamed from home");
  const renamedStats = await office.stats.read();
  renamedStats["2026-10-19"]["example.com"].title = "Continued tracking";
  await office.stats.writeDays(renamedStats);
  await office.cloud.kick(); await home.cloud.kick();
  assert.equal(home.store.cloudCache.office.name, "Office renamed from home", "tracking uploads must not undo another device's rename");
  office.store.settings.deviceName = "Office renamed locally";
  office.store.deviceNamePending = true;
  await office.cloud.kick(); await home.cloud.kick();
  assert.equal(home.store.cloudCache.office.name, "Office renamed locally");
  assert.equal(await total(home), 3000, "renaming must not change or duplicate recorded durations");
  home.store.reports = [{ id: "weekly-1", status: "queued", emailJob: { id: "never-send" }, generatedAt: "2026-10-19" }];
  await home.cloud.kick(); await office.cloud.kick();
  const remoteReports = office.core.reports([], office.store.cloudCache);
  assert.equal(remoteReports[0].cloudReadOnly, true);
  assert.equal(remoteReports[0].emailJob, undefined);
  assert.equal(remoteReports[0].status, "not-requested");
  await home.stats.replaceAll({}); home.store.reports = [];
  await home.cloud.kick(); await office.cloud.kick();
  assert.equal(await total(office), 2000, "deleting home records propagates without deleting office records");
  assert.equal(office.core.reports([], office.store.cloudCache).length, 0);
  offline = true;
  const offlineStats = await office.stats.read();
  offlineStats["2026-10-19"]["example.com"].durationMs = 2500;
  await office.stats.writeDays(offlineStats);
  assert.equal((await office.cloud.kick()).ok, false);
  assert.equal(office.store.cloudStatus.state, "error");
  offline = false;
  assert.equal((await office.cloud.kick()).ok, true);
  await home.cloud.kick();
  assert.equal(await total(home), 2500, "offline writes recover on the next sync");
  const hourly = Array(24).fill(0); hourly[9] = 200;
  const hourlyStats = await office.stats.read();
  hourlyStats["2026-10-19"]["example.com"].hourlyMs = hourly;
  await office.stats.writeDays(hourlyStats);
  await office.cloud.kick(); await home.cloud.kick();
  assert.deepEqual(Array.from(home.store.cloudCache.office.dailyStats["2026-10-19"]["example.com"].hourlyMs), hourly,
    "hourly detail must survive a cloud upload and another device's download");
  assert.equal(await total(home), 2500, "adding hourly detail must not change daily totals");
  office.store.cloudAuth.uid = "different-user";
  assert.equal((await office.cloud.kick()).ok, false, "do not upload a previous account's data to another account");
  const text = "😀".repeat(150005);
  const chunks = home.core.chunks({ text });
  assert.equal(JSON.parse(chunks.join("")).text, text);
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk)));
  console.log("cloud-sync.test.js: multi-device, idempotence, deletion, settings, credentials, offline recovery and account isolation passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
