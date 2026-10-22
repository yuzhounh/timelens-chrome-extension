(function (root) {
  "use strict";
  const INDEX = "dailyStatsIndex";
  const PENDING = "dailyStatsPending";
  const PREFIX = "dailyStats:v2:";
  const local = () => chrome.storage.local;
  const key = (date, spec) => `${PREFIX}${date}:${spec.hash}`;
  const valid = (index) => index?.version === 2 && index.days && typeof index.days === "object";
  const managedKey = (value) => /^dailyStats:v2:\d{4}-\d{2}-\d{2}:[a-f0-9]{32}$/.test(value);
  let migration = null;

  async function describe(sites) {
    const chunks = root.TimeLensSyncCore.chunks(sites);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chunks.join(""))));
    return { hash: Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").slice(0, 32), count: chunks.length };
  }

  async function recover(index, pending) {
    if (!pending) return;
    const keep = new Set(Object.entries(index?.days || {}).map(([date, spec]) => key(date, spec)));
    const discarded = [...(pending.staged || []), ...(pending.obsolete || [])].filter(k => managedKey(k) && !keep.has(k));
    if (discarded.length) await local().remove(discarded);
    await local().remove(PENDING);
  }

  async function publish(previous, days, extra, verify = false) {
    const next = { version: 2, generation: (previous?.generation || 0) + 1, days: {} };
    const values = {};
    for (const [date, sites] of Object.entries(days)) {
      const spec = await describe(sites);
      next.days[date] = spec;
      if (previous?.days?.[date]?.hash !== spec.hash) values[key(date, spec)] = sites;
    }
    const keep = new Set(Object.entries(next.days).map(([date, spec]) => key(date, spec)));
    const obsolete = Object.entries(previous?.days || {}).map(([date, spec]) => key(date, spec)).filter(k => !keep.has(k));
    await local().set({ [PENDING]: { staged: Object.keys(values), obsolete } });
    if (Object.keys(values).length) await local().set(values);
    if (verify) {
      const stored = await local().get(Object.keys(values));
      for (const [name, value] of Object.entries(values)) {
        if (JSON.stringify(stored[name]) !== JSON.stringify(value)) throw new Error("Historical statistics migration verification failed");
      }
    }
    await local().set({ [INDEX]: next, ...extra });
    // Cleanup cannot turn a committed activity write into a reported failure and a duplicate retry.
    try {
      if (obsolete.length) await local().remove(obsolete);
      await local().remove([PENDING, "dailyStats"]);
    } catch { /* The next writer recovers only unreferenced, managed keys. */ }
    return next;
  }

  async function initialize() {
    if (!migration) migration = (async () => {
      const stored = await local().get([INDEX, PENDING, "dailyStats"]);
      const index = valid(stored[INDEX]) ? stored[INDEX] : null;
      await recover(index, stored[PENDING]);
      if (index) return index;
      return publish(null, root.TimeLensCore.normalizeDailyStats(stored.dailyStats), {}, true);
    })().catch(error => { migration = null; throw error; });
    await migration;
    const stored = await local().get([INDEX, PENDING]);
    await recover(stored[INDEX], stored[PENDING]);
    return stored[INDEX];
  }

  async function readIndexDays(index, dates) {
    const wanted = dates.filter(date => index.days[date]);
    const values = await local().get(wanted.map(date => key(date, index.days[date])));
    const result = {};
    for (const date of wanted) {
      const value = values[key(date, index.days[date])];
      if (!value || typeof value !== "object") throw new Error("Statistics index changed or a day is unavailable");
      result[date] = value;
    }
    return result;
  }

  async function read({ dates, start, end } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await local().get(INDEX);
      const index = stored[INDEX];
      if (!valid(index)) {
        const legacy = root.TimeLensCore.normalizeDailyStats((await local().get("dailyStats")).dailyStats);
        return Object.fromEntries(Object.entries(legacy).filter(([date]) => (!dates || dates.includes(date)) && (!start || date >= start) && (!end || date <= end)));
      }
      const selected = (dates || Object.keys(index.days)).filter(date => (!start || date >= start) && (!end || date <= end));
      try { return await readIndexDays(index, selected); }
      catch (error) {
        const current = (await local().get(INDEX))[INDEX];
        if (current?.generation === index.generation || attempt === 2) throw error;
      }
    }
  }

  // All writers run under the background's existing operation queue.
  async function writeDays(patch, extra = {}) {
    const previous = await initialize();
    const clean = root.TimeLensCore.normalizeDailyStats(patch);
    const next = { version: 2, generation: previous.generation + 1, days: { ...previous.days } };
    const values = {}, obsolete = [];
    for (const [date, sites] of Object.entries(clean)) {
      const spec = await describe(sites);
      if (previous.days[date]?.hash === spec.hash) continue;
      values[key(date, spec)] = sites;
      if (previous.days[date]) obsolete.push(key(date, previous.days[date]));
      next.days[date] = spec;
    }
    if (!Object.keys(values).length) { if (Object.keys(extra).length) await local().set(extra); return previous; }
    await local().set({ [PENDING]: { staged: Object.keys(values), obsolete } });
    await local().set(values);
    await local().set({ [INDEX]: next, ...extra });
    try { await local().remove([...obsolete, PENDING]); } catch { /* recover before the next write */ }
    return next;
  }

  async function replaceAll(days, extra = {}) {
    const previous = await initialize();
    return publish(previous, root.TimeLensCore.normalizeDailyStats(days), extra);
  }

  async function changedSnapshot(previous = {}) {
    const index = await initialize();
    const dates = Object.keys(index.days).filter(date => previous[date]?.hash !== index.days[date].hash || previous[date]?.count !== index.days[date].count);
    return { index, dailyStats: await readIndexDays(index, dates) };
  }

  root.TimeLensStats = { INDEX, initialize, read, writeDays, replaceAll, changedSnapshot };
})(typeof self === "undefined" ? globalThis : self);
