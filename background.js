importScripts("i18n.js", "lib.js", "firebase-config.js", "sync-core.js", "stats-store.js", "cloud-sync.js");

const Core = self.TimeLensCore;
const I18n = self.TimeLensI18n;
const ALARM_TICK = "tracking-tick";
const SESSION_KEY = "activeSession";

const DEFAULT_SETTINGS = {
  uiLocale: "auto",
  deviceName: "",
  idleThresholdSeconds: 60,
  excludedHosts: []
};

let operationQueue = Promise.resolve();
const popupConnections = new Map();
let focusRefreshTimer;
let trackingStatus = "inactive";

function enqueue(task) {
  operationQueue = operationQueue.then(task, task).catch((error) => {
    console.error("时光镜后台任务失败", error);
  });
  return operationQueue;
}

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    deviceName: typeof settings.deviceName === "string"
      ? settings.deviceName.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 80)
      : "",
    excludedHosts: Array.isArray(settings.excludedHosts) ? settings.excludedHosts : []
  };
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return mergeSettings(settings);
}

// Separate from settings/backups: this identifies this browser profile only.
async function ensureDevice(settings) {
  let { deviceId } = await chrome.storage.local.get("deviceId");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ deviceId });
  }
  return { id: deviceId, name: settings.deviceName || `Time Lens ${deviceId.slice(0, 8)}` };
}

async function getActiveSession() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function setActiveSession(session) {
  if (session) await chrome.storage.session.set({ [SESSION_KEY]: session });
  else await chrome.storage.session.remove(SESSION_KEY);
}

function siteFromTab(tab) {
  try {
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      tabId: tab.id,
      host: url.hostname.replace(/^www\./i, "").toLowerCase(),
      title: tab.title || url.hostname,
      url: tab.url
    };
  } catch {
    return null;
  }
}

function isExcluded(host, patterns) {
  return patterns.some((raw) => {
    const pattern = String(raw).trim().toLowerCase().replace(/^www\./, "");
    return pattern && (host === pattern || host.endsWith(`.${pattern}`));
  });
}

function splitByLocalDay(startMs, endMs) {
  const parts = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const date = new Date(cursor);
    const nextHour = cursor + 3600000 - (date.getMinutes() * 60000 + date.getSeconds() * 1000 + date.getMilliseconds());
    const segmentEnd = Math.min(endMs, nextHour);
    parts.push({ date: Core.dateKey(date), hour: date.getHours(), durationMs: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return parts;
}

async function recordSession(session, endMs) {
  if (!session || endMs <= session.startedAt) return;
  const parts = splitByLocalDay(session.startedAt, endMs);
  if (!parts.length) return;

  const dailyStats = await self.TimeLensStats.read({ dates: [...new Set(parts.map(part => part.date))] });
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    dailyStats[part.date] ||= {};
    const previous = dailyStats[part.date][session.host] || {
      durationMs: 0,
      visits: 0,
      title: session.title,
      url: session.url
    };
    previous.durationMs += part.durationMs;
    previous.hourlyMs ||= Array(24).fill(0);
    previous.hourlyMs[part.hour] += part.durationMs;
    if (index === 0 && session.countVisit) previous.visits += 1;
    previous.title = session.title || previous.title;
    previous.url = session.url || previous.url;
    dailyStats[part.date][session.host] = previous;
  }
  await self.TimeLensStats.writeDays(dailyStats);
}

async function flushActive({ continueSession = false } = {}) {
  const session = await getActiveSession();
  if (!session) return;
  const endMs = Date.now();
  await recordSession(session, endMs);
  if (continueSession) {
    await setActiveSession({ ...session, startedAt: endMs, countVisit: false });
  } else {
    await setActiveSession(null);
  }
}

async function beginTrackingTab(tab, countVisit = true) {
  const site = siteFromTab(tab);
  if (!site) return;
  const settings = await getSettings();
  if (isExcluded(site.host, settings.excludedHosts)) return;
  await setActiveSession({ ...site, startedAt: Date.now(), countVisit });
}

async function refreshActiveTab({ countVisit } = {}) {
  const previousSession = await getActiveSession();
  await flushActive();
  const settings = await getSettings();
  const [focusedWindow, currentIdleState] = await Promise.all([
    chrome.windows.getLastFocused().catch(() => null),
    chrome.idle.queryState(Math.max(15, Number(settings.idleThresholdSeconds) || 60))
  ]);
  const viewingPopup = [...popupConnections.values()].some((popup) =>
    popup.focused && popup.windowId === focusedWindow?.id && Date.now() - popup.updatedAt < 15000);
  if (currentIdleState !== "active") {
    trackingStatus = "idle";
    return;
  }
  if (!focusedWindow?.focused && !viewingPopup) {
    trackingStatus = "inactive";
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const site = siteFromTab(tabs[0]);
  if (!site) {
    trackingStatus = "unsupported";
    return;
  }
  if (isExcluded(site.host, settings.excludedHosts)) {
    trackingStatus = "excluded";
    return;
  }
  const isContinuation = previousSession
    && previousSession.tabId === site.tabId
    && previousSession.url === site.url;
  await beginTrackingTab(tabs[0], typeof countVisit === "boolean" ? countVisit : !isContinuation);
  trackingStatus = "tracking";
}

async function scheduleAlarms({ force = false } = {}) {
  const settings = await getSettings();
  const tickAlarm = await chrome.alarms.get(ALARM_TICK);
  if (force || !tickAlarm) await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  // Retire alarms left by older local or store versions; keep historical data.
  for (const type of ["weekly", "monthly", "quarterly", "yearly"]) await chrome.alarms.clear(`report-${type}`);
  chrome.idle.setDetectionInterval(Math.max(15, Number(settings.idleThresholdSeconds) || 60));
}

async function initialize() {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get(["settings", "reports"]);
  const settings = mergeSettings(stored.settings);
  await I18n.init(settings);
  await chrome.storage.local.set({
    settings,
    reports: Array.isArray(stored.reports) ? stored.reports : [],
    schemaVersion: 1
  });
  await self.TimeLensStats.initialize();
  await ensureDevice(settings);
  await scheduleAlarms();
  await refreshActiveTab();
  await chrome.alarms.create("cloud-sync", { periodInMinutes: 5 });
  void self.TimeLensCloud.kick();
}

self.TimeLensCloud.configure({
  lock: (task) => new Promise((resolve, reject) => {
    enqueue(async () => { try { resolve(await task()); } catch (error) { reject(error); } });
  }),
  applySettings: async (incoming) => {
    const settings = mergeSettings(incoming);
    await chrome.storage.local.set({ settings });
    await I18n.init(settings);
    await scheduleAlarms({ force: true });
    await refreshActiveTab();
  }
});

chrome.runtime.onInstalled.addListener(() => enqueue(initialize));
chrome.runtime.onStartup.addListener(() => enqueue(initialize));

chrome.tabs.onActivated.addListener(() => enqueue(() => refreshActiveTab()));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    enqueue(() => refreshActiveTab());
  } else if (changeInfo.title) {
    enqueue(async () => {
      const session = await getActiveSession();
      if (session?.tabId === tabId) await setActiveSession({ ...session, title: changeInfo.title });
    });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const session = await getActiveSession();
    if (session?.tabId === tabId) await refreshActiveTab();
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  clearTimeout(focusRefreshTimer);
  // Give our popup time to identify itself before treating its focus as leaving Chrome.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    focusRefreshTimer = setTimeout(() => enqueue(() => refreshActiveTab()), 150);
  } else {
    enqueue(() => refreshActiveTab());
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tracking-popup" || port.sender?.url !== chrome.runtime.getURL("popup.html")) return;
  popupConnections.set(port, { focused: false });
  port.onMessage.addListener((message) => {
    if (message?.type !== "popup-state" || !Number.isInteger(message.windowId) || message.windowId < 0) return;
    const previous = popupConnections.get(port);
    if (!previous) return;
    const popup = { windowId: message.windowId, focused: message.focused === true, updatedAt: Date.now() };
    popupConnections.set(port, popup);
    if (previous.windowId !== popup.windowId || previous.focused !== popup.focused) {
      enqueue(() => refreshActiveTab());
    }
  });
  port.onDisconnect.addListener(() => {
    popupConnections.delete(port);
    enqueue(() => refreshActiveTab());
  });
});

chrome.idle.onStateChanged.addListener((state) => {
  enqueue(() => refreshActiveTab());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cloud-sync") { void self.TimeLensCloud.kick(); return; }
  enqueue(async () => {
    if (alarm.name === ALARM_TICK) {
      await refreshActiveTab();
      return;
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "cloud-auth-ping") { sendResponse({ ok: true }); return false; }
  if (message.type === "cloud-auth-result") {
    self.TimeLensCloud.authResult(message, sender);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "cloud-rename-device") {
    if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    self.TimeLensCloud.renameDevice(message.deviceId, message.name).then(sendResponse,
      (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (["cloud-sign-in", "cloud-sign-out", "cloud-sync-now"].includes(message.type)) {
    if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    const action = message.type === "cloud-sign-in" ? "signIn" : message.type === "cloud-sign-out" ? "signOut" : "kick";
    self.TimeLensCloud[action]().then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  enqueue(async () => {
    try {
      if (message.type === "get-summary") {
        await refreshActiveTab();
        const today = Core.dateKey(new Date());
        const dailyStats = await self.TimeLensStats.read({ dates: [today] });
        const summary = Core.aggregate(dailyStats, today, today);
        const session = await getActiveSession();
        sendResponse({ ok: true, summary, activeHost: session?.host || "", trackingStatus });
      } else if (message.type === "save-settings") {
        const settings = mergeSettings(message.settings);
        const current = await chrome.storage.local.get(["settings", "deviceNamePending"]);
        await chrome.storage.local.set({ settings, cloudSettingsPending: true,
          deviceNamePending: Boolean(current.deviceNamePending || settings.deviceName !== current.settings?.deviceName) });
        await I18n.init(settings);
        await scheduleAlarms({ force: true });
        await refreshActiveTab();
        sendResponse({ ok: true, settings });
      } else if (message.type === "import-data") {
        await flushActive();
        const current = await chrome.storage.local.get("reports");
        current.dailyStats = await self.TimeLensStats.read();
        const incoming = message.payload || {};
        // Imported reports are archives, never instructions to send email.
        const importedReports = (Array.isArray(incoming.reports) ? incoming.reports : []).map((item) => {
          const { emailJob, ...archived } = item;
          if (archived.status === "queued") archived.status = "not-requested";
          return archived;
        });
        const dailyStats = message.mode === "replace"
          ? Core.normalizeDailyStats(incoming.dailyStats)
          : Core.mergeDailyStats(current.dailyStats, incoming.dailyStats);
        const reports = message.mode === "replace"
          ? importedReports
          : [...(current.reports || []), ...importedReports]
              .filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index)
              .slice(0, 100);
        await self.TimeLensStats.replaceAll(dailyStats, { reports });
        await refreshActiveTab();
        sendResponse({ ok: true });
      } else if (message.type === "delete-all-data") {
        await flushActive();
        await self.TimeLensStats.replaceAll({}, { reports: [] });
        await refreshActiveTab();
        sendResponse({ ok: true });
      } else if (message.type === "export-data") {
        await flushActive({ continueSession: true });
        const stored = await chrome.storage.local.get(["reports", "settings", "schemaVersion"]);
        sendResponse({ ok: true, ...stored, dailyStats: await self.TimeLensStats.read() });
      } else {
        sendResponse({ ok: false, error: I18n.t("errUnknownRequest") });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || I18n.t("errBackgroundOperation") });
    }
  });
  return true;
});

enqueue(initialize);
