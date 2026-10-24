const Core = self.TimeLensCore;
const I18n = self.TimeLensI18n;
const readViewStats = self.TimeLensStats.createReader();
const viewStats = self.TimeLensSyncCore.createStatsView();

function displayDuration(milliseconds) {
  return Core.formatDuration(milliseconds, I18n.isEnglish());
}
const COLORS = ["#6f9f8e", "#a9d2c3", "#f0aa81", "#83aee2", "#ab96cf", "#d9be72", "#e29aa8", "#7fc4c0", "#b7c98a", "#cfa98a", "#9aa8d8"];
const OTHER_COLOR = "#c2cec8";
const TOOLTIP_SITE_LIMIT = 5;
const COMPOSITION_LIMIT = 8;

const trend = { days: [], layout: null, hoverIndex: null };
const donut = { sites: [], layout: null, hoverIndex: null, scale: 0, targetScale: 0, raf: null };

let appState = {
  dailyStats: {},
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
      else if (!response?.ok) reject(new Error(response?.error || I18n.t("operationFailed")));
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
  return otherMs ? [...top, { host: I18n.t("otherSites"), durationMs: otherMs, color: OTHER_COLOR }] : top;
}

function trendSeries() {
  const range = resolvePeriod();
  return self.TimeLensAnalytics.timeline(appState.dailyStats, range.calendarStart, range.calendarEnd,
    Core.dateKey(new Date()), appState.periodType);
}

function renderAppVersion() {
  const version = chrome.runtime?.getManifest?.().version;
  document.getElementById("appVersion").textContent = version || "";
}

async function loadState() {
  await sendMessage({ type: "get-summary" }).catch(() => null);
  const stored = await chrome.storage.local.get(["reports", "settings", "cloudCache", "viewScope", "deviceId", "cloudDevices"]);
  stored.dailyStats = await readViewStats();
  appState.settings = stored.settings || {};
  await I18n.init(appState.settings);
  I18n.apply();
  renderDeviceScope(stored);
  applyDataView(stored);
  renderAppVersion();
  renderOverview();
  await renderDevices();
  fillSettings();
  renderImportFile();
  await renderCloud();
}

function applyDataView(stored) {
  const scope = document.getElementById("dataScope").value;
  appState.dailyStats = viewStats(stored.dailyStats, stored.cloudCache, scope, stored.deviceId);
}

let dataViewRefresh = null, dataViewDirty = false;
async function refreshDataView() {
  dataViewDirty = true;
  if (document.hidden) return;
  if (dataViewRefresh) return dataViewRefresh;
  dataViewRefresh = Promise.resolve().then(async () => {
    while (dataViewDirty && !document.hidden) {
      dataViewDirty = false;
      const stored = await chrome.storage.local.get(["reports", "cloudCache", "settings", "deviceId", "cloudDevices", "viewScope"]);
      stored.dailyStats = await readViewStats();
      if (document.hidden) { dataViewDirty = true; return; }
      renderDeviceScope(stored);
      applyDataView(stored);
      renderOverview();
    }
  }).finally(() => { dataViewRefresh = null; });
  return dataViewRefresh;
}

function deviceEntries(stored) {
  const id = stored.deviceId || "local";
  const entries = new Map((stored.cloudDevices || []).map((device) => [device.id, { ...device, isLocal: device.id === id }]));
  for (const [deviceId, device] of Object.entries(stored.cloudCache || {})) {
    if (!entries.has(deviceId)) entries.set(deviceId, { id: deviceId, name: device.name, isLocal: false });
  }
  entries.set(id, { id, isLocal: true, name: stored.settings?.deviceName || entries.get(id)?.name || `Time Lens ${id.slice(0, 8)}` });
  return [...entries.values()].sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name));
}

function renderDeviceScope(stored) {
  const select = document.getElementById("dataScope");
  const selected = stored.viewScope || select.value || "all";
  select.innerHTML = `<option value="all">${escapeHtml(I18n.t("cloudAll"))}</option>` + deviceEntries(stored).map((device) =>
    `<option value="${escapeHtml(device.isLocal ? "local" : device.id)}">${escapeHtml(device.name)}${device.isLocal ? ` · ${escapeHtml(I18n.t("deviceThis"))}` : ""}</option>`).join("");
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "all";
}

async function renderDevices() {
  if (document.activeElement?.classList.contains("device-name-input")) return;
  const stored = await chrome.storage.local.get(["settings", "deviceId", "cloudDevices", "cloudCache", "cloudAuth"]);
  if (document.activeElement?.classList.contains("device-name-input")) return;
  document.getElementById("deviceList").innerHTML = deviceEntries(stored).map((device) => {
    const value = device.isLocal ? stored.settings?.deviceName || "" : device.name;
    return `<label class="device-item"><span class="device-identity">${escapeHtml(I18n.t(device.isLocal ? "deviceThis" : "deviceLinked"))}</span><input ${device.isLocal ? 'id="deviceName"' : ""} class="device-name-input" data-device-id="${escapeHtml(device.id)}" value="${escapeHtml(value)}" type="text" maxlength="80" placeholder="${escapeHtml(device.name)}" aria-label="${escapeHtml(I18n.t("deviceNameLabel"))}" ${!device.isLocal && !stored.cloudAuth ? "disabled" : ""} /><small class="device-id" title="${escapeHtml(device.id)}">${escapeHtml(I18n.t("deviceIdLabel"))}: ${escapeHtml(device.id)}</small><small class="device-save-status" aria-live="polite"></small></label>`;
  }).join("");
}

const deviceRenameTimers = new Map();
document.getElementById("deviceList").addEventListener("input", (event) => {
  const input = event.target.closest(".device-name-input");
  if (!input || input.id === "deviceName") return;
  const id = input.dataset.deviceId;
  const output = input.closest(".device-item").querySelector(".device-save-status");
  clearTimeout(deviceRenameTimers.get(id));
  output.textContent = I18n.t("savingSettings");
  deviceRenameTimers.set(id, setTimeout(async () => {
    try {
      await sendMessage({ type: "cloud-rename-device", deviceId: id, name: input.value });
      output.textContent = "";
      await refreshDataView();
    } catch (error) { output.textContent = I18n.errorMessage(error); }
    finally { deviceRenameTimers.delete(id); }
  }, 500));
});

function safeAvatarURL(value) {
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value || "")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com")) ? url.href : ""; }
  catch { return ""; }
}

async function renderCloud() {
  const { cloudStatus: state = { state: "signed-out" }, cloudAuth, cloudCache = {} } =
    await chrome.storage.local.get(["cloudStatus", "cloudAuth", "cloudCache"]);
  const signedIn = Boolean(cloudAuth);
  const email = cloudAuth?.email || "";
  const name = cloudAuth?.displayName || email.split("@")[0] || I18n.t("cloudAccountLabel");
  const online = navigator.onLine !== false;
  const label = !signedIn ? I18n.t("cloudSignedOut") : !online ? I18n.t("cloudOffline") :
    I18n.t({ syncing: "cloudSyncing", synced: "cloudSynced", error: "cloudRetrying" }[state.state] || "cloudWaiting");
  document.getElementById("accountName").textContent = signedIn ? name : I18n.t("cloudSignIn");
  const emailElement = document.getElementById("accountEmail");
  emailElement.textContent = signedIn ? email : I18n.t("cloudLoginHint");
  emailElement.title = email;
  document.getElementById("accountName").title = signedIn ? name : "";
  const avatar = document.getElementById("accountAvatar");
  const fallback = document.getElementById("avatarFallback");
  fallback.textContent = signedIn ? Array.from(name)[0].toUpperCase() : "";
  fallback.classList.toggle("google-fallback", !signedIn);
  const photo = signedIn ? safeAvatarURL(cloudAuth.avatarDataUrl) || safeAvatarURL(cloudAuth.photoURL) : "";
  if (photo && avatar.getAttribute("src") !== photo) {
    avatar.hidden = true; fallback.hidden = false;
    avatar.onload = () => { avatar.hidden = false; fallback.hidden = true; };
    avatar.onerror = () => { avatar.hidden = true; fallback.hidden = false; };
    avatar.src = photo;
  } else if (!photo) {
    avatar.removeAttribute("src"); avatar.hidden = true; fallback.hidden = false;
  }
  document.getElementById("cloudDetail").textContent = signedIn && state.error
    ? label + " · " + I18n.errorMessage({ message: state.error, code: state.errorCode }, "cloudError") : label;
  document.getElementById("cloudLastSync").textContent = signedIn && state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleString(I18n.localeTag()) : "—";
  document.getElementById("cloudHint").textContent = I18n.t(signedIn ? "cloudHint" : "cloudLoginFromSidebar");
  document.getElementById("cloudSignIn").hidden = signedIn;
  for (const id of ["cloudSyncNow", "cloudSignOut"]) document.getElementById(id).hidden = !signedIn;
  for (const id of ["cloudSyncNow"]) document.getElementById(id).disabled = state.state === "syncing" || !online;
}

window.addEventListener("online", () => { void renderCloud(); });
window.addEventListener("offline", () => { void renderCloud(); });
function activateSettingsPanel(name, focus = false) {
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  const selected = tabs.find((tab) => tab.dataset.settingsTab === name);
  if (!selected) return;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-settings-panel]")) panel.hidden = panel.dataset.settingsPanel !== name;
  document.querySelector(".settings-body").scrollTop = 0;
  if (focus) selected.focus();
}

function openSettingsDialog() {
  const dialog = document.getElementById("settingsDialog");
  if (dialog.open) return;
  dialog.showModal();
  document.body.classList.add("settings-open");
  void renderCloud();
  void renderDevices();
}

document.getElementById("openSettings").addEventListener("click", openSettingsDialog);
document.getElementById("closeSettings").addEventListener("click", () => document.getElementById("settingsDialog").close());
const settingsDialog = document.getElementById("settingsDialog");
let backdropPointer = null;
function isSettingsBackdrop(event) {
  const bounds = settingsDialog.getBoundingClientRect();
  return event.target === settingsDialog && (event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom);
}
settingsDialog.addEventListener("pointerdown", (event) => {
  backdropPointer = event.button === 0 && isSettingsBackdrop(event) ? event.pointerId : null;
});
settingsDialog.addEventListener("pointerup", (event) => {
  const close = backdropPointer !== null && backdropPointer === event.pointerId && isSettingsBackdrop(event);
  backdropPointer = null;
  if (close) settingsDialog.close();
});
settingsDialog.addEventListener("pointercancel", () => { backdropPointer = null; });
document.getElementById("settingsDialog").addEventListener("close", () => {
  backdropPointer = null;
  document.body.classList.remove("settings-open");
  document.getElementById("openSettings").focus();
});
for (const button of document.querySelectorAll("[data-settings-tab]")) {
  button.addEventListener("click", () => activateSettingsPanel(button.dataset.settingsTab));
  button.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll("[data-settings-tab]")];
    const index = tabs.indexOf(button);
    const target = { ArrowDown: (index + 1) % tabs.length, ArrowUp: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    activateSettingsPanel(tabs[target].dataset.settingsTab, true);
  });
}

document.getElementById("dataScope").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ viewScope: event.target.value });
  await refreshDataView();
});
for (const [id, type] of [["cloudSignIn", "cloud-sign-in"], ["cloudSignOut", "cloud-sign-out"], ["cloudSyncNow", "cloud-sync-now"]]) {
  document.getElementById(id).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await sendMessage({ type });
      await loadState();
    } catch (error) { showToast(I18n.errorMessage(error), true); }
    finally { button.disabled = false; await renderCloud(); }
  });
}

function renderOverview() {
  const range = resolvePeriod();
  const summary = Core.aggregate(appState.dailyStats, range.start, range.end);
  appState.summary = summary;
  const activeDayCount = summary.days.filter((day) => day.durationMs > 0).length;
  const analyzedDays = Math.max(1, summary.days.filter(day => Object.keys(appState.dailyStats[day.date] || {}).length).length);

  document.getElementById("totalTime").textContent = displayDuration(summary.totalMs);
  document.getElementById("dailyAverage").textContent = displayDuration(summary.totalMs / analyzedDays);
  document.getElementById("visitCount").textContent = I18n.formatNumber(summary.totalVisits);
  document.getElementById("activeDays").textContent = I18n.t("metricActiveDays", String(activeDayCount));
  document.getElementById("rangeLabel").textContent = range.label;
  document.getElementById("periodLabel").textContent = range.label;
  document.getElementById("trendTotal").textContent = `${range.start} — ${range.end}`;
  document.getElementById("trendHeading").textContent = self.TimeLensAnalytics.monthly(appState.periodType, summary.days.length)
    ? I18n.t("trendMonthly")
    : I18n.t("trendDaily");
  document.getElementById("periodAnchor").value = appState.anchorDate;
  document.getElementById("periodAnchor").disabled = appState.periodType === "all";
  document.getElementById("previousPeriod").disabled = appState.periodType === "all";
  document.getElementById("nextPeriod").disabled = appState.periodType === "all" || range.calendarEnd >= Core.dateKey(new Date());
  document.getElementById("resetPeriod").disabled = appState.periodType === "all" || (range.calendarStart <= Core.dateKey(new Date()) && range.calendarEnd >= Core.dateKey(new Date()));

  document.getElementById("donutHours").innerHTML = durationLines(summary.totalMs).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  document.getElementById("donutLabel").textContent = I18n.t("total");
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

  trend.days = trendSeries();
  document.getElementById("trendNote").textContent = I18n.t("trendGuidance");
  if (trend.days[0]?.hour !== undefined) {
    document.getElementById('trendHeading').textContent = I18n.t('trendHourly');
    document.getElementById('trendNote').textContent = I18n.t('trendHourlyGuidance');
  }
  trend.hoverIndex = null;
  document.getElementById("trendTooltip").hidden = true;
  drawTrend(document.getElementById("trendChart"), trend.days);

  renderSiteTable();
  renderPatterns(range, summary);
}

let patternMode = '';
function renderPatterns(range, summary) {
  const data = self.TimeLensAnalytics.patterns(appState.dailyStats, range.start, range.end, appState.periodType);
  const panel = document.getElementById('usagePatterns');
  panel.hidden = !data.available.length;
  if (panel.hidden) return;
  if (!data.available.includes(patternMode)) patternMode = data.available[0];
  const names = {hourly:'patternHourly',weekday:'patternWeekday',academic:'patternAcademic',sites:'patternSites'};
  document.getElementById('patternsCoverage').textContent = I18n.t('patternsCoverage',String(data.recordedDays),String(data.missingDays));
  document.getElementById('patternTabs').innerHTML = data.available.map(kind => `<button type="button" id="pattern-tab-${kind}" role="tab" data-pattern-kind="${kind}" aria-controls="patternContent" aria-selected="${kind===patternMode}" tabindex="${kind===patternMode?0:-1}">${escapeHtml(I18n.t(names[kind]))}</button>`).join('');
  document.getElementById('patternDescription').textContent = I18n.t(`pattern${patternMode[0].toUpperCase()+patternMode.slice(1)}Desc`);
  document.getElementById('hourlyCoverage').textContent = I18n.t('patternHourlyCoverage',String(data.hourlyDays));
  const content = document.getElementById('patternContent');
  content.setAttribute('aria-labelledby',`pattern-tab-${patternMode}`);
  const rows = items => {
    const max = Math.max(1,...items.map(item => item.averageMs||0));
    return `<div class="pattern-rows">${items.map(item => `<div class="pattern-row"><span>${escapeHtml(item.label)}</span><span class="pattern-track"><i style="width:${(item.averageMs||0)/max*100}%"></i></span><strong>${escapeHtml(item.averageMs===null?I18n.t('patternMissing'):displayDuration(item.averageMs))}</strong><small>${escapeHtml(I18n.t('patternRecordedDays',String(item.recordedDays)))}</small></div>`).join('')}</div>`;
  };
  if (patternMode === 'hourly') {
    const max = Math.max(1,...data.hours.map(hour=>hour.averageMs||0));
    content.innerHTML = `<div class="pattern-hours">${data.hours.map(hour => {
      const label=`${String(hour.hour).padStart(2,'0')}:00–${String(hour.hour+1).padStart(2,'0')}:00 · ${displayDuration(hour.averageMs)}`;
      return `<div class="pattern-hour" tabindex="0" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="pattern-column"><i style="height:${hour.averageMs/max*100}%"></i></span><small>${String(hour.hour).padStart(2,'0')}</small></div>`;
    }).join('')}</div>`;
  } else if (patternMode === 'weekday') {
    content.innerHTML = rows(data.weekdays.map(day=>({...day,label:new Date(2026,0,5+day.index).toLocaleDateString(I18n.localeTag(),{weekday:'long'})})));
  } else if (patternMode === 'academic') {
    const labels={spring:'patternSpring',autumn:'patternAutumn',winter:'patternWinter',summer:'patternSummer',unknown:'patternUnknown'};
    content.innerHTML = rows(data.academic.filter(day=>day.kind!=='unknown'||day.recordedDays).map(day=>({...day,label:I18n.t(labels[day.kind])})))+'<p class="pattern-basis">'+escapeHtml(I18n.t('patternCalendarBasis'))+'</p>';
  } else {
    const share = ms => (summary.totalMs?ms/summary.totalMs*100:0).toLocaleString(I18n.localeTag(),{maximumFractionDigits:1})+'%';
    const peak=summary.days.filter(day=>day.durationMs>0).sort((a,b)=>b.durationMs-a.durationMs)[0];
    const items=[['patternTopSite',share(summary.sites[0]?.durationMs||0),summary.sites[0]?.host||'—'],
      ['patternTopThree',share(summary.sites.slice(0,3).reduce((n,site)=>n+site.durationMs,0)),''],
      ['patternVisitAverage',summary.totalVisits?displayDuration(summary.totalMs/summary.totalVisits):'—',''],
      ['patternPeakDay',peak?displayDuration(peak.durationMs):'—',peak?.date||'']];
    content.innerHTML=`<div class="pattern-insights">${items.map(([key,value,detail])=>`<div><small>${escapeHtml(I18n.t(key))}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>`).join('')}</div>`;
  }
}
document.getElementById('patternTabs').addEventListener('click', event => {
  const button=event.target.closest('[data-pattern-kind]');if(!button)return;
  patternMode=button.dataset.patternKind;renderPatterns(resolvePeriod(),appState.summary);
  document.getElementById(`pattern-tab-${patternMode}`).focus();
});
document.getElementById('patternTabs').addEventListener('keydown', event => {
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=[...event.currentTarget.querySelectorAll('button')],index=buttons.findIndex(button=>button.dataset.patternKind===patternMode);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+buttons.length+(event.key==='ArrowLeft'?-1:1))%buttons.length;
  event.preventDefault();patternMode=buttons[next].dataset.patternKind;renderPatterns(resolvePeriod(),appState.summary);
  document.getElementById(`pattern-tab-${patternMode}`).focus();
});

function durationLines(milliseconds) {
  if (I18n.isEnglish()) return [Core.formatDuration(milliseconds, true)];
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
  const margin = { top: 18, right: 12, bottom: 42, left: 46 };
  const chartWidth = Math.max(1, width - margin.left - margin.right);
  const chartHeight = Math.max(1, height - margin.top - margin.bottom);
  const max = Math.max(1, ...days.filter(day => !day.future).map(day => day.durationMs / 3600000));
  const slot = chartWidth / Math.max(1, days.length);
  const pointAt = index => ({ x: margin.left + slot * (index + .5),
    y: margin.top + chartHeight * (1 - days[index].durationMs / 3600000 / max) });
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (let row = 0; row <= 4; row++) {
    const y = margin.top + chartHeight * row / 4;
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width-margin.right, y);
    ctx.strokeStyle = '#dce9e4'; ctx.stroke(); ctx.fillStyle = '#748a81';
    ctx.fillText(`${(max*(1-row/4)).toFixed(1)}h`, 3, y+3);
  }
  const labelEvery = Math.max(1, Math.ceil(days.length / (appState.periodType === 'weekly' ? 7 : 8)));
  days.forEach((day,index) => {
    const p = pointAt(index), bottom = margin.top + chartHeight;
    const barWidth = Math.max(1, Math.min(48, slot*.64));
    if(day.future || day.missing) {
      ctx.beginPath(); ctx.strokeStyle = '#9bafa5';
      ctx.setLineDash(day.future ? [2,3] : []);
      ctx.moveTo(p.x-barWidth/2,bottom-2); ctx.lineTo(p.x+barWidth/2,bottom-2); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = index === trend.hoverIndex ? '#477b68' : '#6f9f8e';
      ctx.fillRect(p.x-barWidth/2, p.y, barWidth, Math.max(2,bottom-p.y));
    }
    if(index%labelEvery===0 || index===days.length-1){
      let label = day.hour !== undefined ? String(day.hour).padStart(2,'0')+':00' : day.date.length===7 ? day.date.replace('-', '/') : day.date.slice(5).replace('-', '/');
      if(appState.periodType==='weekly')label = Core.parseDate(day.date).toLocaleDateString(I18n.localeTag(),{weekday:'short'})+' '+label;
      ctx.fillStyle = day.future ? '#a4b3ac' : '#748a81'; ctx.textAlign = 'center';
      ctx.fillText(label,p.x,height-12);
    }
  });
  ctx.textAlign = 'left';
  trend.layout = {margin,chartWidth,count:days.length,pointAt};
  if(trend.hoverIndex!==null && trend.hoverIndex<days.length)
    drawTrendMarker(ctx,pointAt(trend.hoverIndex),margin,chartHeight);
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
    if (I18n.isEnglish()) {
      return new Date(year, month - 1, 1).toLocaleDateString("en-US", { year: "numeric", month: "long" });
    }
    return `${year}年${month}月`;
  }
  const date = Core.parseDate(key);
  if (I18n.isEnglish()) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    return `${date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · ${weekday}`;
  }
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
  const title = formatBucketDate(bucket.date) + (bucket.hour !== undefined ? ` · ${String(bucket.hour).padStart(2,'0')}:00–${String(bucket.hour+1).padStart(2,'0')}:00` : '');
  const slices = topSlices(bucket.sites, TOOLTIP_SITE_LIMIT);
  const detail = slices.length
    ? `<ul class="tooltip-sites">${slices.map((slice) => `<li><span class="dot" style="background:${slice.color}"></span><span class="host" title="${escapeHtml(slice.host)}">${escapeHtml(slice.host)}</span><span class="time">${escapeHtml(displayDuration(slice.durationMs))}</span></li>`).join("")}</ul>`
    : `<div class="tooltip-empty">${bucket.date.length === 7 ? I18n.t("tooltipNoVisitsMonth") : I18n.t("tooltipNoVisitsDay")}</div>`;
  if (bucket.future || bucket.missing) {
    tooltip.innerHTML = `<div class="tooltip-date">${escapeHtml(title)}</div><div class="tooltip-empty">${escapeHtml(I18n.t(bucket.future ? 'patternFuture' : 'patternMissing'))}</div>`;
    tooltip.hidden = false; positionTooltipAtCursor(tooltip, canvas.parentElement, event); return;
  }
  tooltip.innerHTML = `<div class="tooltip-date">${escapeHtml(title)}</div>
    <div class="tooltip-total"><strong>${escapeHtml(displayDuration(bucket.durationMs))}</strong>${bucket.hour===undefined?`<span>${escapeHtml(I18n.t("tooltipVisits", I18n.formatNumber(bucket.visits)))}</span>`:''}</div>
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
  const index = Math.floor((x - layout.margin.left) / layout.chartWidth * layout.count);
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
    : `<div class="legend-row"><span></span><span>${escapeHtml(I18n.t("noData"))}</span><span>0%</span></div>`;
}

function updateDonutCenter(index) {
  const hoursEl = document.getElementById("donutHours");
  const labelEl = document.getElementById("donutLabel");
  if (index === null || !donut.layout?.slices[index]) {
    const total = donut.layout?.total ?? donut.sites.reduce((sum, site) => sum + site.durationMs, 0);
    hoursEl.innerHTML = durationLines(total).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
    labelEl.textContent = I18n.t("total");
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
          <td class="duration-cell">${escapeHtml(displayDuration(site.durationMs))}</td>
          <td><div class="share-cell"><div class="share-track"><span class="share-bar" style="width:${Math.max(2, share)}%;background:${color}"></span></div><div class="share-spacer"></div><span class="share-value">${share.toFixed(1)}%</span></div></td>
          <td class="visits-cell">${I18n.formatNumber(site.visits)}</td>
          <td><div class="visit-cell"><strong class="visit-title" title="${escapeHtml(site.title)}">${escapeHtml(site.title)}</strong><span class="site-url" title="${escapeHtml(site.url || "—")}">${escapeHtml(site.url || "—")}</span></div></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="empty">${escapeHtml(I18n.t("noMatchingData"))}</td></tr>`;
  document.getElementById("sitePageSummary").textContent = sites.length
    ? I18n.t("sitePageSummary", String(appState.sitePage), String(totalPages), I18n.formatNumber(sites.length))
    : I18n.t("sitePageEmpty");
  document.getElementById("previousSitePage").disabled = appState.sitePage <= 1;
  document.getElementById("nextSitePage").disabled = appState.sitePage >= totalPages;
}

function fillSettings() {
  const settings = appState.settings;
  const deviceName = document.getElementById("deviceName");
  if (deviceName && document.activeElement !== deviceName) deviceName.value = settings.deviceName || "";
  document.getElementById("uiLocale").value = settings.uiLocale || "auto";
  document.getElementById("idleThreshold").value = settings.idleThresholdSeconds || 60;
  document.getElementById("excludedHosts").value = (settings.excludedHosts || []).join("\n");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
function openTrendBucket(index) {
  const bucket = trend.days[index]; if (!bucket || bucket.future || bucket.hour !== undefined) return;
  appState.periodType = bucket.date.length === 7 ? 'monthly' : 'daily';
  appState.anchorDate = bucket.date.length === 7 ? bucket.date + '-01' : bucket.date;
  appState.sitePage = 1; document.getElementById('periodType').value = appState.periodType;
  renderOverview();
}
document.getElementById('trendChart').addEventListener('click', event => openTrendBucket(trendIndexAt(event.currentTarget,event.clientX)));
document.getElementById('trendChart').addEventListener('keydown', event => {
  if(event.key==='Enter'){event.preventDefault();openTrendBucket(trend.hoverIndex);return;}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!trend.days.length)return;
  event.preventDefault();
  const current=trend.hoverIndex??0;
  trend.hoverIndex=event.key==='Home'?0:event.key==='End'?trend.days.length-1:Math.max(0,Math.min(trend.days.length-1,current+(event.key==='ArrowLeft'?-1:1)));
  drawTrend(event.currentTarget,trend.days);
  const p=trend.layout.pointAt(trend.hoverIndex),rect=event.currentTarget.getBoundingClientRect();
  renderTrendTooltip(event.currentTarget,trend.days[trend.hoverIndex],{clientX:rect.left+p.x,clientY:rect.top+p.y});
});

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

document.getElementById("exportJson").addEventListener("click", async () => {
  const stored = await sendMessage({ type: "export-data" });
  if (!stored.ok) { showToast(stored.error || I18n.t("errBackgroundOperation"), true); return; }
  download(`timelens-backup-${Core.dateKey(new Date())}.json`, JSON.stringify({
    app: "timelens",
    exportedAt: new Date().toISOString(),
    schemaVersion: stored.schemaVersion || 1,
    dailyStats: stored.dailyStats || {},
    reports: stored.reports || [],
    settings: stored.settings || {}
  }, null, 2), "application/json");
  showToast(I18n.t("backupExported"));
});

async function importBackup(mode) {
  const file = document.getElementById("importFile").files[0];
  if (!file) return showToast(I18n.t("selectBackupFirst"), true);
  if (mode === "replace" && !confirm(I18n.t("confirmReplaceImport"))) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || !payload.dailyStats) throw new Error(I18n.t("invalidBackup"));
    await sendMessage({ type: "import-data", mode, payload });
    await loadState();
    showToast(mode === "replace" ? I18n.t("backupRestored") : I18n.t("backupMerged"));
    document.getElementById("importFile").value = "";
    renderImportFile();
  } catch (error) {
    showToast(I18n.t("importFailed", I18n.errorMessage(error, "invalidBackup")), true);
  }
}

function renderImportFile() {
  const file = document.getElementById("importFile").files[0];
  const label = document.getElementById("importFileName");
  label.textContent = file?.name || "";
  label.hidden = !file;
  label.title = file?.name || "";
  document.getElementById("importActions").hidden = !file;
}
document.getElementById("chooseImportFile").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", renderImportFile);

document.getElementById("mergeImport").addEventListener("click", () => importBackup("merge"));
document.getElementById("replaceImport").addEventListener("click", () => importBackup("replace"));
function confirmDataClear() {
  const dialog = document.getElementById("clearDataDialog");
  if (dialog.open) return Promise.resolve(false);
  const button = document.getElementById("clearDataConfirm");
  const readyAt = performance.now() + 5000;
  dialog.returnValue = "";
  const update = () => {
    const remaining = Math.max(0, Math.ceil((readyAt - performance.now()) / 1000));
    button.disabled = remaining > 0;
    button.textContent = remaining ? I18n.t("deleteConfirmWait", String(remaining)) : I18n.t("deleteConfirm");
  };
  const guard = (event) => {
    if (event.submitter === button && performance.now() < readyAt) event.preventDefault();
  };
  update();
  return new Promise((resolve) => {
    const timer = setInterval(update, 200);
    dialog.addEventListener("submit", guard);
    dialog.addEventListener("close", () => {
      clearInterval(timer);
      dialog.removeEventListener("submit", guard);
      resolve(dialog.returnValue === "confirm" && performance.now() >= readyAt);
    }, { once: true });
    dialog.showModal();
  });
}

document.getElementById("deleteAll").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!await confirmDataClear()) return;
  button.disabled = true;
  try {
    await sendMessage({ type: "delete-all-data" });
    await loadState();
    showToast(I18n.t("dataCleared"));
  } catch (error) { showToast(I18n.errorMessage(error), true); }
  finally { button.disabled = false; }
});

function readSettingsForm() {
  return {
    ...appState.settings,
    deviceName: document.getElementById("deviceName")?.value.trim() ?? appState.settings.deviceName ?? "",
    uiLocale: document.getElementById("uiLocale").value,
    idleThresholdSeconds: Math.min(3600, Math.max(15, Number(document.getElementById("idleThreshold").value) || 60)),
    excludedHosts: document.getElementById("excludedHosts").value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
  };
}

let settingsSaveTimer = null;
let settingsSaveInFlight = false;
let settingsSaveQueued = false;

async function saveSettingsAutomatically() {
  const form = document.getElementById("settingsForm");
  if (!form.checkValidity()) return;
  if (settingsSaveInFlight) {
    settingsSaveQueued = true;
    return;
  }

  const previousLocale = appState.settings?.uiLocale || "auto";
  const settings = readSettingsForm();
  settingsSaveInFlight = true;
  try {
    const response = await sendMessage({ type: "save-settings", settings });
    appState.settings = response.settings;
    await I18n.init(appState.settings);
    I18n.apply();
    renderImportFile();
    renderAppVersion();
    await renderCloud();
    await refreshDataView();
    await renderDevices();
    if ((previousLocale || "auto") !== (appState.settings.uiLocale || "auto")) {
      renderOverview();
    }
  } catch (error) {
    showToast(I18n.errorMessage(error), true);
  } finally {
    settingsSaveInFlight = false;
    if (settingsSaveQueued) {
      settingsSaveQueued = false;
      void saveSettingsAutomatically();
    }
  }
}

function scheduleSettingsSave(immediate = false) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => void saveSettingsAutomatically(), immediate ? 0 : 500);
}

const settingsForm = document.getElementById("settingsForm");
settingsForm.addEventListener("input", (event) => {
  if (event.target.matches(".device-name-input") && event.target.id !== "deviceName") return;
  const immediate = event.target.matches("select, input[type='checkbox'], input[type='radio']");
  scheduleSettingsSave(immediate);
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  scheduleSettingsSave(true);
});

let deferredStorageChanges = {};
function onStorageChanged(changes, area) {
  if (area !== "local") return;
  changes = Object.fromEntries(Object.entries(changes).filter(([name]) =>
    ["reports", "dailyStatsIndex", "cloudCache", "cloudDevices", "cloudAuth", "cloudStatus", "settings"].includes(name)));
  if (!Object.keys(changes).length) return;
  if (document.hidden) { Object.assign(deferredStorageChanges, changes); return; }
  if (changes.reports || changes.dailyStatsIndex || changes.cloudCache || changes.cloudDevices) void refreshDataView();
  if (changes.cloudCache || changes.cloudDevices || changes.cloudAuth) void renderDevices();
  if (changes.cloudStatus || changes.cloudAuth) void renderCloud();
  if (changes.settings) {
    appState.settings = changes.settings.newValue || {};
    if (!settingsSaveInFlight) {
      void I18n.init(appState.settings).then(() => {
        if (document.hidden) { onStorageChanged({ settings: changes.settings }, "local"); return; }
        I18n.apply(); renderImportFile(); renderAppVersion(); fillSettings(); void refreshDataView(); void renderDevices(); void renderCloud();
      });
    }
  }
}
chrome.storage.onChanged.addListener(onStorageChanged);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const pending = deferredStorageChanges;
  deferredStorageChanges = {};
  onStorageChanged(pending, "local");
  if (dataViewDirty) void refreshDataView();
});

loadState().catch((error) => showToast(I18n.t("loadFailed", I18n.errorMessage(error)), true));
