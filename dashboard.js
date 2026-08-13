const Core = self.TimeLensCore;
const COLORS = ["#6f9f8e", "#a9d2c3", "#f0aa81", "#83aee2", "#ab96cf", "#d9be72", "#e29aa8", "#7fc4c0", "#b7c98a", "#cfa98a", "#9aa8d8"];
const OTHER_COLOR = "#c2cec8";
const TOOLTIP_SITE_LIMIT = 5;
const COMPOSITION_LIMIT = 8;

const trend = { days: [], layout: null, hoverIndex: null };
const donut = { sites: [], layout: null, hoverIndex: null, scale: 0, targetScale: 0, raf: null };

let appState = {
  dailyStats: {},
  reports: [],
  settings: {},
  periodType: "monthly",
  anchorDate: Core.dateKey(new Date()),
  sitePage: 1,
  sitePageSize: 20,
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

function topSlices(sites, limit) {
  const top = sites.slice(0, limit).map((site, index) => ({
    host: site.host,
    durationMs: site.durationMs,
    color: COLORS[index % COLORS.length]
  }));
  const otherMs = sites.slice(limit).reduce((sum, site) => sum + site.durationMs, 0);
  return otherMs ? [...top, { host: "其他", durationMs: otherMs, color: OTHER_COLOR }] : top;
}

function trendSeries(days) {
  const byMonth = ["yearly", "all"].includes(appState.periodType);
  const buckets = new Map();
  for (const day of days) {
    const key = byMonth ? day.date.slice(0, 7) : day.date;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { date: key, durationMs: 0, visits: 0, siteMap: new Map() };
      buckets.set(key, bucket);
    }
    bucket.durationMs += day.durationMs;
    bucket.visits += day.visits;
    for (const [host, record] of Object.entries(appState.dailyStats[day.date] || {})) {
      const site = bucket.siteMap.get(host) || { host, durationMs: 0, visits: 0 };
      site.durationMs += record.durationMs;
      site.visits += record.visits;
      bucket.siteMap.set(host, site);
    }
  }
  return [...buckets.values()].map(({ siteMap, ...bucket }) => ({
    ...bucket,
    sites: [...siteMap.values()].sort((a, b) => b.durationMs - a.durationMs)
  }));
}

function renderAppVersion() {
  const version = chrome.runtime?.getManifest?.().version;
  document.getElementById("appVersion").textContent = version ? `v${version}` : "";
}

async function loadState() {
  renderAppVersion();
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
  const analyzedDays = Math.max(1, summary.days.length);

  document.getElementById("totalTime").textContent = Core.formatDuration(summary.totalMs);
  document.getElementById("dailyAverage").textContent = Core.formatDuration(summary.totalMs / analyzedDays);
  document.getElementById("visitCount").textContent = summary.totalVisits.toLocaleString("zh-CN");
  document.getElementById("activeDays").textContent = `${activeDayCount} 个活跃日`;
  document.getElementById("rangeLabel").textContent = range.label;
  document.getElementById("periodLabel").textContent = range.label;
  document.getElementById("trendTotal").textContent = `${range.start} — ${range.end}`;
  document.getElementById("trendHeading").textContent = ["yearly", "all"].includes(appState.periodType) ? "每月有效浏览" : "每日有效浏览";
  document.getElementById("periodAnchor").value = appState.anchorDate;
  document.getElementById("periodAnchor").disabled = appState.periodType === "all";
  document.getElementById("previousPeriod").disabled = appState.periodType === "all";
  document.getElementById("nextPeriod").disabled = appState.periodType === "all" || range.calendarEnd >= Core.dateKey(new Date());
  document.getElementById("resetPeriod").disabled = appState.periodType === "all" || (range.calendarStart <= Core.dateKey(new Date()) && range.calendarEnd >= Core.dateKey(new Date()));

  document.getElementById("donutHours").innerHTML = durationLines(summary.totalMs).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  document.getElementById("donutLabel").textContent = "总计";
  if (donut.raf !== null) {
    cancelAnimationFrame(donut.raf);
    donut.raf = null;
  }
  donut.sites = summary.sites;
  donut.hoverIndex = null;
  donut.scale = 0;
  donut.targetScale = 0;
  drawDonut(document.getElementById("donutChart"), donut.sites);
  renderLegend(summary);

  trend.days = trendSeries(summary.days);
  trend.hoverIndex = null;
  document.getElementById("trendTooltip").hidden = true;
  drawTrend(document.getElementById("trendChart"), trend.days);

  renderSiteTable();
}

function durationLines(milliseconds) {
  const minutes = Math.max(0, Math.round((Number(milliseconds) || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return [`${remainder} 分钟`];
  return remainder ? [`${hours} 小时`, `${remainder} 分钟`] : [`${hours} 小时`];
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
  const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
  // Only touch the backing store when the CSS size actually changed. Resizing
  // canvas.width/height on every redraw (e.g. on each hover mousemove) can
  // otherwise compound with layout rounding and make the element grow.
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
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
  trend.layout = null;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px "Microsoft YaHei", "微软雅黑", sans-serif';
  ctx.fillStyle = "#8b968e";
  ctx.strokeStyle = "#e2e6df";
  ctx.lineWidth = 1;

  // Scale the number of horizontal gridlines to the chart's actual height so
  // rows stay evenly spaced (~45-55px apart) instead of a fixed count that
  // looks sparse once the chart grows taller to fill the card.
  const rowCount = Math.min(9, Math.max(4, Math.round(chartHeight / 50)));
  for (let row = 0; row <= rowCount; row += 1) {
    const y = margin.top + chartHeight * (row / rowCount);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    const hours = max * (1 - row / rowCount);
    ctx.fillText(`${hours.toFixed(1)}h`, 8, y + 3);
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
    trend.layout = { margin, chartWidth, count: 1, pointAt: () => ({ x, y }) };
    if (trend.hoverIndex === 0) drawTrendMarker(ctx, { x, y }, margin, chartHeight);
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
  days.forEach((day, index) => {
    if (index % labelEvery === 0 || index === days.length - 1) {
      const p = point(values[index], index);
      const dateLabel = day.date.length === 7 ? day.date.replace("-", "/") : day.date.slice(5).replace("-", "/");
      ctx.textAlign = index === 0 ? "left" : index === days.length - 1 ? "right" : "center";
      ctx.fillText(dateLabel, p.x, height - 8);
    }
  });
  ctx.textAlign = "left";

  trend.layout = { margin, chartWidth, count: days.length, pointAt: (index) => point(values[index], index) };
  if (trend.hoverIndex !== null && trend.hoverIndex < days.length) {
    drawTrendMarker(ctx, trend.layout.pointAt(trend.hoverIndex), margin, chartHeight);
  }
}

function drawTrendMarker(ctx, point, margin, chartHeight) {
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(point.x, margin.top);
  ctx.lineTo(point.x, margin.top + chartHeight);
  ctx.strokeStyle = "#a9cbbe";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(111, 159, 142, .18)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#6f9f8e";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function formatBucketDate(key) {
  if (key.length === 7) {
    const [year, month] = key.split("-").map(Number);
    return `${year}年${month}月`;
  }
  const date = Core.parseDate(key);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · 周${"日一二三四五六"[date.getDay()]}`;
}

// Anchors a tooltip to the mouse cursor's bottom-right, flipping to the
// opposite side when it would overflow the container. Keeping the tooltip
// tied to the pointer (rather than the hovered data point) means it never
// sits on top of what the user is trying to point at next — important for
// the donut ring, where a point-anchored tooltip used to cover the arcs.
function positionTooltipAtCursor(tooltip, container, event, gap = 14) {
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const maxLeft = Math.max(6, container.clientWidth - tooltip.offsetWidth - 6);
  const maxTop = Math.max(6, container.clientHeight - tooltip.offsetHeight - 6);
  let left = x + gap;
  if (left > maxLeft) left = x - tooltip.offsetWidth - gap;
  let top = y + gap;
  if (top > maxTop) top = y - tooltip.offsetHeight - gap;
  tooltip.style.left = `${Math.min(Math.max(6, left), maxLeft)}px`;
  tooltip.style.top = `${Math.min(Math.max(6, top), maxTop)}px`;
}

function renderTrendTooltip(canvas, bucket, event) {
  const tooltip = document.getElementById("trendTooltip");
  const slices = topSlices(bucket.sites, TOOLTIP_SITE_LIMIT);
  const detail = slices.length
    ? `<ul class="tooltip-sites">${slices.map((slice) => `<li><span class="dot" style="background:${slice.color}"></span><span class="host" title="${escapeHtml(slice.host)}">${escapeHtml(slice.host)}</span><span class="time">${escapeHtml(Core.formatDuration(slice.durationMs))}</span></li>`).join("")}</ul>`
    : `<div class="tooltip-empty">${bucket.date.length === 7 ? "该月" : "当日"}没有有效访问记录</div>`;
  tooltip.innerHTML = `<div class="tooltip-date">${escapeHtml(formatBucketDate(bucket.date))}</div>
    <div class="tooltip-total"><strong>${escapeHtml(Core.formatDuration(bucket.durationMs))}</strong><span>${bucket.visits.toLocaleString("zh-CN")} 次访问</span></div>
    ${detail}`;
  tooltip.hidden = false;
  positionTooltipAtCursor(tooltip, canvas.parentElement, event);
}

function trendIndexAt(canvas, clientX) {
  const layout = trend.layout;
  if (!layout) return null;
  if (layout.count === 1) return 0;
  const x = clientX - canvas.getBoundingClientRect().left;
  if (x < layout.margin.left - 8 || x > layout.margin.left + layout.chartWidth + 8) return null;
  const index = Math.round((x - layout.margin.left) / layout.chartWidth * (layout.count - 1));
  return Math.max(0, Math.min(layout.count - 1, index));
}

function handleTrendHover(event) {
  const canvas = event.currentTarget;
  const index = trendIndexAt(canvas, event.clientX);
  if (index === null) return clearTrendHover();
  if (trend.hoverIndex !== index) {
    trend.hoverIndex = index;
    drawTrend(canvas, trend.days);
  }
  renderTrendTooltip(canvas, trend.days[index], event);
}

function clearTrendHover() {
  if (trend.hoverIndex === null) return;
  trend.hoverIndex = null;
  document.getElementById("trendTooltip").hidden = true;
  drawTrend(document.getElementById("trendChart"), trend.days);
}

function drawDonut(canvas, sites) {
  const { ctx, width, height } = setupCanvas(canvas);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * .39;
  const lineWidth = Math.max(14, radius * .23);
  const total = sites.reduce((sum, site) => sum + site.durationMs, 0);
  const slices = topSlices(sites, COMPOSITION_LIMIT);

  let cumulative = 0;
  slices.forEach((slice) => {
    const sweep = total ? slice.durationMs / total * Math.PI * 2 : 0;
    slice.startAngle = cumulative;
    slice.endAngle = cumulative + sweep;
    cumulative += sweep;
  });
  donut.layout = { cx, cy, radius, lineWidth, slices, total };

  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#e8ece5";
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  if (!total) return;

  slices.forEach((slice, index) => {
    const isHovered = donut.hoverIndex === index;
    const boost = isHovered ? donut.scale : 0;
    const dim = donut.hoverIndex !== null && !isHovered ? 1 - .55 * donut.scale : 1;
    const pad = Math.min(.015, Math.max(.006, (slice.endAngle - slice.startAngle) / 8));
    ctx.beginPath();
    ctx.arc(cx, cy, radius + boost * 5, -Math.PI / 2 + slice.startAngle + pad, -Math.PI / 2 + slice.endAngle - pad);
    ctx.strokeStyle = slice.color;
    ctx.globalAlpha = dim;
    ctx.lineWidth = lineWidth + boost * 4;
    ctx.lineCap = "round";
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function renderLegend(summary) {
  const container = document.getElementById("donutLegend");
  const items = topSlices(summary.sites, COMPOSITION_LIMIT);
  container.innerHTML = items.length
    ? items.map((slice, index) => `<div class="legend-row" data-index="${index}"><span class="legend-dot" style="background:${slice.color}"></span><span title="${escapeHtml(slice.host)}">${escapeHtml(slice.host)}</span><span>${summary.totalMs ? Math.round(slice.durationMs / summary.totalMs * 100) : 0}%</span></div>`).join("")
    : "<div class=\"legend-row\"><span></span><span>暂无数据</span><span>0%</span></div>";
}

function updateDonutCenter(index) {
  const hoursEl = document.getElementById("donutHours");
  const labelEl = document.getElementById("donutLabel");
  if (index === null || !donut.layout?.slices[index]) {
    const total = donut.layout?.total ?? donut.sites.reduce((sum, site) => sum + site.durationMs, 0);
    hoursEl.innerHTML = durationLines(total).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
    labelEl.textContent = "总计";
    labelEl.removeAttribute("title");
    return;
  }
  const slice = donut.layout.slices[index];
  hoursEl.innerHTML = durationLines(slice.durationMs).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  labelEl.textContent = slice.host;
  labelEl.title = slice.host;
}

function highlightLegendRow(index) {
  document.querySelectorAll("#donutLegend .legend-row").forEach((row) => {
    row.classList.toggle("is-active", index !== null && Number(row.dataset.index) === index);
  });
}

function setDonutHover(index) {
  if (index === null) {
    clearDonutHover();
    return;
  }
  if (donut.hoverIndex !== index) {
    donut.hoverIndex = index;
    donut.scale = 0;
    highlightLegendRow(index);
    updateDonutCenter(index);
  }
  donut.targetScale = 1;
  startDonutAnimation();
}

function handleCompositionPointerLeave(event) {
  const panel = document.querySelector(".composition-panel");
  const related = event.relatedTarget;
  if (related && panel.contains(related)) return;
  clearDonutHover();
}

function donutSliceAt(canvas, clientX, clientY) {
  const layout = donut.layout;
  if (!layout || !layout.total) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dist = Math.hypot(x - layout.cx, y - layout.cy);
  const inner = layout.radius - layout.lineWidth / 2 - 6;
  const outer = layout.radius + layout.lineWidth / 2 + 10;
  if (dist < inner || dist > outer) return null;
  const angle = (((Math.atan2(y - layout.cy, x - layout.cx) + Math.PI / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const index = layout.slices.findIndex((slice) => angle >= slice.startAngle && angle < slice.endAngle);
  return index === -1 ? null : index;
}

function stepDonutAnimation() {
  const diff = donut.targetScale - donut.scale;
  if (Math.abs(diff) < .02) {
    donut.scale = donut.targetScale;
    if (donut.scale === 0) donut.hoverIndex = null;
    donut.raf = null;
    drawDonut(document.getElementById("donutChart"), donut.sites);
    return;
  }
  donut.scale += diff * .25;
  drawDonut(document.getElementById("donutChart"), donut.sites);
  donut.raf = requestAnimationFrame(stepDonutAnimation);
}

function startDonutAnimation() {
  if (donut.raf === null) donut.raf = requestAnimationFrame(stepDonutAnimation);
}

function handleDonutHover(event) {
  const index = donutSliceAt(event.currentTarget, event.clientX, event.clientY);
  if (index === null) return handleCompositionPointerLeave(event);
  setDonutHover(index);
}

function clearDonutHover() {
  if (donut.hoverIndex === null) return;
  donut.targetScale = 0;
  highlightLegendRow(null);
  updateDonutCenter(null);
  startDonutAnimation();
}

function renderSiteTable() {
  const query = document.getElementById("siteSearch").value.trim().toLowerCase();
  const summary = appState.summary;
  const sites = summary.sites.filter((site) => `${site.host} ${site.title}`.toLowerCase().includes(query));
  const totalPages = Math.max(1, Math.ceil(sites.length / appState.sitePageSize));
  appState.sitePage = Math.min(Math.max(1, appState.sitePage), totalPages);
  const startIndex = (appState.sitePage - 1) * appState.sitePageSize;
  const pageSites = sites.slice(startIndex, startIndex + appState.sitePageSize);
  document.getElementById("siteTable").innerHTML = sites.length
    ? pageSites.map((site, index) => {
        const color = COLORS[(startIndex + index) % COLORS.length];
        const share = summary.totalMs ? site.durationMs / summary.totalMs * 100 : 0;
        return `<tr>
          <td><div class="site-cell"><span class="favicon" style="background:${color}">${escapeHtml(site.host[0] || "·")}</span><strong title="${escapeHtml(site.host)}">${escapeHtml(site.host)}</strong></div></td>
          <td>${escapeHtml(Core.formatDuration(site.durationMs))}</td>
          <td><div class="share-cell"><div class="share-track"><span class="share-bar" style="width:${Math.max(2, share)}%;background:${color}"></span></div><div class="share-spacer"></div><span class="share-value">${share.toFixed(1)}%</span></div></td>
          <td class="visits-cell">${site.visits.toLocaleString("zh-CN")}</td>
          <td><div class="visit-cell"><strong class="visit-title" title="${escapeHtml(site.title)}">${escapeHtml(site.title)}</strong><span class="site-url" title="${escapeHtml(site.url || "—")}">${escapeHtml(site.url || "—")}</span></div></td>
        </tr>`;
      }).join("")
    : "<tr><td colspan=\"5\" class=\"empty\">没有匹配的数据</td></tr>";
  document.getElementById("sitePageSummary").textContent = sites.length
    ? `第 ${appState.sitePage} / ${totalPages} 页 · 共 ${sites.length.toLocaleString("zh-CN")} 个网站`
    : "共 0 个网站";
  document.getElementById("previousSitePage").disabled = appState.sitePage <= 1;
  document.getElementById("nextSitePage").disabled = appState.sitePage >= totalPages;
}

function renderReports() {
  const container = document.getElementById("reportCards");
  container.innerHTML = appState.reports.length
    ? appState.reports.map((report) => {
        const statusText = report.status === "sent" ? "已邮件备份" : report.status === "failed" ? "发送失败" : "已保存在本地";
        return `<article class="report-card" data-report-id="${escapeHtml(report.id)}">
          <div class="report-main"><div class="report-heading"><h3>${escapeHtml(report.label || Core.labelForType(report.type))} · ${escapeHtml(report.periodStart)}</h3><span class="status${report.status === "failed" ? " failed" : ""}">${statusText}</span></div><p>${escapeHtml(report.periodStart)} 至 ${escapeHtml(report.periodEnd)} · ${report.sites?.length || 0} 个网站${report.sendError ? ` · ${escapeHtml(report.sendError)}` : ""}</p></div>
          <div class="report-stat"><strong>${escapeHtml(Core.formatDuration(report.totalMs))}</strong><small>${Number(report.totalVisits || 0).toLocaleString("zh-CN")} 次访问</small></div>
          <div class="report-actions"><button data-export="csv">CSV</button><button data-export="json">JSON</button></div>
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
  appState.sitePage = 1;
  renderOverview();
}

document.getElementById("periodAnchor").max = Core.dateKey(new Date());
document.getElementById("periodType").addEventListener("change", (event) => {
  appState.periodType = event.target.value;
  appState.sitePage = 1;
  renderOverview();
});
document.getElementById("periodAnchor").addEventListener("change", (event) => {
  if (!event.target.value) return;
  appState.anchorDate = event.target.value;
  appState.sitePage = 1;
  renderOverview();
});
document.getElementById("previousPeriod").addEventListener("click", () => shiftPeriod(-1));
document.getElementById("nextPeriod").addEventListener("click", () => shiftPeriod(1));
document.getElementById("resetPeriod").addEventListener("click", () => {
  appState.anchorDate = Core.dateKey(new Date());
  appState.sitePage = 1;
  renderOverview();
});

document.getElementById("siteSearch").addEventListener("input", () => {
  appState.sitePage = 1;
  renderSiteTable();
});
document.getElementById("previousSitePage").addEventListener("click", () => {
  appState.sitePage -= 1;
  renderSiteTable();
});
document.getElementById("nextSitePage").addEventListener("click", () => {
  appState.sitePage += 1;
  renderSiteTable();
});
document.getElementById("trendChart").addEventListener("mousemove", handleTrendHover);
document.getElementById("trendChart").addEventListener("mouseleave", clearTrendHover);
document.getElementById("donutChart").addEventListener("mousemove", handleDonutHover);
document.getElementById("donutChart").addEventListener("mouseleave", handleCompositionPointerLeave);
document.getElementById("donutLegend").addEventListener("mouseover", (event) => {
  const row = event.target.closest(".legend-row[data-index]");
  if (!row) return;
  setDonutHover(Number(row.dataset.index));
});
document.getElementById("donutLegend").addEventListener("mouseleave", handleCompositionPointerLeave);
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
