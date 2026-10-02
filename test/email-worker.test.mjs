import assert from "node:assert/strict";

import worker, { emailSubject, renderEmail } from "../email-worker/worker.js";

const report = {
  id: "weekly-2026-08-24",
  label: "Weekly report",
  device: { id: "760486a3-d546-45a5-b3e6-d684397481a8", name: "办公室电脑 <A&B>" },
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  totalMs: 3600000,
  totalVisits: 2,
  sites: [
    { host: "example.com", durationMs: 3600000, visits: 2, title: "Example", url: "https://example.com/" }
  ]
};

let resendPayload;
let resendHeaders;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  resendPayload = JSON.parse(options.body);
  resendHeaders = options.headers;
  return new Response(JSON.stringify({ id: "email-id" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

try {
  const response = await worker.fetch(new Request("https://worker.example.com/report", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ recipient: "owner@example.com", report, locale: "en", deliveryId: "delivery-test-123" })
  }), {
    BACKUP_SECRET: "test-secret",
    RESEND_API_KEY: "resend-key",
    REPORT_FROM_EMAIL: "Time Lens <report@example.com>"
  });

  assert.equal(response.status, 200);
  assert.equal(resendHeaders["Idempotency-Key"], "timelens/delivery-test-123");
  assert.ok(resendPayload.subject.startsWith(`[${report.device.name}] Time Lens`));
  assert.ok(resendPayload.html.includes("Device: 办公室电脑 &lt;A&amp;B&gt;"));
  assert.ok(resendPayload.html.includes(`Device ID: ${report.device.id}`));
  assert.equal(resendPayload.attachments.length, 1);
  assert.equal(resendPayload.attachments[0].filename, `timelens-${report.id}.json`);
  assert.deepEqual(JSON.parse(Buffer.from(resendPayload.attachments[0].content, "base64").toString("utf8")), report);
  assert.equal(resendPayload.attachments.some((attachment) => attachment.filename.endsWith(".csv")), false);
  assert.ok(emailSubject(report, "zh").startsWith(`[${report.device.name}] 时光镜`));
  assert.ok(renderEmail(report, "zh").includes("设备: 办公室电脑 &lt;A&amp;B&gt;"));
  const legacy = { ...report, device: undefined };
  assert.equal(emailSubject(legacy, "en"), "Time Lens Weekly report | 2026-08-24 — 2026-08-30");
  assert.equal(renderEmail(legacy, "en").includes("Device ID:"), false);
  const unnamed = { ...report, device: { id: "fallback-id", name: "" } };
  assert.ok(emailSubject(unnamed, "en").startsWith("[fallback-id]"));
  assert.ok(!emailSubject({ ...report, device: { name: "PC\r\nHeader" } }).includes("\n"));
  console.log("email-worker.test.mjs: all assertions passed");
} finally {
  globalThis.fetch = originalFetch;
}
