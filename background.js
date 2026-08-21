importScripts("lib.js");

const Core = self.TimeLensCore;
const ALARM_TICK = "tracking-tick";
const ALARM_WEEKLY = "report-weekly";
const ALARM_MONTHLY = "report-monthly";
const ALARM_QUARTERLY = "report-quarterly";
const ALARM_YEARLY = "report-yearly";
const SESSION_KEY = "activeSession";

const DEFAULT_SETTINGS = {
  idleThresholdSeconds: 60,
  excludedHosts: [],
  schedules: { weekly: true, monthly: true, quarterly: true, yearly: true },
  email: {
    enabled: false,
    endpoint: "",
    token: "",
    recipient: ""
  }
};

let operationQueue = Promise.resolve();

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
    schedules: { ...DEFAULT_SETTINGS.schedules, ...(settings.schedules || {}) },
    email: { ...DEFAULT_SETTINGS.email, ...(settings.email || {}) },
    excludedHosts: Array.isArray(settings.excludedHosts) ? settings.excludedHosts : []
  };
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return mergeSettings(settings);
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
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const segmentEnd = Math.min(endMs, nextMidnight);
    parts.push({ date: Core.dateKey(date), durationMs: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return parts;
}

async function recordSession(session, endMs) {
  if (!session || endMs <= session.startedAt) return;
  const parts = splitByLocalDay(session.startedAt, endMs);
  if (!parts.length) return;

  const stored = await chrome.storage.local.get("dailyStats");
  const dailyStats = Core.normalizeDailyStats(stored.dailyStats);
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
    if (index === 0 && session.countVisit) previous.visits += 1;
    previous.title = session.title || previous.title;
    previous.url = session.url || previous.url;
    dailyStats[part.date][session.host] = previous;
  }
  await chrome.storage.local.set({ dailyStats });
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
  if (!focusedWindow?.focused || currentIdleState !== "active") return;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const site = siteFromTab(tabs[0]);
  if (!site) return;
  const isContinuation = previousSession
    && previousSession.tabId === site.tabId
    && previousSession.url === site.url;
  await beginTrackingTab(tabs[0], typeof countVisit === "boolean" ? countVisit : !isContinuation);
}

function nextBoundary(type, now = new Date()) {
  if (type === "weekly") {
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 0, 1, 0, 0);
  }
  if (type === "monthly") return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 2, 0, 0);
  if (type === "quarterly") {
    const month = Math.floor(now.getMonth() / 3) * 3 + 3;
    return new Date(now.getFullYear(), month, 1, 0, 4, 0, 0);
  }
  return new Date(now.getFullYear() + 1, 0, 1, 0, 6, 0, 0);
}

async function scheduleAlarms({ force = false } = {}) {
  const settings = await getSettings();
  const tickAlarm = await chrome.alarms.get(ALARM_TICK);
  if (force || !tickAlarm) await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  for (const type of ["weekly", "monthly", "quarterly", "yearly"]) {
    const name = `report-${type}`;
    const existing = await chrome.alarms.get(name);
    if (!settings.schedules[type]) {
      if (existing) await chrome.alarms.clear(name);
    } else if (force || !existing) {
      if (existing) await chrome.alarms.clear(name);
      await chrome.alarms.create(name, { when: nextBoundary(type).getTime() });
    }
  }
  chrome.idle.setDetectionInterval(Math.max(15, Number(settings.idleThresholdSeconds) || 60));
}

async function sendReportEmail(report, settings) {
  const email = settings.email;
  if (!email.enabled) return { status: "disabled" };
  if (!email.endpoint || !email.recipient) throw new Error("邮件网关地址或收件人未配置");

  const headers = { "Content-Type": "application/json" };
  if (email.token) headers.Authorization = `Bearer ${email.token}`;
  const response = await fetch(email.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      recipient: email.recipient,
      report,
      csv: Core.reportToCsv(report),
      source: "timelens-chrome-extension"
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`邮件网关返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }
  return { status: "sent", sentAt: new Date().toISOString() };
}

async function saveReport(report) {
  const { reports = [] } = await chrome.storage.local.get("reports");
  const withoutSame = reports.filter((item) => item.id !== report.id);
  await chrome.storage.local.set({ reports: [report, ...withoutSame].slice(0, 100) });
}

async function deleteReport(reportId) {
  const { reports = [] } = await chrome.storage.local.get("reports");
  await chrome.storage.local.set({ reports: reports.filter((item) => item.id !== reportId) });
}

async function createPeriodicReport(type, { sendEmail = true, offset = -1 } = {}) {
  await flushActive({ continueSession: true });
  const [{ dailyStats = {} }, settings] = await Promise.all([
    chrome.storage.local.get("dailyStats"),
    getSettings()
  ]);
  const range = Core.rangeFor(type, offset);
  const report = Core.generateReport(dailyStats, type, range.start, range.end);
  try {
    const emailResult = sendEmail
      ? await sendReportEmail(report, settings)
      : { status: "not-requested" };
    Object.assign(report, emailResult);
    report.sendError = "";
  } catch (error) {
    report.status = "failed";
    report.sendError = error.message;
  }
  await saveReport(report);
  return report;
}

async function initialize() {
  const stored = await chrome.storage.local.get(["settings", "dailyStats", "reports"]);
  await chrome.storage.local.set({
    settings: mergeSettings(stored.settings),
    dailyStats: Core.normalizeDailyStats(stored.dailyStats),
    reports: Array.isArray(stored.reports) ? stored.reports : [],
    schemaVersion: 1
  });
  await scheduleAlarms();
  await refreshActiveTab();
}

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
  enqueue(() => refreshActiveTab());
});

chrome.idle.onStateChanged.addListener((state) => {
  enqueue(() => refreshActiveTab());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  enqueue(async () => {
    if (alarm.name === ALARM_TICK) {
      await flushActive({ continueSession: true });
      return;
    }
    const type = alarm.name.replace("report-", "");
    if (["weekly", "monthly", "quarterly", "yearly"].includes(type)) {
      await createPeriodicReport(type);
      await scheduleAlarms();
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  enqueue(async () => {
    try {
      if (message.type === "get-summary") {
        await flushActive({ continueSession: true });
        const { dailyStats = {} } = await chrome.storage.local.get("dailyStats");
        const today = Core.dateKey(new Date());
        const summary = Core.aggregate(dailyStats, today, today);
        const session = await getActiveSession();
        sendResponse({ ok: true, summary, activeHost: session?.host || "" });
      } else if (message.type === "save-settings") {
        const settings = mergeSettings(message.settings);
        await chrome.storage.local.set({ settings });
        await scheduleAlarms({ force: true });
        await refreshActiveTab();
        sendResponse({ ok: true, settings });
      } else if (message.type === "import-data") {
        await flushActive();
        const current = await chrome.storage.local.get(["dailyStats", "reports"]);
        const incoming = message.payload || {};
        const dailyStats = message.mode === "replace"
          ? Core.normalizeDailyStats(incoming.dailyStats)
          : Core.mergeDailyStats(current.dailyStats, incoming.dailyStats);
        const reports = message.mode === "replace"
          ? (Array.isArray(incoming.reports) ? incoming.reports : [])
          : [...(current.reports || []), ...(Array.isArray(incoming.reports) ? incoming.reports : [])]
              .filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index)
              .slice(0, 100);
        await chrome.storage.local.set({ dailyStats, reports });
        await refreshActiveTab();
        sendResponse({ ok: true });
      } else if (message.type === "generate-report") {
        const report = await createPeriodicReport(message.reportType, {
          sendEmail: Boolean(message.sendEmail),
          offset: Number.isInteger(message.offset) ? message.offset : 0
        });
        sendResponse({ ok: true, report });
      } else if (message.type === "delete-report") {
        if (!message.reportId) throw new Error("缺少报告 ID");
        await deleteReport(message.reportId);
        sendResponse({ ok: true });
      } else if (message.type === "delete-all-data") {
        await flushActive();
        await chrome.storage.local.set({ dailyStats: {}, reports: [] });
        await refreshActiveTab();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "未知请求" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "后台操作失败" });
    }
  });
  return true;
});

enqueue(initialize);
