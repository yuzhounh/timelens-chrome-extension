(function (root) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  function msg(key, ...substitutions) {
    try {
      const text = root.TimeLensI18n?.t?.(key, ...substitutions)
        || (typeof chrome !== "undefined" && chrome.i18n?.getMessage?.(key, substitutions.map(String)));
      if (text) return text;
    } catch {
      // Fall through to Chinese defaults used by node tests.
    }
    return null;
  }

  function isEnglish() {
    try {
      if (root.TimeLensI18n?.isEnglish) return root.TimeLensI18n.isEnglish();
      return typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.().toLowerCase().startsWith("en");
    } catch {
      return false;
    }
  }

  function formatMonthYear(date) {
    if (isEnglish()) {
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }

  function formatDayDate(date) {
    if (isEnglish()) {
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDate(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(key, amount) {
    const date = parseDate(key);
    date.setDate(date.getDate() + amount);
    return dateKey(date);
  }

  function enumerateDates(start, end) {
    const result = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      result.push(cursor);
    }
    return result;
  }

  function rangeFor(type, offset = 0, now = new Date()) {
    let start;
    let end;

    if (type === "daily") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      end = new Date(start);
    } else if (type === "weekly") {
      const mondayOffset = (now.getDay() + 6) % 7;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + offset * 7);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    } else if (type === "monthly") {
      start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    } else if (type === "quarterly") {
      const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), currentQuarterMonth + offset * 3, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
    } else if (type === "yearly") {
      start = new Date(now.getFullYear() + offset, 0, 1);
      end = new Date(start.getFullYear(), 11, 31);
    } else {
      throw new Error(msg("errUnknownReportType", type) || `未知报告类型：${type}`);
    }

    return { start: dateKey(start), end: dateKey(end) };
  }

  function labelForType(type) {
    const key = ({
      daily: "reportTypeDaily",
      weekly: "reportTypeWeekly",
      monthly: "reportTypeMonthly",
      quarterly: "reportTypeQuarterly",
      yearly: "reportTypeYearly"
    })[type];
    return (key && msg(key)) || ({ daily: "日报", weekly: "周报", monthly: "月报", quarterly: "季报", yearly: "年报" })[type] || type;
  }

  function isoWeekInfo(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = target.getDay() || 7;
    target.setDate(target.getDate() + 4 - day);
    const weekYear = target.getFullYear();
    const yearStart = new Date(weekYear, 0, 1);
    const week = Math.ceil((((target - yearStart) / DAY_MS) + 1) / 7);
    return { year: weekYear, week };
  }

  function periodLabel(type, start, end) {
    const startDate = parseDate(start);
    if (type === "daily") return formatDayDate(startDate);
    if (type === "weekly") {
      const info = isoWeekInfo(startDate);
      return msg("periodWeek", String(info.week), String(info.year), start, end)
        || `${info.year}年第${info.week}周 · ${start} — ${end}`;
    }
    if (type === "monthly") return formatMonthYear(startDate);
    if (type === "quarterly") {
      const quarter = Math.floor(startDate.getMonth() / 3) + 1;
      return msg("periodQuarter", String(quarter), String(startDate.getFullYear()))
        || `${startDate.getFullYear()}年第${quarter}季度`;
    }
    if (type === "yearly") return isEnglish() ? String(startDate.getFullYear()) : `${startDate.getFullYear()}年`;
    if (type === "all") return msg("periodAllTime", start, end) || `所有时间 · ${start} — ${end}`;
    return `${start} — ${end}`;
  }

  function aggregate(dailyStats = {}, start, end) {
    const sitesMap = new Map();
    const days = [];
    let totalMs = 0;
    let totalVisits = 0;

    for (const date of enumerateDates(start, end)) {
      const records = dailyStats[date] || {};
      let dayMs = 0;
      let dayVisits = 0;

      for (const [host, record] of Object.entries(records)) {
        const durationMs = Math.max(0, Number(record.durationMs) || 0);
        const visits = Math.max(0, Number(record.visits) || 0);
        dayMs += durationMs;
        dayVisits += visits;

        const previous = sitesMap.get(host) || {
          host,
          durationMs: 0,
          visits: 0,
          title: record.title || host,
          url: record.url || `https://${host}`
        };
        previous.durationMs += durationMs;
        previous.visits += visits;
        if (record.title) previous.title = record.title;
        if (record.url) previous.url = record.url;
        sitesMap.set(host, previous);
      }

      totalMs += dayMs;
      totalVisits += dayVisits;
      days.push({ date, durationMs: dayMs, visits: dayVisits });
    }

    const sites = [...sitesMap.values()].sort((a, b) => b.durationMs - a.durationMs);
    return { start, end, totalMs, totalVisits, sites, days };
  }

  function generateReport(dailyStats, type, start, end) {
    const summary = aggregate(dailyStats, start, end);
    return {
      id: `${type}-${start}-${end}`,
      type,
      label: labelForType(type),
      periodStart: start,
      periodEnd: end,
      generatedAt: new Date().toISOString(),
      ...summary
    };
  }

  function formatDuration(milliseconds, compact = false) {
    const minutes = Math.max(0, Math.round((Number(milliseconds) || 0) / 60000));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (compact) return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
    if (!hours) {
      return msg(compact ? "durationMinutes" : "durationMinutesLong", String(remainder))
        || `${remainder} 分钟`;
    }
    if (!remainder) {
      return msg(compact ? "durationHours" : "durationHoursLong", String(hours))
        || `${hours} 小时`;
    }
    return msg(compact ? "durationHoursMinutes" : "durationHoursMinutesLong", String(hours), String(remainder))
      || `${hours} 小时 ${remainder} 分钟`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function reportToCsv(report) {
    const rows = [
      [
        msg("csvHeaderWebsite") || "网站",
        msg("csvHeaderDuration") || "访问时长（分钟）",
        msg("csvHeaderVisits") || "访问次数",
        msg("csvHeaderTitle") || "最近标题",
        msg("csvHeaderUrl") || "最近网址"
      ],
      ...report.sites.map((site) => [
        site.host,
        Math.round(site.durationMs / 60000),
        site.visits,
        site.title,
        site.url
      ])
    ];
    return "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  function normalizeDailyStats(value) {
    const output = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return output;
    for (const [date, sites] of Object.entries(value)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !sites || typeof sites !== "object") continue;
      output[date] = {};
      for (const [host, record] of Object.entries(sites)) {
        if (!host || !record || typeof record !== "object") continue;
        output[date][host] = {
          durationMs: Math.max(0, Number(record.durationMs) || 0),
          visits: Math.max(0, Math.floor(Number(record.visits) || 0)),
          title: String(record.title || host).slice(0, 500),
          url: String(record.url || `https://${host}`).slice(0, 2000)
        };
      }
    }
    return output;
  }

  function mergeDailyStats(base, incoming) {
    const result = normalizeDailyStats(base);
    const cleanIncoming = normalizeDailyStats(incoming);
    for (const [date, sites] of Object.entries(cleanIncoming)) {
      result[date] ||= {};
      for (const [host, record] of Object.entries(sites)) {
        const previous = result[date][host];
        result[date][host] = previous
          ? {
              durationMs: previous.durationMs + record.durationMs,
              visits: previous.visits + record.visits,
              title: record.title || previous.title,
              url: record.url || previous.url
            }
          : record;
      }
    }
    return result;
  }

  root.TimeLensCore = {
    DAY_MS,
    dateKey,
    parseDate,
    addDays,
    enumerateDates,
    rangeFor,
    labelForType,
    isoWeekInfo,
    periodLabel,
    aggregate,
    generateReport,
    formatDuration,
    reportToCsv,
    normalizeDailyStats,
    mergeDailyStats
  };
})(typeof self !== "undefined" ? self : globalThis);
