importScripts("i18n.js", "lib.js");

const Core = self.TimeLensCore;
const I18n = self.TimeLensI18n;
const ALARM_TICK = "tracking-tick";
const ALARM_WEEKLY = "report-weekly";
const ALARM_MONTHLY = "report-monthly";
const ALARM_QUARTERLY = "report-quarterly";
const ALARM_YEARLY = "report-yearly";
const SESSION_KEY = "activeSession";
const EMAIL_TIMEOUT_MS = 15000;
const EMAIL_MAX_ATTEMPTS = 3;
const EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  uiLocale: "auto",
  deviceName: "",
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
let emailRunner = null;

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
    schedules: { ...DEFAULT_SETTINGS.schedules, ...(settings.schedules || {}) },
    email: { ...DEFAULT_SETTINGS.email, ...(settings.email || {}) },
    excludedHosts: Array.isArray(settings.excludedHosts) ? settings.excludedHosts : []
  };
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return mergeSettings(settings);
}

// Separate from settings/backups: this identifies this browser profile only.
async function getReportDevice(settings) {
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
  if (!email.endpoint || !email.recipient) throw new Error(I18n.t("errEmailNotConfigured"));

  const { emailJob, status, sendError, sentAt, ...snapshot } = report;
  if (email.endpoint !== emailJob.endpoint || email.recipient !== emailJob.recipient) {
    throw Object.assign(new Error(I18n.t("errEmailSettingsChanged")), { retryable: false });
  }
  const headers = { "Content-Type": "application/json" };
  if (email.token) headers.Authorization = `Bearer ${email.token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const response = await fetch(email.endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        recipient: emailJob.recipient,
        report: snapshot,
        locale: emailJob.locale,
        deliveryId: emailJob.id,
        source: "timelens-chrome-extension"
      })
    });
    // Read under the same timeout, including slow error/success bodies.
    const detail = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(I18n.t("errEmailGateway", String(response.status), detail ? `: ${detail.slice(0, 200)}` : "")), {
        retryable: response.status >= 500 || [408, 429].includes(response.status)
      });
    }
    return { status: "sent", sentAt: new Date().toISOString() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(I18n.t("errEmailTimeout"));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Only short storage operations share the tracking queue; network work never does.
function kickEmailQueue() {
  if (emailRunner) return emailRunner;
  emailRunner = drainEmailQueue().catch((error) => {
    console.error("Time Lens email queue failed", error);
  }).finally(() => { emailRunner = null; });
  return emailRunner;
}

async function drainEmailQueue() {
  while (true) {
    const claimed = await enqueue(async () => {
      const { reports = [], deviceId } = await chrome.storage.local.get(["reports", "deviceId"]);
      const report = reports.find((item) => item.status === "queued" && item.emailJob
        && item.device?.id === deviceId && item.emailJob.nextAttemptAt <= Date.now());
      if (!report) return null;
      if (report.emailJob.attempts >= EMAIL_MAX_ATTEMPTS || report.emailJob.expiresAt <= Date.now()) {
        report.status = "failed";
        report.sendError = I18n.t("errEmailRetryStopped");
        await saveReport(report);
        return { skipped: true };
      }
      report.emailJob.attempts += 1;
      // A terminated worker can retry this persisted lease on a later tick.
      report.emailJob.nextAttemptAt = Date.now() + 60000;
      await saveReport(report);
      return { report, settings: await getSettings() };
    });
    if (!claimed) return;
    if (claimed.skipped) continue;
    const { report, settings } = claimed;
    let result;
    try {
      result = { ...await sendReportEmail(report, settings), sendError: "" };
    } catch (error) {
      result = {
        status: error.retryable !== false && report.emailJob.attempts < EMAIL_MAX_ATTEMPTS ? "queued" : "failed",
        sendError: error.message
      };
    }
    await enqueue(async () => {
      const { reports = [] } = await chrome.storage.local.get("reports");
      const current = reports.find((item) => item.id === report.id && item.emailJob?.id === report.emailJob.id);
      // Deletion, import or regeneration must not be undone by a late response.
      if (!current) return;
      Object.assign(current, result);
      current.emailJob.nextAttemptAt = Date.now() + 60000 * current.emailJob.attempts;
      await saveReport(current);
    });
  }
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
  await I18n.init(settings);
  const report = Core.generateReport(dailyStats, type, range.start, range.end);
  report.device = await getReportDevice(settings);
  const { reports = [] } = await chrome.storage.local.get("reports");
  const pending = reports.find((item) => item.id === report.id && item.status === "queued"
    && item.emailJob && item.device?.id === report.device.id);
  if (pending) return pending;
  report.status = sendEmail ? (settings.email.enabled ? "queued" : "disabled") : "not-requested";
  report.sendError = "";
  if (report.status === "queued") {
    report.emailJob = {
      id: crypto.randomUUID(), attempts: 0, nextAttemptAt: Date.now(),
      expiresAt: Date.now() + EMAIL_RETRY_WINDOW_MS,
      locale: I18n.isEnglish() ? "en" : "zh",
      endpoint: settings.email.endpoint, recipient: settings.email.recipient
    };
  }
  await saveReport(report);
  void kickEmailQueue();
  return report;
}

async function initialize() {
  const stored = await chrome.storage.local.get(["settings", "dailyStats", "reports"]);
  const settings = mergeSettings(stored.settings);
  await I18n.init(settings);
  await chrome.storage.local.set({
    settings,
    dailyStats: Core.normalizeDailyStats(stored.dailyStats),
    reports: Array.isArray(stored.reports) ? stored.reports : [],
    schemaVersion: 1
  });
  await scheduleAlarms();
  await refreshActiveTab();
  void kickEmailQueue();
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
      void kickEmailQueue();
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
        await I18n.init(settings);
        await scheduleAlarms({ force: true });
        await refreshActiveTab();
        sendResponse({ ok: true, settings });
      } else if (message.type === "import-data") {
        await flushActive();
        const current = await chrome.storage.local.get(["dailyStats", "reports"]);
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
        if (!message.reportId) throw new Error(I18n.t("errMissingReportId"));
        await deleteReport(message.reportId);
        sendResponse({ ok: true });
      } else if (message.type === "delete-all-data") {
        await flushActive();
        await chrome.storage.local.set({ dailyStats: {}, reports: [] });
        await refreshActiveTab();
        sendResponse({ ok: true });
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
