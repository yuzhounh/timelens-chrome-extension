import assert from "node:assert/strict";

import worker from "../email-worker/worker.js";

const report = {
  id: "weekly-2026-08-24",
  label: "Weekly report",
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  totalMs: 3600000,
  totalVisits: 2,
  sites: [
    { host: "example.com", durationMs: 3600000, visits: 2, title: "Example", url: "https://example.com/" }
  ]
};

let resendPayload;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  resendPayload = JSON.parse(options.body);
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
    body: JSON.stringify({ recipient: "owner@example.com", report, locale: "en" })
  }), {
    BACKUP_SECRET: "test-secret",
    RESEND_API_KEY: "resend-key",
    REPORT_FROM_EMAIL: "Time Lens <report@example.com>"
  });

  assert.equal(response.status, 200);
  assert.equal(resendPayload.attachments.length, 1);
  assert.equal(resendPayload.attachments[0].filename, `timelens-${report.id}.json`);
  assert.deepEqual(JSON.parse(Buffer.from(resendPayload.attachments[0].content, "base64").toString("utf8")), report);
  assert.equal(resendPayload.attachments.some((attachment) => attachment.filename.endsWith(".csv")), false);
  console.log("email-worker.test.mjs: all assertions passed");
} finally {
  globalThis.fetch = originalFetch;
}
