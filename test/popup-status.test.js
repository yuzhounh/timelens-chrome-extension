const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const elements = new Map();
  const listeners = {};
  const intervals = new Map();
  const messages = [];
  let focused = true;
  let connections = 0;
  let port;
  let response = { ok: true, summary: { totalMs: 1000, sites: [] }, activeHost: "example.com", trackingStatus: "tracking" };
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "", style: {}, addEventListener() {} });
    return elements.get(id);
  };
  const event = () => ({ callbacks: [], addListener(fn) { this.callbacks.push(fn); } });
  const context = vm.createContext({
    console,
    document: { getElementById: node, hasFocus: () => focused },
    window: { addEventListener(name, fn) { listeners[name] = fn; } },
    setInterval(fn, ms) { intervals.set(1, { fn, ms }); return 1; },
    clearInterval(id) { intervals.delete(id); },
    chrome: {
      tabs: { create() {} },
      windows: { getCurrent: async () => ({ id: 7 }) },
      storage: { local: { get: async () => ({ settings: { uiLocale: "en" } }) } },
      runtime: {
        connect({ name }) {
          assert.equal(name, "tracking-popup");
          connections++;
          port = { onDisconnect: event(), postMessage(message) { messages.push(message); },
            disconnect() { for (const fn of this.onDisconnect.callbacks) fn(); } };
          return port;
        },
        sendMessage(message, callback) { assert.equal(message.type, "get-summary"); callback(response); }
      }
    },
    TimeLensCore: { formatDuration: (ms) => `${ms}ms` },
    TimeLensI18n: { init: async () => {}, apply() {}, isEnglish: () => true, t: (key, value) => `${key}${value ? ':' + value : ''}` }
  });
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  assert.equal(node("activeSite").textContent, "popupTracking:example.com");
  assert.equal(messages[0].windowId, 7);
  assert.equal(messages[0].focused, true);
  assert.equal(intervals.get(1).ms, 5000);

  const keys = { idle: "popupPausedIdle", inactive: "popupPausedInactive", unsupported: "popupUnsupported", excluded: "popupExcluded" };
  for (const [status, key] of Object.entries(keys)) {
    response = { ...response, activeHost: "", trackingStatus: status };
    intervals.get(1).fn();
    await settle();
    assert.equal(node("activeSite").textContent, key, `reason ${status} must update without reopening`);
  }
  focused = false;
  listeners.blur();
  assert.equal(messages.at(-1).focused, false);
  focused = true;
  response = { ...response, activeHost: "example.com", trackingStatus: "tracking", summary: { totalMs: 65000, sites: [] } };
  listeners.focus();
  await settle();
  assert.equal(node("activeSite").textContent, "popupTracking:example.com");
  assert.equal(node("todayTotal").textContent, "65000ms");
  port.disconnect();
  intervals.get(1).fn();
  await settle();
  assert.equal(connections, 2, "popup must reconnect after worker disconnection");
  listeners.pagehide();
  assert.equal(intervals.size, 0, "closed popup must stop polling");
  for (const locale of ["en", "zh_CN"]) {
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, "../_locales", locale, "messages.json"), "utf8"));
    for (const key of Object.values(keys)) assert.ok(table[key]?.message);
  }
  console.log("popup-status.test.js: live reasons, focus updates, reconnect and cleanup passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
