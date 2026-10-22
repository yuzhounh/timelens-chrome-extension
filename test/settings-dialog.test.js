const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const source = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, "moved controls must not create duplicate IDs");
for (const match of source.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]) || match[1] === "deviceName", `Missing control: ${match[1]}`);
}
assert.ok(!html.includes('<aside'), "the main sidebar is removed");
let focused;
function node(id) {
  const events = {};
  return { id, events, open: false, hidden: false,
    addEventListener(type, callback) { events[type] = callback; },
    setAttribute(name, value) { this[name] = value; },
    focus() { focused = id; },
    showModal() { this.open = true; },
    getBoundingClientRect() { return { left: 100, top: 100, right: 900, bottom: 700 }; },
    close() { this.open = false; events.close?.(); }
  };
}
const names = ["preferences", "account", "devices", "data"];
const tabs = names.map((name) => Object.assign(node(`tab-${name}`), { dataset: { settingsTab: name } }));
const panels = names.map((name) => ({ dataset: { settingsPanel: name }, hidden: name !== "preferences" }));
const nodes = Object.fromEntries(["openSettings", "closeSettings", "settingsDialog"].map((id) => [id, node(id)]));
const bodyClasses = new Set();
const context = vm.createContext({ document: {
  getElementById: (id) => nodes[id],
  querySelectorAll: (selector) => selector === "[data-settings-tab]" ? tabs : panels,
  querySelector: () => ({ scrollTop: 0 }),
  body: { classList: { add: (name) => bodyClasses.add(name), remove: (name) => bodyClasses.delete(name) } }
}, renderCloud() {}, renderDevices() {} });
const start = source.indexOf("function activateSettingsPanel(");
const end = source.indexOf('document.getElementById("dataScope").addEventListener', start);
vm.runInContext(source.slice(start, end), context);
nodes.openSettings.events.click();
assert.equal(nodes.settingsDialog.open, true);
assert.ok(bodyClasses.has("settings-open"));
tabs[2].events.click();
assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false, true]);
assert.equal(tabs[2]["aria-selected"], "true");
let prevented = false;
tabs[2].events.keydown({ key: "ArrowRight", preventDefault() { prevented = true; } });
assert.ok(prevented);
assert.equal(focused, "tab-data");
assert.equal(tabs[3].tabIndex, 0);
tabs[3].events.keydown({ key: "Home", preventDefault() {} });
assert.equal(focused, "tab-preferences");
tabs[0].events.keydown({ key: "ArrowDown", preventDefault() {} });
assert.equal(focused, "tab-account", "vertical tabs support Down");
tabs[1].events.keydown({ key: "ArrowUp", preventDefault() {} });
assert.equal(focused, "tab-preferences", "vertical tabs support Up");
nodes.closeSettings.events.click();
assert.equal(nodes.settingsDialog.open, false);
assert.equal(bodyClasses.size, 0);
assert.equal(focused, "openSettings", "closing restores focus to the settings button");
nodes.openSettings.events.click();
const dialog = nodes.settingsDialog;
const pointer = (x, y, target = dialog) => ({ pointerId: 1, button: 0, target, clientX: x, clientY: y });
dialog.events.pointerdown(pointer(150, 150));
dialog.events.pointerup(pointer(150, 150));
assert.equal(dialog.open, true, "clicking the dialog's interior padding must not close it");
dialog.events.pointerdown(pointer(150, 150, nodes.closeSettings));
dialog.events.pointerup(pointer(50, 50));
assert.equal(dialog.open, true, "dragging from inside to outside must not close settings");
dialog.events.pointerdown(pointer(50, 50));
dialog.events.pointerup(pointer(50, 50));
assert.equal(dialog.open, false, "a click starting and ending on the backdrop closes settings");
assert.equal(focused, "openSettings");
console.log("settings-dialog.test.js: control preservation, tab switching, keyboard navigation and closing passed");
