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
      onMessage: createEvent()
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
    ...overrides
  });
  context.self = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      if (file === "i18n.js") vm.runInContext(i18nSource, context, { filename: "i18n.js" });
      else if (file === "lib.js") vm.runInContext(librarySource, context, { filename: "lib.js" });
      else throw new Error(`Unexpected import: ${file}`);
    }
  };
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  return context;
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

if (require.main === module) (async () => {
  const firstWorker = startWorker();
  await waitFor(() => shared.session.activeSession, "first worker did not start a session");
  assert.equal(shared.session.activeSession.host, "example.com");
  assert.equal(shared.session.activeSession.countVisit, true);
  assert.ok(shared.alarms["report-weekly"], "weekly report alarm was not scheduled");

  const send = (worker, message) => new Promise((resolve) => {
    worker.chrome.runtime.onMessage.listeners[0](message, {}, resolve);
  });
  const generated = await send(firstWorker, { type: "generate-report", reportType: "weekly" });
  assert.equal(generated.ok, true);
  const deviceId = generated.report.device.id;
  assert.match(deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(generated.report.device.name, `Time Lens ${deviceId.slice(0, 8)}`);
  await send(firstWorker, {
    type: "save-settings", settings: { deviceName: "  办公室电脑\n  " }
  });
  assert.equal(shared.local.settings.deviceName, "办公室电脑");
  const named = await send(firstWorker, { type: "generate-report", reportType: "monthly" });
  assert.equal(named.report.device.name, "办公室电脑");
  assert.equal(named.report.device.id, deviceId);
  assert.equal(shared.local.reports.find((report) => report.type === "weekly").device.name,
    generated.report.device.name, "renaming must preserve the identity snapshot in old reports");

  // Imported backup identity must not replace this browser's identity/name.
  await send(firstWorker, { type: "import-data", mode: "merge", payload: {
    deviceId: "another-device", settings: { deviceName: "家用笔记本" }, dailyStats: {}, reports: []
  } });
  assert.equal(shared.local.deviceId, deviceId);
  assert.equal(shared.local.settings.deviceName, "办公室电脑");
  shared.local.dailyStats = {};
  shared.session.activeSession.countVisit = true;

  // 模拟后台休眠：内存上下文消失，但 chrome.storage.session 保留。
  shared.session.activeSession.startedAt -= 125000;
  startWorker();
  const date = localDateKey();
  await waitFor(
    () => shared.local.dailyStats?.[date]?.["example.com"]?.durationMs >= 120000,
    "restarted worker did not settle the persisted session"
  );
  assert.equal(shared.local.dailyStats[date]["example.com"].visits, 1);
  assert.equal(shared.session.activeSession.countVisit, false, "worker restart must not add another visit");

  // 再休眠一次，确保时长继续累计且访问次数不会随唤醒增长。
  shared.session.activeSession.startedAt -= 65000;
  startWorker();
  await waitFor(
    () => shared.local.dailyStats?.[date]?.["example.com"]?.durationMs >= 185000,
    "second worker restart did not continue timing"
  );
  assert.equal(shared.local.dailyStats[date]["example.com"].visits, 1);
  assert.equal(shared.session.activeSession.countVisit, false);

  const restarted = startWorker();
  let emailPayload;
  restarted.fetch = async (url, options) => {
    if (url.startsWith("chrome-extension://")) return { ok: false };
    emailPayload = JSON.parse(options.body);
    return { ok: true, text: async () => "" };
  };
  await send(restarted, { type: "save-settings", settings: {
    deviceName: "家用笔记本",
    email: { enabled: true, endpoint: "https://gateway.example/report", recipient: "owner@example.com" }
  } });
  const emailed = await send(restarted, { type: "generate-report", reportType: "yearly", sendEmail: true });
  assert.equal(emailed.report.status, "queued");
  await waitFor(() => shared.local.reports.find((report) => report.id === emailed.report.id)?.status === "sent",
    "background email did not complete");
  assert.equal(emailPayload.report.device.id, deviceId, "ID must survive worker restarts and renames");
  assert.equal(emailPayload.report.device.name, "家用笔记本");
  assert.equal(named.report.device.name, "办公室电脑");

  // A fresh browser profile receives a different ID even with the same name.
  delete shared.local.deviceId;
  const other = await send(restarted, { type: "generate-report", reportType: "weekly" });
  assert.notEqual(other.report.device.id, deviceId);

  console.log("service-worker-lifecycle.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { shared, startWorker, waitFor };
