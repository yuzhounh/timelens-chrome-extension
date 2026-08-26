const Core = self.TimeLensCore;
const I18n = self.TimeLensI18n;

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

  const { summary, activeHost } = response;
  document.getElementById("todayTotal").textContent = Core.formatDuration(summary.totalMs, I18n.isEnglish());
  document.getElementById("siteCount").textContent = I18n.t("popupSiteCount", String(summary.sites.length));
  document.getElementById("activeSite").textContent = activeHost
    ? I18n.t("popupTracking", activeHost)
    : I18n.t("popupNotTracking");
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

renderPopup().catch(() => {
  document.getElementById("todayTotal").textContent = I18n.t("popupReadError");
});
