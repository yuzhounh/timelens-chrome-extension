import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { renderEmail } from "./worker.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

const sampleReport = {
  id: "weekly-2026-08-17",
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

const previews = {
  zh: {
    file: "preview.html",
    html: renderEmail({ ...sampleReport, label: "周报" }, "zh")
  },
  en: {
    file: "preview-en.html",
    html: renderEmail({ ...sampleReport, label: "Weekly report" }, "en")
  }
};

for (const { file, html } of Object.values(previews)) {
  writeFileSync(join(baseDir, file), html, "utf8");
}

const port = 8765;
createServer((request, response) => {
  const path = request.url?.split("?")[0] || "/";
  const locale = path === "/en" ? "en" : "zh";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(previews[locale].html);
}).listen(port, () => {
  console.log(`中文预览: ${join(baseDir, previews.zh.file)}`);
  console.log(`英文预览: ${join(baseDir, previews.en.file)}`);
  console.log(`本地预览地址:`);
  console.log(`  中文  http://127.0.0.1:${port}/`);
  console.log(`  英文  http://127.0.0.1:${port}/en`);
});
