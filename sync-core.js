(function (root) {
  "use strict";
  // Own records remain separate from downloaded records: syncing is replacement,
  // while summation happens only when presenting different devices.
  function stats(own, cache, scope = "all") {
    if (scope !== "all" && scope !== "local") return root.TimeLensCore.normalizeDailyStats(cache?.[scope]?.dailyStats);
    let result = root.TimeLensCore.normalizeDailyStats(own);
    if (scope === "all") for (const device of Object.values(cache || {})) {
      result = root.TimeLensCore.mergeDailyStats(result, device.dailyStats);
    }
    return result;
  }
  function freezeDay(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeDay);
      Object.freeze(value);
    }
    return value;
  }
  // One dashboard owns this cache; unchanged immutable local days/cloud hashes reuse their rollup.
  function createStatsView() {
    let previous = new Map();
    return (own, cache, scope = "all", deviceId) => {
      const sources = scope === "local" ? [["local", own]] : scope === "all"
        ? [["local", own], ...Object.entries(cache || {}).map(([id, device]) => [id, device.dailyStats, device.manifest])]
        : [[scope, cache?.[scope]?.dailyStats, cache?.[scope]?.manifest]];
      const result = {}, next = new Map();
      for (const date of new Set(sources.flatMap(([, days]) => Object.keys(days || {})))) {
        const tokens = sources.map(([id, days, manifest]) => [id, days?.[date] && (manifest?.days?.[date]?.hash || days[date])]);
        const hit = previous.get(date);
        const unchanged = hit && hit.scope === scope && hit.deviceId === deviceId && hit.tokens.length === tokens.length &&
          tokens.every(([id, token], i) => hit.tokens[i][0] === id && hit.tokens[i][1] === token);
        let value = hit?.value;
        if (!unchanged) {
          const cloudDays = Object.fromEntries(Object.entries(cache || {}).map(([id, device]) => [id, { dailyStats: { [date]: device.dailyStats?.[date] } }]));
          value = freezeDay(stats({ [date]: own?.[date] }, cloudDays, scope)[date]);
        }
        if (value !== undefined) result[date] = value;
        next.set(date, { scope, deviceId, tokens, value });
      }
      previous = next;
      return result;
    };
  }
  function reports(own, cache, scope = "all") {
    const result = [...(own || [])];
    if (scope === "all") for (const [deviceId, device] of Object.entries(cache || {})) {
      for (const report of device.reports || []) result.push({
        ...report, id: `${deviceId}:${report.id}`, cloudReadOnly: true,
        status: report.status === "queued" ? "not-requested" : report.status
      });
    }
    return result.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  }
  function sharedSettings(settings = {}) {
    const { deviceName, email, schedules, ...shared } = settings;
    return shared;
  }
  function archiveReports(reports = []) {
    return reports.map(({ emailJob, ...report }) => ({
      ...report, status: report.status === "queued" ? "not-requested" : report.status
    }));
  }
  // Bound document size without splitting a UTF-16 surrogate pair.
  function chunks(value, size = 150000) {
    const json = JSON.stringify(value);
    const result = [];
    for (let start = 0; start < json.length;) {
      let end = Math.min(json.length, start + size);
      if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
      result.push(json.slice(start, end));
      start = end;
    }
    return result;
  }
  root.TimeLensSyncCore = { stats, createStatsView, reports, sharedSettings, archiveReports, chunks };
})(typeof self === "undefined" ? globalThis : self);
