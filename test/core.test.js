require("../lib.js");
const assert = require("node:assert/strict");
const Core = global.TimeLensCore;

const stats = {
  "2026-08-01": {
    "example.com": { durationMs: 60 * 60000, visits: 2, title: "Example", url: "https://example.com" }
  },
  "2026-08-02": {
    "example.com": { durationMs: 30 * 60000, visits: 1, title: "Example", url: "https://example.com/a" },
    "openai.com": { durationMs: 45 * 60000, visits: 3, title: "OpenAI", url: "https://openai.com" }
  }
};

const summary = Core.aggregate(stats, "2026-08-01", "2026-08-03");
assert.equal(summary.totalMs, 135 * 60000);
assert.equal(summary.totalVisits, 6);
assert.equal(summary.sites[0].host, "example.com");
assert.equal(summary.days.length, 3);

const merged = Core.mergeDailyStats(stats, {
  "2026-08-02": {
    "openai.com": { durationMs: 15 * 60000, visits: 1, title: "OpenAI", url: "https://openai.com" }
  }
});
assert.equal(merged["2026-08-02"]["openai.com"].durationMs, 60 * 60000);
assert.equal(merged["2026-08-02"]["openai.com"].visits, 4);

const monthly = Core.rangeFor("monthly", 0, new Date(2026, 1, 10));
assert.deepEqual(monthly, { start: "2026-02-01", end: "2026-02-28" });

const daily = Core.rangeFor("daily", -1, new Date(2026, 7, 9));
assert.deepEqual(daily, { start: "2026-08-08", end: "2026-08-08" });

const weekly = Core.rangeFor("weekly", 0, new Date(2026, 7, 9));
assert.deepEqual(weekly, { start: "2026-08-03", end: "2026-08-09" });
assert.deepEqual(Core.rangeFor("weekly", -1, new Date(2026, 7, 9)), { start: "2026-07-27", end: "2026-08-02" });
assert.match(Core.periodLabel("weekly", weekly.start, weekly.end), /第32周/);

const quarterly = Core.rangeFor("quarterly", 0, new Date(2026, 7, 9));
assert.deepEqual(quarterly, { start: "2026-07-01", end: "2026-09-30" });
assert.equal(Core.periodLabel("quarterly", quarterly.start, quarterly.end), "2026年第3季度");

const report = Core.generateReport(stats, "monthly", "2026-08-01", "2026-08-31");
assert.equal(report.sites[0].host, "example.com");
assert.equal(Core.generateReport(stats, "weekly", weekly.start, weekly.end).label, "周报");
assert.equal(Core.normalizeDailyStats({ invalid: {} }).invalid, undefined);

console.log("core.test.js: all assertions passed");
