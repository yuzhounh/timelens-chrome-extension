# Chrome Web Store Listing Copy

Use the sections below when submitting **Time Lens / 时光镜** to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

**Privacy policy URL (recommended):**  
`https://github.com/yuzhounh/timelens-chrome-extension/blob/main/docs/PRIVACY.md`

**Category:** Productivity  
**Language:** English (primary listing) + Chinese supported in extension UI

---

## English

### Extension name
**Time Lens · Website Tracker**

### Short description (132 chars max)
Track active browsing time by website. Local-first stats, charts, CSV/JSON export, and optional email reports.

### Detailed description

**Where does your time go?**

Time Lens helps you understand how you spend time on the web—without sending your data to our servers.

**Local-first by design**  
All visit statistics are stored on your device by default. No account required. No ads. No analytics SDKs.

**Smart active tracking**  
Time is counted only when a tab is focused in the active window and your computer is not idle. Switch tabs, minimize the browser, or walk away—and tracking pauses automatically.

**Beautiful dashboard**  
- Daily, weekly, monthly, quarterly, yearly, and all-time views  
- Trend charts and donut breakdown by website  
- Searchable site ranking with duration, share, and visit counts  
- Navigate to any date and browse historical periods

**Reports & export**  
- Generate weekly, monthly, quarterly, or yearly reports  
- Export CSV or JSON anytime  
- Full backup import/export (merge or replace)  
- Optional automatic reports at period end

**Optional email backup**  
Send HTML reports with CSV/JSON attachments through **your own** secure email gateway. API keys stay on your server—not in the extension.

**You stay in control**  
Exclude domains, adjust idle threshold, delete all data, or uninstall anytime.

---

### Single-purpose description (if asked)
This extension tracks how much active time the user spends on each website they visit in Chrome.

---

### Permission justifications (for review form)

| Permission | Justification |
|------------|---------------|
| **tabs** | Read the active tab’s URL and title to attribute browsing time to a website domain. |
| **storage / unlimitedStorage** | Persist visit statistics, settings, and generated reports locally on the user’s device. |
| **idle** | Detect when the user is away from the computer and pause time tracking. |
| **alarms** | Schedule automatic periodic report generation after each week/month/quarter/year ends. |
| **host permission (all URLs)** | Access URLs of regular http/https pages the user visits so statistics can be grouped by domain. Internal Chrome pages and extension pages are excluded. |

---

### Suggested screenshots (1280×800 or 640×400)

1. **Overview dashboard** — metrics, trend chart, donut chart (the screenshot you already have)  
2. **Site ranking table** — top websites with duration and visit counts  
3. **Periodic reports** — report cards with CSV/JSON export  
4. **Settings** — idle threshold, exclusions, optional email backup  
5. **Popup** — today’s total and top 5 sites

---

## 中文

### 扩展名称
**时光镜 · 网站访问统计**

### 简短说明（132 字以内）
统计有效网站访问时间，本地保存。提供趋势图表、CSV/JSON 导出与可选邮件周期报告。

### 详细说明

**时间都去了哪里？**

时光镜帮你了解自己在网上的时间分布——默认不上传数据到任何服务器。

**本地优先**  
所有访问统计默认只保存在本机。无需账号，无广告，无分析 SDK。

**有效访问计时**  
仅在标签页处于当前窗口焦点、且电脑非空闲时累计时长。切换标签、最小化或离开电脑会自动暂停。

**可视化仪表盘**  
- 按日、周、月、季度、年或所有时间查看  
- 趋势图与网站时间分布环图  
- 可搜索的网站排行（时长、占比、访问次数）  
- 跳转到任意日期，翻阅历史周期

**报告与导出**  
- 手动或自动生成周报、月报、季报、年报  
- 随时导出 CSV / JSON  
- 完整 JSON 备份的导入、合并与替换  
- 周期结束后可自动生成上一份报告

**可选邮件备份**  
通过**您自己的**安全邮件网关发送 HTML 报告及 CSV/JSON 附件，API 密钥保存在服务端。

**您完全掌控**  
排除指定网站、调整空闲阈值、一键清除数据，随时卸载。

---

### 单一用途说明
本扩展用于统计用户在 Chrome 中访问各网站的有效浏览时长。

---

## Store checklist before upload

- [ ] Register Chrome Web Store developer account ($5 one-time)  
- [ ] Upload zip built with `node scripts/package-store.mjs`  
- [ ] Add 128×128 icon (`icons/timer-128.png`)  
- [ ] Add at least 1 screenshot (1280×800 recommended)  
- [ ] Paste privacy policy URL  
- [ ] Fill permission justifications  
- [ ] Set visibility to Public or Unlisted for testing  

---

## Zip package notes

The store zip must contain `manifest.json` at the **root** (not inside a subfolder).

Included: extension runtime files + `_locales/`  
Excluded: `email-worker/`, `test/`, `docs/`, `.git`, dev scripts

Run validation:

```powershell
node scripts/package-store.mjs
```

This creates `release/timelens-chrome-extension-store.zip` and prints a compliance report.
