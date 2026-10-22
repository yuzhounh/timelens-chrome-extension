const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../dashboard.js"), "utf8");
const start = source.indexOf("function confirmDataClear() {");
const end = source.indexOf('document.getElementById("deleteAll").addEventListener', start);
let now = 0;
const intervals = new Map();
let nextTimer = 0;
const listeners = new Map();
const button = {};
const dialog = {
  open: false,
  addEventListener(type, callback) { listeners.set(type, callback); },
  removeEventListener(type) { listeners.delete(type); },
  showModal() { this.open = true; },
  close(value) { this.returnValue = value; this.open = false; const close = listeners.get("close"); listeners.delete("close"); close(); }
};
const context = vm.createContext({ document: { getElementById: (id) => id === "clearDataDialog" ? dialog : button },
  performance: { now: () => now }, I18n: { t: (key, seconds) => key === "deleteConfirmWait" ? `Confirm clear (${seconds} seconds)` : "Confirm clear" },
  setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
  clearInterval(id) { intervals.delete(id); }
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  let result = context.confirmDataClear();
  assert.equal(button.disabled, true);
  assert.ok(button.textContent.includes("5 seconds"));
  let prevented = false;
  listeners.get("submit")({ submitter: button, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "early form submission is blocked independently of disabled styling");
  dialog.close("cancel");
  assert.equal(await result, false);
  assert.equal(intervals.size, 0, "cancel stops the timer");
  result = context.confirmDataClear();
  dialog.close("confirm");
  assert.equal(await result, false, "a forced early close cannot authorize deletion");
  result = context.confirmDataClear();
  now = 5000;
  for (const callback of intervals.values()) callback();
  assert.equal(button.disabled, false);
  assert.equal(dialog.open, true, "countdown never automatically confirms or closes the dialog");
  dialog.close("confirm");
  assert.equal(await result, true);
  result = context.confirmDataClear();
  assert.equal(button.disabled, true, "each opening starts a fresh countdown");
  dialog.close(""); // Native Escape cancellation has no affirmative return value.
  assert.equal(await result, false);
  console.log("delete-confirm.test.js: countdown, cancellation, early-submit protection and explicit confirmation passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
