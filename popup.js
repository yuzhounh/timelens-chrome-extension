const Core = self.TimeLensCore;
const I18n = self.TimeLensI18n;
let popupPort;
let popupWindowId;
let refreshTimer;
let rendering = false;

function publishPopupState() {
  if (!popupPort || !Number.isInteger(popupWindowId)) return;
  try {
    popupPort.postMessage({ type: "popup-state", windowId: popupWindowId, focused: document.hasFocus() });
  } catch {
    popupPort = null;
  }
}

async function connectPopup() {
  const currentWindow = await chrome.windows.getCurrent();
  popupWindowId = currentWindow.id;
  popupPort = chrome.runtime.connect({ name: "tracking-popup" });
  popupPort.onDisconnect.addListener(() => { popupPort = null; });
  publishPopupState();
}

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

async function renderPopup() {
  const stored = await chrome.storage.local.get("settings");
  await I18n.init(stored.settings || {});
  I18n.apply();

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-summary" }, resolve);
  });

  if (chrome.runtime.lastError || !response?.ok) {
    document.getElementById("todayTotal").textContent = I18n.t("popupReadError");
    return;
  }

  const { summary, activeHost, trackingStatus } = response;
  document.getElementById("todayTotal").textContent = Core.formatDuration(summary.totalMs, I18n.isEnglish());
  document.getElementById("siteCount").textContent = I18n.t("popupSiteCount", String(summary.sites.length));
  document.getElementById("activeSite").textContent = activeHost
    ? I18n.t("popupTracking", activeHost)
    : I18n.t({ idle: "popupPausedIdle", inactive: "popupPausedInactive",
      unsupported: "popupUnsupported", excluded: "popupExcluded" }[trackingStatus] || "popupNotTracking");
  document.getElementById("progress").style.width = `${Math.min(100, (summary.totalMs / 14400000) * 100)}%`;
  const list = document.getElementById("topSites");
  const sites = summary.sites.slice(0, 5);
  list.innerHTML = sites.length
    ? sites.map((site) => `<li><span>${escapeHtml(site.host)}</span><small>${Core.formatDuration(site.durationMs, true)}</small></li>`).join("")
    : `<li><span>${escapeHtml(I18n.t("popupNoRecords"))}</span></li>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function refreshPopup() {
  if (rendering) return;
  rendering = true;
  try {
    if (!popupPort) await connectPopup();
    publishPopupState();
    await renderPopup();
  } catch {
    document.getElementById("todayTotal").textContent = I18n.t("popupReadError");
  } finally {
    rendering = false;
  }
}

window.addEventListener("focus", () => { publishPopupState(); void refreshPopup(); });
window.addEventListener("blur", publishPopupState);
window.addEventListener("pagehide", () => {
  clearInterval(refreshTimer);
  popupPort?.disconnect();
});
void refreshPopup();
refreshTimer = setInterval(() => { void refreshPopup(); }, 5000);
