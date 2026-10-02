const assert = require("node:assert/strict");
const { shared, startWorker, waitFor } = require("./service-worker-lifecycle.test.js");

const requests = [];
const timeouts = [];
let mode = "hang";
let release;
const fetchMock = async (url, options) => {
  if (url.startsWith("chrome-extension://")) return { ok: false };
  const payload = JSON.parse(options.body);
  assert.ok(shared.local.reports.some((report) => report.id === payload.report.id), "save before sending");
  requests.push(payload);
  if (mode === "fail") return { ok: false, status: 503, text: async () => "unavailable" };
  return new Promise((resolve, reject) => {
    release = () => resolve({ ok: true, text: async () => "sent" });
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
};
const workerOptions = {
  fetch: fetchMock,
  setTimeout(callback, ms) {
    assert.equal(ms, 15000);
    timeouts.push(callback);
    return callback;
  },
  clearTimeout() {}
};
async function send(worker, message) {
  let response;
  worker.chrome.runtime.onMessage.listeners[0](message, {}, (value) => { response = value; });
  await waitFor(() => response, `blocked message: ${message.type}`);
  assert.equal(response.ok, true, response.error);
  return response;
}

(async () => {
  let worker = startWorker(workerOptions);
  await send(worker, { type: "save-settings", settings: {
    deviceName: "Office", email: { enabled: true, endpoint: "https://gateway.example/report", recipient: "me@example.com" }
  } });
  const message = { type: "generate-report", reportType: "weekly", sendEmail: true };
  const generated = await send(worker, message);
  const reportId = generated.report.id;
  assert.equal(generated.report.status, "queued");
  await waitFor(() => requests.length === 1, "email not started");

  // The exact former regression: a hanging fetch must not stall tracking/messages.
  shared.session.activeSession.startedAt -= 65000;
  const summary = await send(worker, { type: "get-summary" });
  assert.ok(summary.summary.totalMs >= 65000);
  await send(worker, message);
  assert.equal(requests.length, 1, "same pending report must not be sent twice");
  assert.equal(shared.local.reports.filter((r) => r.id === reportId).length, 1);
  timeouts.shift()();
  await worker.kickEmailQueue();
  const first = shared.local.reports.find((r) => r.id === reportId);
  assert.equal(first.status, "queued");
  assert.equal(first.emailJob.attempts, 1);
  assert.ok(first.emailJob.nextAttemptAt > Date.now());

  // Retry from persisted state after worker restart, keeping an identical payload/key.
  mode = "fail";
  first.emailJob.nextAttemptAt = 0;
  worker = startWorker(workerOptions);
  await waitFor(() => requests.length === 2, "restart did not recover pending email");
  await worker.kickEmailQueue();
  assert.deepEqual(requests[1], requests[0]);
  shared.local.reports.find((r) => r.id === reportId).emailJob.nextAttemptAt = 0;
  await worker.kickEmailQueue();
  assert.equal(requests.length, 3);
  assert.equal(shared.local.reports.find((r) => r.id === reportId).status, "failed");
  await worker.kickEmailQueue();
  assert.equal(requests.length, 3, "retry limit must stop further requests");

  // An in-flight completion must not resurrect a deleted report.
  mode = "hang";
  const monthly = await send(worker, { ...message, reportType: "monthly" });
  await waitFor(() => requests.length === 4, "monthly email not started");
  await send(worker, { type: "delete-report", reportId: monthly.report.id });
  release();
  await worker.kickEmailQueue();
  assert.equal(shared.local.reports.some((r) => r.id === monthly.report.id), false);

  // Never replay an uncertain delivery outside the provider's deduplication window.
  const expired = shared.local.reports.find((r) => r.id === reportId);
  expired.status = "queued";
  expired.emailJob.attempts = 1;
  expired.emailJob.nextAttemptAt = 0;
  expired.emailJob.expiresAt = 0;
  await worker.kickEmailQueue();
  assert.equal(requests.length, 4);
  assert.equal(shared.local.reports.find((r) => r.id === reportId).status, "failed");

  await send(worker, { type: "import-data", mode: "replace", payload: {
    dailyStats: {}, reports: [{ ...generated.report, status: "queued" }]
  } });
  await worker.kickEmailQueue();
  assert.equal(shared.local.reports[0].emailJob, undefined);
  assert.equal(shared.local.reports[0].status, "not-requested");
  assert.equal(requests.length, 4, "importing an archive must never send email");
  console.log("email-queue.test.js: all assertions passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
