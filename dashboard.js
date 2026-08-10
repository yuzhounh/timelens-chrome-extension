const Core = self.TimeLensCore;
const COLORS = ["#6f9f8e", "#a9d2c3", "#f0aa81", "#83aee2", "#ab96cf", "#d9be72"];

let appState = {
  dailyStats: {},
  reports: [],
  settings: {},
  periodType: "monthly",
  anchorDate: Core.dateKey(new Date()),
  summary: null
};

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || "操作失败"));
      else resolve(response);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showToast(message, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 2800);
}

function resolvePeriod() {
  const today = Core.dateKey(new Date());
  if (appState.periodType === "all") {
    const storedDates = Object.keys(appState.dailyStats).filter((date) => date <= today).sort();
    const start = storedDates[0] || today;
    return { start, end: today, calendarStart: start, calendarEnd: today, label: Core.periodLabel("all", start, today) };
  }

  const calendar = Core.rangeFor(appState.periodType, 0, Core.parseDate(appState.anchorDate));
  const end = calendar.start <= today && calendar.end >= today ? today : calendar.end;
  return {
    start: calendar.start,
    end,
    calendarStart: calendar.start,
    calendarEnd: calendar.end,
    label: Core.periodLabel(appState.periodType, calendar.start, calendar.end)
  };
}

function trendBuckets(days) {
  if (!["yearly", "all"].includes(appState.periodType)) return days;
  const buckets = new Map();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const bucket = buckets.get(month) || { date: month, durationMs: 0, visits: 0 };
    bucket.durationMs += day.durationMs;
    bucket.visits += day.visits;
    buckets.set(month, bucket);
  }
  return [...buckets.values()];
}

async function loadState() {
  await sendMessage({ type: "get-summary" }).catch(() => null);
  const stored = await chrome.storage.local.get(["dailyStats", "reports", "settings"]);
  appState.dailyStats = Core.normalizeDailyStats(stored.dailyStats);
  appState.reports = Array.isArray(stored.reports) ? stored.reports : [];
  appState.settings = stored.settings || {};
  renderOverview();
  renderReports();
  fillSettings();
}

function renderOverview() {
  const range = resolvePeriod();
  const summary = Core.aggregate(appState.dailyStats, range.start, range.end);
  appState.summary = summary;
  const activeDayCount = summary.days.filter((day) => day.durationMs > 0).length;
  const top = summary.sites[0];
  const analyzedDays = Math.max(1, summary.days.length);
  const trendDays = trendBuckets(summary.days);

  document.getElementById("totalTime").textContent = Core.formatDuration(summary.totalMs);
  document.getElementById("dailyAverage").textContent = Core.formatDuration(summary.totalMs / analyzedDays);
  document.getElementById("visitCount").textContent = summary.totalVisits.toLocaleString("zh-CN");
  document.getElementById("activeDays").textContent = `${activeDayCount} 个活跃日`;
  document.getElementById("topHost").textContent = top?.host || "暂无记录";
  document.getElementById("topHostTime").textContent = top ? Core.formatDuration(top.durationMs) : "尚未开始统计";
  document.getElementById("rangeLabel").textContent = range.label;
  document.getElementById("periodLabel").textContent = range.label;
  document.getElementById("trendTotal").textContent = `${range.start} — ${range.end}`;
  document.getElementById("trendHeading").textContent = ["yearly", "all"].includes(appState.periodType) ? "每月有效浏览" : "每日有效浏览";
  document.getElementById("donutHours").textContent = Core.formatDuration(summary.totalMs);
  document.getElementById("periodAnchor").value = appState.anchorDate;
  document.getElementById("periodAnchor").disabled = appState.periodType === "all";
  document.getElementById("previousPeriod").disabled = appState.periodType === "all";
  document.getElementById("nextPeriod").disabled = appState.periodType === "all" || range.calendarEnd >= Core.dateKey(new Date());
  document.getElementById("resetPeriod").disabled = appState.periodType === "all" || (range.calendarStart <= Core.dateKey(new Date()) && range.calendarEnd >= Core.dateKey(new Date()));

  drawTrend(document.getElementById("trendChart"), trendDays);
  drawDonut(document.getElementById("donutChart"), summary.sites);
  renderLegend(summary);
  renderSiteTable();
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawTrend(canvas, days) {
  const { ctx, width, height } = setupCanvas(canvas);
  const margin = { top: 14, right: 10, bottom: 30, left: 42 };
  const chartWidth = Math.max(1, width - margin.left - margin.right);
  const chartHeight = Math.max(1, height - margin.top - margin.bottom);
  const values = days.map((day) => day.durationMs / 3600000);
  const max = Math.max(1, ...values);

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px "Microsoft YaHei", "微软雅黑", sans-serif';
  ctx.fillStyle = "#8b968e";
  ctx.strokeStyle = "#e2e6df";
  ctx.lineWidth = 1;

  for (let row = 0; row <= 4; row += 1) {
    const y = margin.top + chartHeight * (row / 4);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    const hours = max * (1 - row / 4);
    ctx.fillText(`${hours.toFixed(hours < 4 ? 1 : 0)}h`, 8, y + 3);
  }

  if (!values.some(Boolean)) {
    ctx.fillStyle = "#95a098";
    ctx.textAlign = "center";
    ctx.fillText("还没有足够的数据，开始浏览后这里会出现趋势", margin.left + chartWidth / 2, margin.top + chartHeight / 2);
    ctx.textAlign = "left";
    return;
  }

  if (values.length === 1) {
    const x = margin.left + chartWidth / 2;
    const y = margin.top + chartHeight * (1 - values[0] / max);
    const barWidth = Math.min(76, chartWidth * .3);
    ctx.fillStyle = "rgba(132, 183, 164, .32)";
    ctx.fillRect(x - barWidth / 2, y, barWidth, margin.top + chartHeight - y);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#6f9f8e";
    ctx.fill();
    ctx.fillStyle = "#70867d";
    ctx.textAlign = "center";
    ctx.fillText(days[0].date.replace(/-/g, "/"), x, height - 8);
    ctx.textAlign = "left";
    return;
  }

  const point = (value, index) => ({
    x: margin.left + (days.length === 1 ? chartWidth / 2 : chartWidth * index / (days.length - 1)),
    y: margin.top + chartHeight * (1 - value / max)
  });

  const gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartHeight);
  gradient.addColorStop(0, "rgba(132, 183, 164, .35)");
  gradient.addColorStop(1, "rgba(132, 183, 164, 0)");
  ctx.beginPath();
  values.forEach((value, index) => {
    const p = point(value, index);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
  ctx.lineTo(margin.left, margin.top + chartHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  values.forEach((value, index) => {
    const p = point(value, index);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = "#6f9f8e";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  ctx.fillStyle = "#8b968e";
  ctx.textAlign = "center";
  days.forEach((day, index) => {
    if (index % labelEvery === 0 || index === days.length - 1) {
      const p = point(values[index], index);
      const dateLabel = day.date.length === 7 ? day.date.replace("-", "/") : day.date.slice(5).replace("-", "/");
      ctx.fillText(dateLabel, p.x, height - 8);
    }
  });
  ctx.textAlign = "left";
}

function drawDonut(canvas, sites) {
  const { ctx, width, height } = setupCanvas(canvas);
  const total = sites.reduce((sum, site) => sum + site.durationMs, 0);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * .39;
  const lineWidth = Math.max(14, radius * .23);
  ctx.clearRect(0, 0, width, height);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#e8ece5";
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  if (!total) return;

  const top = sites.slice(0, 5);
  const other = sites.slice(5).reduce((sum, site) => sum + site.durationMs, 0);
  const segments = [...top.map((site) => site.durationMs), ...(other ? [other] : [])];
  let angle = -Math.PI / 2;
  segments.forEach((value, index) => {
    const sweep = value / total * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, angle + .015, angle + sweep - .015);
    ctx.strokeStyle = COLORS[index % COLORS.length];
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    angle += sweep;
  });
}

function renderLegend(summary) {
  const container = document.getElementById("donutLegend");
  const top = summary.sites.slice(0, 5);
  const otherMs = summary.sites.slice(5).reduce((sum, site) => sum + site.durationMs, 0);
  const items = [...top, ...(otherMs ? [{ host: "其他", durationMs: otherMs }] : [])];
  container.innerHTML = items.length
    ? items.map((site, index) => `<div class="legend-row"><span class="legend-dot" style="background:${COLORS[index % COLORS.length]}"></span><span>${escapeHtml(site.host)}</span><span>${summary.totalMs ? Math.round(site.durationMs / summary.totalMs * 100) : 0}%</span></div>`).join("")
    : "<div class=\"legend-row\"><span></span><span>暂无数据</span><span>0%</span></div>";
}

function renderSiteTable() {
  const query = document.getElementById("siteSearch").value.trim().toLowerCase();
  const summary = appState.summary;
  const sites = summary.sites.filter((site) => `${site.host} ${site.title}`.toLowerCase().includes(query));
  document.getElementById("siteTable").innerHTML = sites.length
    ? sites.map((site, index) => {
        const share = summary.totalMs ? site.durationMs / summary.totalMs * 100 : 0;
        return `<tr>
          <td><div class="site-cell"><span class="favicon" style="background:${COLORS[index % COLORS.length]}">${escapeHtml(site.host[0] || "·")}</span><div><strong title="${escapeHtml(site.host)}">${escapeHtml(site.host)}</strong><small title="${escapeHtml(site.title)}">${escapeHtml(site.title)}</small></div></div></td>
          <td>${escapeHtml(Core.formatDuration(site.durationMs))}</td>
          <td><div class="share" title="${share.toFixed(1)}%"><span style="width:${Math.max(2, share)}%"></span></div></td>
          <td>${site.visits.toLocaleString("zh-CN")}</td>
          <td><span class="site-url" title="${escapeHtml(site.url || "—")}">${escapeHtml(site.url || "—")}</span></td>
        </tr>`;
      }).join("")
    : "<tr><td colspan=\"5\" class=\"empty\">没有匹配的数据</td></tr>";
}

function renderReports() {
  const container = document.getElementById("reportCards");
  container.innerHTML = appState.reports.length
    ? appState.reports.map((report) => {
        const statusText = report.status === "sent" ? "已邮件备份" : report.status === "failed" ? "发送失败" : "已保存在本地";
        return `<article class="report-card" data-report-id="${escapeHtml(report.id)}">
          <div><h3>${escapeHtml(report.label || Core.labelForType(report.type))} · ${escapeHtml(report.periodStart)}</h3><p>${escapeHtml(report.periodStart)} 至 ${escapeHtml(report.periodEnd)} · ${report.sites?.length || 0} 个网站${report.sendError ? ` · ${escapeHtml(report.sendError)}` : ""}</p></div>
          <div class="report-stat"><strong>${escapeHtml(Core.formatDuration(report.totalMs))}</strong><small>${Number(report.totalVisits || 0).toLocaleString("zh-CN")} 次访问</small></div>
          <div><span class="status${report.status === "failed" ? " failed" : ""}">${statusText}</span><div class="report-actions"><button data-export="csv">CSV</button><button data-export="json">JSON</button></div></div>
        </article>`;
      }).join("")
    : "<article class=\"panel empty\">还没有报告。你可以立即生成本周期报告，或等待自动任务运行。</article>";
}

function fillSettings() {
  const settings = appState.settings;
  document.getElementById("idleThreshold").value = settings.idleThresholdSeconds || 60;
  document.getElementById("excludedHosts").value = (settings.excludedHosts || []).join("\n");
  document.getElementById("scheduleWeekly").checked = settings.schedules?.weekly !== false;
  document.getElementById("scheduleMonthly").checked = settings.schedules?.monthly !== false;
  document.getElementById("scheduleQuarterly").checked = settings.schedules?.quarterly !== false;
  document.getElementById("scheduleYearly").checked = settings.schedules?.yearly !== false;
  document.getElementById("emailEnabled").checked = Boolean(settings.email?.enabled);
  document.getElementById("emailEndpoint").value = settings.email?.endpoint || "";
  document.getElementById("emailRecipient").value = settings.email?.recipient || "";
  document.getElementById("emailToken").value = settings.email?.token || "";
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item, .page").forEach((element) => element.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.page).classList.add("active");
    if (button.dataset.page === "overview") requestAnimationFrame(renderOverview);
  });
});

function shiftPeriod(direction) {
  const anchor = Core.parseDate(appState.anchorDate);
  if (appState.periodType === "daily") anchor.setDate(anchor.getDate() + direction);
  else if (appState.periodType === "weekly") anchor.setDate(anchor.getDate() + direction * 7);
  else if (appState.periodType === "monthly") {
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + direction);
  } else if (appState.periodType === "quarterly") {
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + direction * 3);
  } else if (appState.periodType === "yearly") {
    anchor.setMonth(0, 1);
    anchor.setFullYear(anchor.getFullYear() + direction);
  }
  appState.anchorDate = Core.dateKey(anchor);
  renderOverview();
}

document.getElementById("periodAnchor").max = Core.dateKey(new Date());
document.getElementById("periodType").addEventListener("change", (event) => {
  appState.periodType = event.target.value;
  renderOverview();
});
document.getElementById("periodAnchor").addEventListener("change", (event) => {
  if (!event.target.value) return;
  appState.anchorDate = event.target.value;
  renderOverview();
});
document.getElementById("previousPeriod").addEventListener("click", () => shiftPeriod(-1));
document.getElementById("nextPeriod").addEventListener("click", () => shiftPeriod(1));
document.getElementById("resetPeriod").addEventListener("click", () => {
  appState.anchorDate = Core.dateKey(new Date());
  renderOverview();
});

document.getElementById("siteSearch").addEventListener("input", renderSiteTable);
window.addEventListener("resize", () => {
  clearTimeout(window.__chartResizeTimer);
  window.__chartResizeTimer = setTimeout(() => {
    if (document.getElementById("overview").classList.contains("active")) renderOverview();
  }, 150);
});

document.getElementById("generateReport").addEventListener("click", async () => {
  const button = document.getElementById("generateReport");
  button.disabled = true;
  button.textContent = "正在生成…";
  try {
    const response = await sendMessage({
      type: "generate-report",
      reportType: document.getElementById("reportType").value,
      sendEmail: document.getElementById("sendReportEmail").checked,
      offset: 0
    });
    appState.reports = [response.report, ...appState.reports.filter((item) => item.id !== response.report.id)];
    renderReports();
    showToast(response.report.status === "failed" ? `报告已保存，但邮件发送失败：${response.report.sendError}` : "报告已生成并保存", response.report.status === "failed");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "生成报告";
  }
});

document.getElementById("reportCards").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-export]");
  if (!button) return;
  const id = button.closest(".report-card").dataset.reportId;
  const report = appState.reports.find((item) => item.id === id);
  if (!report) return;
  if (button.dataset.export === "csv") download(`${report.id}.csv`, Core.reportToCsv(report), "text/csv;charset=utf-8");
  else download(`${report.id}.json`, JSON.stringify(report, null, 2), "application/json");
});

document.getElementById("exportJson").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(["dailyStats", "reports", "settings", "schemaVersion"]);
  download(`timelens-backup-${Core.dateKey(new Date())}.json`, JSON.stringify({
    app: "timelens",
    exportedAt: new Date().toISOString(),
    schemaVersion: stored.schemaVersion || 1,
    dailyStats: stored.dailyStats || {},
    reports: stored.reports || [],
    settings: stored.settings || {}
  }, null, 2), "application/json");
  showToast("完整备份已导出");
});

document.getElementById("exportCsv").addEventListener("click", () => {
  const report = { ...appState.summary, sites: appState.summary.sites };
  download(`timelens-${report.start}-${report.end}.csv`, Core.reportToCsv(report), "text/csv;charset=utf-8");
  showToast("当前报表已导出");
});

async function importBackup(mode) {
  const file = document.getElementById("importFile").files[0];
  if (!file) return showToast("请先选择 JSON 备份文件", true);
  if (mode === "replace" && !confirm("确定要用备份完全替换当前访问记录和报告吗？此操作不可撤销。")) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || !payload.dailyStats) throw new Error("文件中缺少 dailyStats，可能不是有效备份");
    await sendMessage({ type: "import-data", mode, payload });
    await loadState();
    showToast(mode === "replace" ? "备份已恢复" : "备份已合并");
  } catch (error) {
    showToast(`导入失败：${error.message}`, true);
  }
}

document.getElementById("mergeImport").addEventListener("click", () => importBackup("merge"));
document.getElementById("replaceImport").addEventListener("click", () => importBackup("replace"));
document.getElementById("deleteAll").addEventListener("click", async () => {
  if (!confirm("确定清除全部访问记录和周期报告吗？此操作不可撤销。")) return;
  await sendMessage({ type: "delete-all-data" });
  await loadState();
  showToast("统计数据已清除");
});

document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    idleThresholdSeconds: Math.min(3600, Math.max(15, Number(document.getElementById("idleThreshold").value) || 60)),
    excludedHosts: document.getElementById("excludedHosts").value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
    schedules: {
      weekly: document.getElementById("scheduleWeekly").checked,
      monthly: document.getElementById("scheduleMonthly").checked,
      quarterly: document.getElementById("scheduleQuarterly").checked,
      yearly: document.getElementById("scheduleYearly").checked
    },
    email: {
      enabled: document.getElementById("emailEnabled").checked,
      endpoint: document.getElementById("emailEndpoint").value.trim(),
      recipient: document.getElementById("emailRecipient").value.trim(),
      token: document.getElementById("emailToken").value
    }
  };
  if (settings.email.enabled && (!settings.email.endpoint || !settings.email.recipient)) {
    return showToast("启用邮件备份前，请填写网关 URL 和收件邮箱", true);
  }
  try {
    const response = await sendMessage({ type: "save-settings", settings });
    appState.settings = response.settings;
    document.getElementById("saveStatus").textContent = `已保存于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    showToast("设置已保存");
  } catch (error) {
    showToast(error.message, true);
  }
});

loadState().catch((error) => showToast(`加载数据失败：${error.message}`, true));
