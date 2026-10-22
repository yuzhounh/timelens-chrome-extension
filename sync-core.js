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
  root.TimeLensSyncCore = { stats, reports, sharedSettings, archiveReports, chunks };
})(typeof self === "undefined" ? globalThis : self);
