(function (root) {
  "use strict";

  let activeLocale = "";
  let messageTable = {};
  let initPromise = null;

  function browserLanguage() {
    try {
      return chrome?.i18n?.getUILanguage?.() || navigator?.language || "zh-CN";
    } catch {
      return "zh-CN";
    }
  }

  function resolveLocale(preference) {
    if (preference === "en") return "en";
    if (preference === "zh-CN" || preference === "zh_CN") return "zh-CN";
    return browserLanguage().toLowerCase().startsWith("en") ? "en" : "zh-CN";
  }

  function localeFolder(locale) {
    return locale === "en" ? "en" : "zh_CN";
  }

  function formatEntry(entry, substitutions = []) {
    if (!entry?.message) return "";
    let text = entry.message;
    const placeholders = entry.placeholders || {};
    for (const [name, spec] of Object.entries(placeholders)) {
      const index = Number(String(spec.content).replace("$", "")) - 1;
      const value = substitutions[index] ?? "";
      text = text.replace(new RegExp(`\\$${name}\\$`, "gi"), value);
    }
    substitutions.forEach((value, index) => {
      text = text.replace(new RegExp(`\\$${index + 1}`, "g"), String(value));
    });
    return text;
  }

  async function init(options = {}) {
    const preference = options.uiLocale ?? options.preference ?? "auto";
    activeLocale = resolveLocale(preference === "auto" ? "auto" : preference);
    messageTable = {};

    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      try {
        const response = await fetch(chrome.runtime.getURL(`_locales/${localeFolder(activeLocale)}/messages.json`));
        if (response.ok) messageTable = await response.json();
      } catch {
        messageTable = {};
      }
    }

    return activeLocale;
  }

  function ensureInit(options) {
    if (!initPromise) initPromise = init(options);
    return initPromise;
  }

  function resetInit(options) {
    initPromise = init(options);
    return initPromise;
  }

  function isEnglish() {
    if (activeLocale) return activeLocale === "en";
    return browserLanguage().toLowerCase().startsWith("en");
  }

  function localeTag() {
    return isEnglish() ? "en" : "zh-CN";
  }

  function uiLanguage() {
    return localeTag();
  }

  function t(key, ...substitutions) {
    const entry = messageTable[key];
    if (entry) {
      const formatted = formatEntry(entry, substitutions);
      if (formatted) return formatted;
    }
    try {
      const message = chrome?.i18n?.getMessage?.(key, substitutions.map(String));
      if (message) return message;
    } catch {
      // Ignore and fall back below.
    }
    const fallback = FALLBACK[isEnglish() ? "en" : "zh"][key];
    if (typeof fallback === "function") return fallback(...substitutions);
    if (fallback) return fallback;
    return key;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString(localeTag());
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.title = t(element.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    });
    const htmlLang = root.documentElement || root;
    if (htmlLang?.setAttribute) htmlLang.setAttribute("lang", localeTag());
  }

  const FALLBACK = {
    zh: {
      otherSites: "其他",
      total: "总计",
      operationFailed: "操作失败"
    },
    en: {
      otherSites: "Other",
      total: "Total",
      operationFailed: "Operation failed"
    }
  };

  root.TimeLensI18n = {
    browserLanguage,
    resolveLocale,
    init,
    ensureInit,
    resetInit,
    uiLanguage,
    isEnglish,
    localeTag,
    t,
    formatNumber,
    apply
  };
})(typeof self !== "undefined" ? self : globalThis);
