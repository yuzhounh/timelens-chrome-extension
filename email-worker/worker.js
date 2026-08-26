const RESEND_ENDPOINT = "https://api.resend.com/emails";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

    const authorization = request.headers.get("Authorization") || "";
    if (!env.BACKUP_SECRET || authorization !== `Bearer ${env.BACKUP_SECRET}`) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }
    if (!env.RESEND_API_KEY || !env.REPORT_FROM_EMAIL) {
      const missing = ["RESEND_API_KEY", "REPORT_FROM_EMAIL"].filter((name) => !env[name]);
      return json({ error: "Worker email environment variables are incomplete", missing }, 500, corsHeaders);
    }

    try {
      const payload = await request.json();
      const report = payload.report;
      if (!payload.recipient || !report?.periodStart || !Array.isArray(report.sites)) {
        return json({ error: "Invalid report payload" }, 400, corsHeaders);
      }

      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.REPORT_FROM_EMAIL,
          to: [payload.recipient],
          subject: `时光镜${report.label || "周期报告"}｜${report.periodStart} — ${report.periodEnd}`,
          html: renderEmail(report),
          attachments: [
            {
              filename: `timelens-${report.id}.csv`,
              content: toBase64(payload.csv || "")
            },
            {
              filename: `timelens-${report.id}.json`,
              content: toBase64(JSON.stringify(report, null, 2))
            }
          ]
        })
      });

      const resultText = await response.text();
      if (!response.ok) return json({ error: `Resend ${response.status}`, detail: resultText.slice(0, 500) }, 502, corsHeaders);
      return new Response(resultText, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (error) {
      return json({ error: error.message || "Unexpected error" }, 500, corsHeaders);
    }
  }
};

function json(value, status, extraHeaders) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...extraHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDuration(milliseconds) {
  const minutes = Math.round((Number(milliseconds) || 0) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

export function renderEmail(report) {
  const rows = report.sites.slice(0, 20).map((site, index) => `
    <tr>
      <td style="padding:12px 8px;border-top:1px solid #e5e9e2">${index + 1}. ${escapeHtml(site.host)}</td>
      <td style="padding:12px 8px;border-top:1px solid #e5e9e2;text-align:right">${formatDuration(site.durationMs)}</td>
      <td style="padding:12px 8px;border-top:1px solid #e5e9e2;text-align:right">${Number(site.visits || 0)}</td>
    </tr>`).join("");

  return `<!doctype html><html><body style="margin:0;padding:28px;background:#f3f5ef;color:#182019;font-family:'Microsoft YaHei','微软雅黑',sans-serif">
    <div style="max-width:680px;margin:auto;overflow:hidden;border:1px solid #dce2d8;border-radius:14px;background:#fff">
      <div style="padding:30px;color:#fff;background:#6f9f8e">
        <div style="font-size:12px;letter-spacing:2px;color:#e1f0eb">TIME LENS · 时光镜</div>
        <h1 style="margin:20px 0 8px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-size:30px">${escapeHtml(report.label || "周期报告")}</h1>
        <div style="color:#aebeb2">${escapeHtml(report.periodStart)} — ${escapeHtml(report.periodEnd)}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8faf6;border-collapse:collapse">
        <tr>
          <td style="width:33%;padding:22px 8px 22px 30px;vertical-align:top">
            <small style="color:#77847a">有效浏览</small>
            <strong style="display:block;margin-top:7px;font-size:18px;line-height:1.3">${formatDuration(report.totalMs)}</strong>
          </td>
          <td style="width:34%;padding:22px 8px;vertical-align:top">
            <small style="color:#77847a">访问次数</small>
            <strong style="display:block;margin-top:7px;font-size:18px;line-height:1.3">${Number(report.totalVisits || 0)}</strong>
          </td>
          <td style="width:33%;padding:22px 30px 22px 8px;vertical-align:top">
            <small style="color:#77847a">网站数量</small>
            <strong style="display:block;margin-top:7px;font-size:18px;line-height:1.3">${report.sites.length}</strong>
          </td>
        </tr>
      </table>
      <div style="padding:18px 30px 30px">
        <h2 style="font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-size:18px;font-weight:normal;margin:0 0 12px">访问最多的网站</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="padding:8px;text-align:left;color:#7b877e">网站</th><th style="padding:8px;text-align:right;color:#7b877e">时长</th><th style="padding:8px;text-align:right;color:#7b877e">次数</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="padding:30px;text-align:center;color:#7b877e">本周期暂无记录</td></tr>'}</tbody></table>
        <p style="margin:24px 0 0;color:#88938b;font-size:11px">完整数据已作为 CSV 和 JSON 附件随邮件发送。</p>
      </div>
    </div>
  </body></html>`;
}
