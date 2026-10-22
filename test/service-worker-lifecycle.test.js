const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "background.js"), "utf8");
const i18nSource = fs.readFileSync(path.join(projectRoot, "i18n.js"), "utf8");
const librarySource = fs.readFileSync(path.join(projectRoot, "lib.js"), "utf8");

const shared = {
  local: {},
  session: {},
  alarms: {},
  activeTab: {
    id: 7,
    active: true,
    title: "Example page",
    url: "https://example.com/article"
  }
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createEvent() {
  return {
    listeners: [],
    addListener(listener) { this.listeners.push(listener); }
  };
}

function createStorageArea(store) {
  return {
    async get(keys) {
      if (keys == null) return clone(store);
      if (typeof keys === "string") return { [keys]: clone(store[keys]) };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, clone(store[key])]));
      }
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
        key,
        store[key] === undefined ? fallback : clone(store[key])
      ]));
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) store[key] = clone(value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    }
  };
}

function createChromeMock() {
  return {
    storage: {
      local: createStorageArea(shared.local),
      session: createStorageArea(shared.session)
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: async () => ({ id: 1, focused: true }),
      onFocusChanged: createEvent()
    },
    idle: {
      queryState: async () => "active",
      setDetectionInterval() {},
      onStateChanged: createEvent()
    },
    tabs: {
      query: async () => [clone(shared.activeTab)],
      create: async () => ({}),
      onActivated: createEvent(),
      onUpdated: createEvent(),
      onRemoved: createEvent()
    },
    alarms: {
      get: async (name) => clone(shared.alarms[name]),
      create: async (name, info) => { shared.alarms[name] = { name, ...clone(info) }; },
      clear: async (name) => Boolean(delete shared.alarms[name]),
      onAlarm: createEvent()
    },
    runtime: {
      getURL: (value) => `chrome-extension://test/${value}`,
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent(),
      onConnect: createEvent()
    },
    i18n: {
      getUILanguage: () => "zh-CN",
      getMessage: () => ""
    },
    commands: { onCommand: createEvent() }
  };
}

function startWorker(overrides = {}) {
  const context = vm.createContext({
    chrome: createChromeMock(),
    crypto,
    AbortController,
    console,
    URL,
    setTimeout,
    clearTimeout,
    TextEncoder,
    ...overrides
  });
  context.self = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      if (file === "i18n.js") vm.runInContext(i18nSource, context, { filename: "i18n.js" });
      else if (file === "lib.js") vm.runInContext(librarySource, context, { filename: "lib.js" });
      else if (["firebase-config.js", "sync-core.js", "stats-store.js", "cloud-sync.js"].includes(file)) {
        vm.runInContext(fs.readFileSync(path.join(projectRoot, file), "utf8"), context, { filename: file });
      } else throw new Error(`Unexpected import: ${file}`);
    }
  };
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  return context;
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

if (require.main === module) (async () => {
  shared.alarms["report-weekly"] = { name: "report-weekly" };
  shared.local.reports = [{ id: "legacy-report", status: "queued", emailJob: { id: "retired" } }];
  const firstWorker = startWorker();
  await waitFor(() => shared.session.activeSession, "first worker did not start a session");
  assert.equal(shared.session.activeSession.host, "example.com");
  assert.equal(shared.session.activeSession.countVisit, true);
  assert.ok(!shared.alarms["report-weekly"], "old report alarms must be retired");
  assert.ok(shared.alarms["cloud-sync"], "cloud synchronization must remain scheduled");

  const send = (worker, message) => new Promise((resolve) => {
    worker.chrome.runtime.onMessage.listeners[0](message, {}, resolve);
  });
  const deviceId = shared.local.deviceId;
  assert.match(deviceId, /^[0-9a-f-]{36}$/);
  const archived = JSON.stringify(shared.local.reports);
  await send(firstWorker, { type: "save-settings", settings: { deviceName: "  办公室电脑\n  " } });
  assert.equal(shared.local.settings.deviceName, "办公室电脑");
  assert.equal((await send(firstWorker, { type: "generate-report", reportType: "weekly" })).ok, false);
  assert.equal(JSON.stringify(shared.local.reports), archived, "retiring reports must preserve old archives");

  // Imported backup identity must not replace this browser's identity/name.
  await send(firstWorker, { type: "import-data", mode: "merge", payload: {
    deviceId: "another-device", settings: { deviceName: "家用笔记本" }, dailyStats: {}, reports: []
  } });
  assert.equal(shared.local.deviceId, deviceId);
  assert.equal(shared.local.settings.deviceName, "办公室电脑");
  await firstWorker.TimeLensStats.replaceAll({});
  shared.session.activeSession.countVisit = true;

  // 模拟后台休眠：内存上下文消失，但 chrome.storage.session 保留。
  shared.session.activeSession.startedAt -= 125000;
  startWorker();
  const date = localDateKey();
  await waitFor(
    async () => (await firstWorker.TimeLensStats.read())[date]?.["example.com"]?.durationMs >= 120000,
    "restarted worker did not settle the persisted session"
  );
  assert.equal((await firstWorker.TimeLensStats.read())[date]["example.com"].visits, 1);
  assert.equal(shared.session.activeSession.countVisit, false, "worker restart must not add another visit");

  // 再休眠一次，确保时长继续累计且访问次数不会随唤醒增长。
  shared.session.activeSession.startedAt -= 65000;
  startWorker();
  await waitFor(
    async () => (await firstWorker.TimeLensStats.read())[date]?.["example.com"]?.durationMs >= 185000,
    "second worker restart did not continue timing"
  );
  assert.equal((await firstWorker.TimeLensStats.read())[date]["example.com"].visits, 1);
  assert.equal(shared.session.activeSession.countVisit, false);

  const restarted = startWorker();
  let requests = 0;
  restarted.fetch = async (url) => {
    if (url === "https://gateway.example/report") { requests++; throw Error("Legacy email must not be sent"); }
    return { ok: false }; // Locale resource loads are unrelated to retired email jobs.
  };
  await send(restarted, { type: "save-settings", settings: {
    deviceName: "家用笔记本", email: { enabled: true, endpoint: "https://gateway.example/report", recipient: "owner@example.com" }
  } });
  restarted.chrome.alarms.onAlarm.listeners[0]({ name: "report-weekly" });
  await send(restarted, { type: "get-summary" });
  assert.equal(requests, 0, "old enabled settings and queued jobs must never send email");
  assert.equal(shared.local.deviceId, deviceId, "identity must survive worker restarts and renames");
  assert.equal(JSON.stringify(shared.local.reports), archived);

  console.log("service-worker-lifecycle.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { shared, startWorker, waitFor };
