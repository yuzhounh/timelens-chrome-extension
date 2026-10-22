const assert = require("node:assert/strict");
const { shared, startWorker, waitFor } = require("./service-worker-lifecycle.test.js");

let now = new Date(2026, 9, 18, 12).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
function event() {
  return { listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(...args) {
    for (const fn of this.listeners) fn(...args);
  } };
}
function popup(worker, windowId = 1, url = "popup.html") {
  const port = { name: "tracking-popup", sender: { url: worker.chrome.runtime.getURL(url) },
    onMessage: event(), onDisconnect: event() };
  worker.chrome.runtime.onConnect.listeners[0](port);
  port.update = (focused) => port.onMessage.fire({ type: "popup-state", windowId, focused });
  return port;
}
async function summary(worker) {
  return new Promise((resolve) => worker.chrome.runtime.onMessage.listeners[0]({ type: "get-summary" }, {}, resolve));
}

(async () => {
  const worker = startWorker({ Date: Clock });
  await waitFor(() => shared.session.activeSession, "tracking did not start");
  const date = worker.TimeLensCore.dateKey(new Clock());
  await worker.TimeLensStats.writeDays({ "2020-01-01": {
    "archive.example": { durationMs: 123456, visits: 7, title: "Archive", url: "https://archive.example" }
  } });
  shared.local.reports = [{ id: "preserved-report", status: "not-requested" }];
  const preserved = JSON.stringify({ settings: shared.local.settings, reports: shared.local.reports,
    archive: (await worker.TimeLensStats.read())["2020-01-01"] });
  let focused = true;
  let idle = "active";
  worker.chrome.windows.getLastFocused = async () => ({ id: 1, focused });
  worker.chrome.idle.queryState = async () => idle;
  const record = async () => (await worker.TimeLensStats.read())[date]["example.com"];

  now += 10000;
  assert.equal((await summary(worker)).activeHost, "example.com");
  const initialVisits = (await record()).visits;
  focused = false;
  worker.chrome.windows.onFocusChanged.listeners[0](-1);
  const port = popup(worker);
  port.update(true);
  now += 5000;
  let result = await summary(worker);
  assert.equal(result.trackingStatus, "tracking", "opening our focused popup must keep tracking");
  assert.equal(result.activeHost, "example.com");
  await new Promise(resolve => setTimeout(resolve, 180));
  result = await summary(worker);
  assert.equal(result.trackingStatus, "tracking", "delayed window-focus event must respect popup");
  assert.equal((await record()).visits, initialVisits, "popup must not create another visit");

  focused = true;
  port.onDisconnect.fire();
  now += 5000;
  assert.equal((await summary(worker)).trackingStatus, "tracking");
  assert.equal((await record()).visits, initialVisits, "closing popup must continue the same visit");

  focused = false;
  const blurred = popup(worker);
  blurred.update(false);
  result = await summary(worker);
  assert.equal(result.trackingStatus, "inactive");
  const pausedDuration = (await record()).durationMs;
  now += 60000;
  assert.equal((await summary(worker)).activeHost, "");
  assert.equal((await record()).durationMs, pausedDuration, "time in another app must not be counted");
  blurred.onDisconnect.fire();

  // A popup in another window or another extension page must not override focus.
  for (const candidate of [popup(worker, 2), popup(worker, 1, "dashboard.html")]) {
    candidate.update(true);
    assert.equal((await summary(worker)).trackingStatus, "inactive");
    candidate.onDisconnect.fire();
  }

  const active = popup(worker);
  active.update(true);
  assert.equal((await summary(worker)).trackingStatus, "tracking");
  idle = "idle";
  assert.equal((await summary(worker)).trackingStatus, "idle", "popup cannot bypass idle pause");
  const idleDuration = (await record()).durationMs;
  now += 60000;
  assert.equal((await summary(worker)).trackingStatus, "idle");
  assert.equal((await record()).durationMs, idleDuration);
  idle = "locked";
  assert.equal((await summary(worker)).trackingStatus, "idle");
  idle = "active";
  active.update(true);
  assert.equal((await summary(worker)).trackingStatus, "tracking");
  now += 16000;
  assert.equal((await summary(worker)).trackingStatus, "inactive", "stale popup cannot keep tracking alive");
  active.onDisconnect.fire();

  focused = true;
  const savedUrl = shared.activeTab.url;
  shared.activeTab.url = "chrome://extensions/";
  assert.equal((await summary(worker)).trackingStatus, "unsupported");
  shared.activeTab.url = savedUrl;
  shared.local.settings.excludedHosts = ["example.com"];
  assert.equal((await summary(worker)).trackingStatus, "excluded");
  shared.local.settings.excludedHosts = [];
  assert.equal(JSON.stringify({ settings: shared.local.settings, reports: shared.local.reports,
    archive: (await worker.TimeLensStats.read())["2020-01-01"] }), preserved,
  "tracking changes must preserve settings, reports and historical records");
  console.log("popup-tracking.test.js: popup/focus/idle transitions and data preservation passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
