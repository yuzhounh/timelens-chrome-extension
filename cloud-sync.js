(function (root) {
  "use strict";
  const config = root.TimeLensFirebase;
  const core = root.TimeLensSyncCore;
  const database = `projects/${config.projectId}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${database}`;
  let runner = null;
  let login = null;
  let refresh = null;
  let renameQueue = Promise.resolve();
  let lock;
  let applySettings;
  const local = () => chrome.storage.local;
  const status = async (values) => {
    const { cloudStatus = {} } = await local().get("cloudStatus");
    await local().set({ cloudStatus: { ...cloudStatus, ...values, error: values.error || "" } });
  };
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } finally { clearTimeout(timeout); }
  }
  async function credentials() {
    const { cloudAuth } = await local().get("cloudAuth");
    if (!cloudAuth) throw new Error("cloudSignInRequired");
    if (cloudAuth.expiresAt > Date.now() + 60000) return cloudAuth;
    if (refresh) return refresh;
    refresh = (async () => {
      const body = await request(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cloudAuth.refreshToken }).toString()
      });
      const current = (await local().get("cloudAuth")).cloudAuth;
      if (current?.uid !== cloudAuth.uid) throw new Error("cloudAccountSignedOut");
      const next = { ...cloudAuth, idToken: body.id_token, refreshToken: body.refresh_token,
        expiresAt: Date.now() + Number(body.expires_in) * 1000 };
      await local().set({ cloudAuth: next });
      return next;
    })().finally(() => { refresh = null; });
    return refresh;
  }
  async function authorized(path, options = {}) {
    const auth = await credentials();
    return request(`${api}${path}`, {
      ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.idToken}` }
    });
  }
  const decode = (document) => JSON.parse(document.fields.payload.stringValue);
  const write = (path, value) => ({ update: { name: `${database}/${path}`,
    fields: { payload: { stringValue: typeof value === "string" ? value : JSON.stringify(value) } } } });
  async function get(path) {
    try { return await authorized(`/${path}`); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function list(path) {
    const result = [];
    let pageToken = "";
    do {
      const page = await authorized(`/${path}?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`);
      result.push(...(page.documents || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return result;
  }
  const commit = (writes) => authorized(":commit", { method: "POST", body: JSON.stringify({ writes }) });
  async function hash(value) {
    const data = new TextEncoder().encode(JSON.stringify(value));
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }
  async function parts(path, value) {
    const digest = await hash(value);
    const strings = core.chunks(value);
    return { hash: digest, count: strings.length, writes: strings.map((text, index) =>
      write(`${path}-${digest}-${index}`, text)) };
  }
  async function readParts(path, spec) {
    const strings = [];
    for (let index = 0; index < spec.count; index++) {
      const doc = await get(`${path}-${spec.hash}-${index}`);
      if (!doc) throw new Error("cloudDataIncomplete");
      strings.push(doc.fields.payload.stringValue);
    }
    const value = JSON.parse(strings.join(""));
    if (await hash(value) !== spec.hash) throw new Error("cloudDataInvalid");
    return value;
  }
  function refs(manifest = {}) {
    const result = [];
    for (const [date, spec] of Object.entries(manifest.days || {})) {
      for (let i = 0; i < spec.count; i++) result.push(`day-${date}-${spec.hash}-${i}`);
    }
    if (manifest.reports) for (let i = 0; i < manifest.reports.count; i++) {
      result.push(`reports-${manifest.reports.hash}-${i}`);
    }
    return result;
  }
  async function synchronize() {
    const auth = await credentials();
    // Existing sessions acquire their profile without another Google sign-in or
    // any change to the hosted login helper. Only public profile fields are saved.
    if (!auth.profileCheckedAt || !auth.avatarDataUrl || Date.now() - auth.profileCheckedAt > 86400000) {
      try {
        // This is display metadata only; Firestore still validates the ID token.
        // Google profile claims also work when the optional lookup API fails.
        let user = { displayName: auth.displayName || "", photoUrl: auth.photoURL || "" };
        try {
          const payload = auth.idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))));
          if (claims.sub === auth.uid) user = { displayName: claims.name || user.displayName, photoUrl: claims.picture || user.photoUrl };
        } catch { /* Older sessions may not contain public profile claims. */ }
        try {
          const profile = await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${config.apiKey}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: auth.idToken })
          });
          const found = profile.users?.find((entry) => entry.localId === auth.uid);
          if (found) user = { ...user, ...found, displayName: found.displayName || user.displayName, photoUrl: found.photoUrl || user.photoUrl };
        } catch { /* Retain the authenticated Google profile instead of skipping its avatar. */ }
        const google = user?.providerUserInfo?.find((provider) => provider.providerId === "google.com");
        const photoURL = user?.photoUrl || google?.photoUrl || "";
        let avatarDataUrl = "";
        try {
          const photo = new URL(photoURL);
          if (photo.protocol === "https:" && photo.hostname.endsWith(".googleusercontent.com")) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
              const image = await fetch(photo.href, { signal: controller.signal, referrerPolicy: "no-referrer", cache: "force-cache" });
              const type = image.headers.get("content-type")?.split(";")[0];
              if (image.ok && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) {
                const bytes = new Uint8Array(await image.arrayBuffer());
                if (bytes.length && bytes.length <= 524288) {
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                  avatarDataUrl = `data:${type};base64,${btoa(binary)}`;
                }
              }
            } finally { clearTimeout(timeout); }
          }
        } catch { /* The Google URL remains available if an offline image fetch fails. */ }
        if (user) await lock(async () => {
          const current = (await local().get("cloudAuth")).cloudAuth;
          if (current?.uid === auth.uid) await local().set({ cloudAuth: { ...current,
            displayName: user.displayName || google?.displayName || "", photoURL,
            avatarDataUrl: avatarDataUrl || (current.photoURL === photoURL ? current.avatarDataUrl || "" : ""),
            profileCheckedAt: Date.now() } });
        });
      } catch { /* An unavailable avatar must not interrupt data synchronization. */ }
    }
    const snapshot = await lock(async () => {
      const stored = await local().get(["deviceId", "reports", "settings", "cloudOwnerUid",
        "cloudCache", "cloudSettingsPending", "deviceNamePending"]);
      if (stored.cloudOwnerUid && stored.cloudOwnerUid !== auth.uid) throw new Error("cloudWrongAccount");
      const deviceId = stored.deviceId || crypto.randomUUID();
      await local().set({ deviceId, cloudOwnerUid: auth.uid });
      return { ...stored, deviceId };
    });
    await status({ state: "syncing", email: auth.email });
    const user = `users/${auth.uid}`;
    const devicePath = `${user}/devices/${snapshot.deviceId}`;
    const previousDoc = await get(devicePath);
    const previous = previousDoc ? decode(previousDoc) : {};
    const statistics = await lock(() => root.TimeLensStats.changedSnapshot(previous.days));
    const aliasPath = `${devicePath}/chunks/device-name`;
    let alias = await get(aliasPath);
    if (snapshot.deviceNamePending) {
      await commit([write(aliasPath, { name: cleanName(snapshot.settings?.deviceName) })]);
      alias = { fields: { payload: { stringValue: JSON.stringify({ name: cleanName(snapshot.settings?.deviceName) }) } } };
      await lock(async () => {
        const current = await local().get("settings");
        if (current.settings?.deviceName === snapshot.settings?.deviceName) await local().set({ deviceNamePending: false });
      });
    }
    const ownName = alias ? decode(alias).name : snapshot.settings?.deviceName || previous.name || "";
    await lock(async () => {
      const current = await local().get(["settings", "deviceNamePending"]);
      if (!current.deviceNamePending && alias && current.settings?.deviceName !== ownName) {
        await local().set({ settings: { ...current.settings, deviceName: ownName } });
      }
    });
    const manifest = { name: ownName || `Time Lens ${snapshot.deviceId.slice(0, 8)}`, days: {} };
    const writes = [];
    for (const [date, spec] of Object.entries(statistics.index.days)) {
      manifest.days[date] = spec;
      if (statistics.dailyStats[date]) {
        const part = await parts(`${devicePath}/chunks/day-${date}`, statistics.dailyStats[date]);
        if (part.hash !== spec.hash || part.count !== spec.count) throw new Error("cloudDataInvalid");
        writes.push(...part.writes);
      }
    }
    const reports = await parts(`${devicePath}/chunks/reports`, core.archiveReports(snapshot.reports));
    manifest.reports = { hash: reports.hash, count: reports.count };
    if (previous.reports?.hash !== reports.hash) writes.push(...reports.writes);
    manifest.revision = await hash(manifest);
    if (manifest.revision !== previous.revision) {
      // Content-addressed chunks keep the old manifest readable during partial uploads.
      for (let i = 0; i < writes.length; i += 100) await commit(writes.slice(i, i + 100));
      await commit([write(devicePath, manifest)]);
      const keep = new Set(refs(manifest));
      const obsolete = refs(previous).filter((name) => !keep.has(name)).map((name) =>
        ({ delete: `${database}/${devicePath}/chunks/${name}` }));
      for (let i = 0; i < obsolete.length; i += 100) await commit(obsolete.slice(i, i + 100));
    }
    const sharedPath = `${user}/config/shared`;
    const shared = await get(sharedPath);
    const ownSettings = core.sharedSettings(snapshot.settings);
    if (!shared || snapshot.cloudSettingsPending) {
      await commit([write(sharedPath, ownSettings)]);
      await lock(async () => {
        const current = await local().get("settings");
        if (await hash(core.sharedSettings(current.settings)) === await hash(ownSettings)) {
          await local().set({ cloudSettingsPending: false });
        }
      });
    } else {
      await lock(async () => {
        const current = await local().get(["settings", "cloudSettingsPending"]);
        if (current.cloudSettingsPending) return;
        const incoming = decode(shared);
        const { email, schedules, deviceName, ...sharedSettings } = incoming;
        const settings = { ...current.settings, ...sharedSettings, deviceName: current.settings?.deviceName || "" };
        if (await hash(settings) !== await hash(current.settings)) await applySettings(settings);
      });
    }
    const devices = await list(`${user}/devices`);
    const cache = {};
    const registry = [];
    for (const doc of devices) {
      const id = doc.name.split("/").pop();
      const next = decode(doc);
      const nameDoc = id === snapshot.deviceId ? alias : await get(`${user}/devices/${id}/chunks/device-name`);
      const name = nameDoc ? decode(nameDoc).name || `Time Lens ${id.slice(0, 8)}` : next.name;
      registry.push({ id, name, isLocal: id === snapshot.deviceId });
      if (id === snapshot.deviceId) continue;
      const old = snapshot.cloudCache?.[id];
      if (old?.revision === next.revision) { cache[id] = { ...old, name }; continue; }
      const dailyStats = {};
      for (const [date, spec] of Object.entries(next.days)) {
        dailyStats[date] = old?.manifest?.days?.[date]?.hash === spec.hash
          ? old.dailyStats[date] : await readParts(`${user}/devices/${id}/chunks/day-${date}`, spec);
      }
      const deviceReports = old?.manifest?.reports?.hash === next.reports.hash
        ? old.reports : await readParts(`${user}/devices/${id}/chunks/reports`, next.reports);
      cache[id] = { name, revision: next.revision, manifest: next, dailyStats, reports: deviceReports };
    }
    await lock(async () => {
      const current = (await local().get("cloudAuth")).cloudAuth;
      if (current?.uid !== auth.uid) return;
      await local().set({ cloudCache: cache, cloudDevices: registry, cloudStatus: {
        state: "synced", email: auth.email, lastSyncAt: Date.now(), devices: devices.length
      } });
    });
    return { ok: true };
  }
  function kick() {
    if (runner) return runner;
    runner = (async () => {
      if (!(await local().get("cloudAuth")).cloudAuth) return { ok: true };
      try { return await synchronize(); }
      catch (error) {
        const stored = await local().get(["cloudAuth", "cloudStatus"]);
        await status({ ...stored.cloudStatus, state: "error", email: stored.cloudAuth?.email, error: error.message });
        return { ok: false, error: error.message };
      }
    })().finally(() => { runner = null; });
    return runner;
  }
  function cleanName(value) {
    return String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 80);
  }
  function renameDevice(deviceId, value) {
    const task = async () => {
      if (runner) await runner;
      const auth = await credentials();
      const stored = await local().get(["deviceId", "cloudOwnerUid"]);
      if (stored.cloudOwnerUid !== auth.uid) throw new Error("cloudWrongAccount");
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId)) throw new Error("cloudDeviceMissing");
      const path = `users/${auth.uid}/devices/${deviceId}`;
      if (!await get(path)) throw new Error("cloudDeviceMissing");
      const name = cleanName(value);
      // Name metadata has its own document: tracking uploads cannot overwrite a
      // rename from another computer. Existing account-isolation rules apply.
      await commit([write(`${path}/chunks/device-name`, { name })]);
      await lock(async () => {
        const current = await local().get(["cloudAuth", "cloudCache", "cloudDevices", "settings"]);
        if (current.cloudAuth?.uid !== auth.uid) return;
        const displayName = name || `Time Lens ${deviceId.slice(0, 8)}`;
        const cache = current.cloudCache || {};
        if (cache[deviceId]) cache[deviceId] = { ...cache[deviceId], name: displayName };
        const update = { cloudCache: cache, cloudDevices: (current.cloudDevices || []).map((device) =>
          device.id === deviceId ? { ...device, name: displayName } : device) };
        if (deviceId === stored.deviceId) {
          update.settings = { ...current.settings, deviceName: name };
          update.deviceNamePending = false;
        }
        await local().set(update);
      });
      return { ok: true };
    };
    renameQueue = renameQueue.then(task, task);
    return renameQueue;
  }
  async function signIn() {
    if (login) throw new Error("cloudLoginOpen");
    // No network/login task runs inside the tracking storage queue.
    const result = new Promise((resolve, reject) => {
      login = { resolve, reject, nonce: crypto.randomUUID() };
      login.timeout = setTimeout(() => login?.reject(new Error("cloudLoginTimeout")), 180000);
    });
    try {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
      await chrome.offscreen.createDocument({ url: `offscreen.html?nonce=${login.nonce}`,
        reasons: ["IFRAME_SCRIPTING"], justification: "Sign in to Google through the Firebase authentication page" });
      const credentials = await result;
      const { cloudOwnerUid } = await local().get("cloudOwnerUid");
      if (cloudOwnerUid && cloudOwnerUid !== credentials.uid) throw new Error("cloudWrongAccount");
      await local().set({ cloudAuth: credentials });
      return await kick();
    } finally {
      clearTimeout(login?.timeout);
      login = null;
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    }
  }
  async function signOut() {
    if (login) throw new Error("cloudLoginPending");
    // Wait for an already authorized sync to finish before removing its credentials.
    if (runner) await runner;
    await local().remove("cloudAuth");
    await status({ state: "signed-out" });
    // Keep cached records available offline; never re-upload them as this device's data.
    return { ok: true };
  }
  function authResult(message, sender) {
    if (sender.url?.split("?")[0] !== chrome.runtime.getURL("offscreen.html") || !login
      || message.nonce !== login.nonce) return;
    if (message.error) login.reject(new Error(message.error));
    else if (message.auth?.uid && message.auth?.idToken && message.auth?.refreshToken) login.resolve(message.auth);
  }
  root.TimeLensCloud = {
    configure(options) { lock = options.lock; applySettings = options.applySettings; },
    kick, signIn, signOut, authResult, renameDevice
  };
})(self);
