import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { renderEmail } from "./worker.js";

const sampleReport = {
  id: "weekly-2026-08-17",
  label: "周报",
  periodStart: "2026-08-17",
  periodEnd: "2026-08-23",
  totalMs: (44 * 60 + 30) * 60000,
  totalVisits: 680,
  sites: [
    { host: "zhihu.com", durationMs: (8 * 60 + 40) * 60000, visits: 661 },
    { host: "127.0.0.1", durationMs: (7 * 60 + 48) * 60000, visits: 424 },
    { host: "localhost", durationMs: (6 * 60 + 23) * 60000, visits: 547 }
  ]
};

const html = renderEmail(sampleReport);
const outputPath = join(dirname(fileURLToPath(import.meta.url)), "preview.html");
writeFileSync(outputPath, html, "utf8");

const port = 8765;
createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(port, () => {
  console.log(`邮件预览已生成: ${outputPath}`);
  console.log(`本地预览地址: http://127.0.0.1:${port}`);
});
