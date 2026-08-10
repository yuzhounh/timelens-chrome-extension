const Core = self.TimeLensCore;

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.sendMessage({ type: "get-summary" }, (response) => {
  if (chrome.runtime.lastError || !response?.ok) {
    document.getElementById("todayTotal").textContent = "暂时无法读取";
    return;
  }
  const { summary, activeHost } = response;
  document.getElementById("todayTotal").textContent = Core.formatDuration(summary.totalMs);
  document.getElementById("siteCount").textContent = `${summary.sites.length} 个网站`;
  document.getElementById("activeSite").textContent = activeHost ? `正在统计 ${activeHost}` : "当前未统计";
  document.getElementById("progress").style.width = `${Math.min(100, (summary.totalMs / 14400000) * 100)}%`;
  const list = document.getElementById("topSites");
  const sites = summary.sites.slice(0, 5);
  list.innerHTML = sites.length
    ? sites.map((site) => `<li><span>${escapeHtml(site.host)}</span><small>${Core.formatDuration(site.durationMs, true)}</small></li>`).join("")
    : "<li><span>今天还没有访问记录</span></li>";
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
