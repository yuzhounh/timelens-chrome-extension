const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const table = (locale) => JSON.parse(fs.readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"));
const zh = table("zh_CN"), en = table("en");
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "both locales must cover the same keys");
for (const file of ["dashboard.html", "popup.html"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of source.matchAll(/data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g)) {
    assert.ok(zh[match[1]] && en[match[1]], `${file}: missing translation ${match[1]}`);
  }
}
const elements = { importFile: { files: [] }, importFileName: {}, importActions: {} };
const context = vm.createContext({ console, document: { getElementById: (id) => elements[id] },
  chrome: { runtime: { getURL: (value) => value }, i18n: { getUILanguage: () => "en", getMessage: () => "WRONG_BROWSER_LANGUAGE" } },
  fetch: async (url) => ({ ok: true, json: async () => url.includes("zh_CN") ? zh : en })
});
context.self = context;
vm.runInContext(fs.readFileSync(path.join(root, "i18n.js"), "utf8"), context);
const source = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const start = source.indexOf("function renderImportFile() {");
const end = source.indexOf('document.getElementById("chooseImportFile")', start);
context.I18n = context.TimeLensI18n;
vm.runInContext(source.slice(start, end), context);
(async () => {
  for (const [locale, messages] of [["zh-CN", zh], ["en", en]]) {
    await context.I18n.init({ uiLocale: locale });
    assert.equal(context.I18n.t("chooseFile"), messages.chooseFile.message);
    context.renderImportFile();
    assert.equal(elements.importFileName.textContent, "");
    assert.equal(elements.importFileName.hidden, true);
    assert.equal(elements.importActions.hidden, true);
    elements.importFile.files = [{ name: "my-backup.json" }];
    context.renderImportFile();
    assert.equal(elements.importFileName.textContent, "my-backup.json", "filenames stay unchanged");
    elements.importFile.files = [];
    assert.equal(context.I18n.errorMessage(Error("cloudLoginTimeout")), messages.cloudLoginTimeout.message);
    assert.equal(context.I18n.errorMessage(Error("Failed to fetch")), messages.errorNetwork.message);
    assert.equal(context.I18n.errorMessage(Error("Unexpected English backend message")), messages.operationFailed.message);
    const countdown = context.I18n.t("deleteConfirmWait", "5");
    assert.ok(locale === "en" ? countdown.includes("seconds") : countdown.includes("秒"));
    if (locale === "en") for (const entry of Object.values(messages)) assert.ok(!/[\u4e00-\u9fff]/.test(entry.message));
  }
  console.log("localization.test.js: locale coverage, browser-language independence, file control, errors and countdown passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
