# Time Lens (时光镜) Privacy Policy

**Last updated:** August 26, 2026  
**Contact:** [GitHub Issues](https://github.com/yuzhounh/timelens-chrome-extension/issues)

---

## Summary

Time Lens is a **local-first** Chrome extension. By default, your browsing statistics are stored **only on your device**. We do not operate a central server that collects your browsing history.

---

## What data the extension collects

When you browse the web, the extension may record, **per website domain**:

| Data | Purpose |
|------|---------|
| Domain name (hostname) | Group statistics by website |
| Active browsing duration | Measure time spent on each site |
| Visit count | Count how often a site is opened |
| Page title and URL | Show “last visit” details in the dashboard |

### What is **not** collected by default

- Passwords, form inputs, or page content
- Data from Chrome internal pages (`chrome://`), extension pages, or local files
- Domains you add to the exclusion list in Settings

### “Active browsing” definition

Time is counted only when:

- The tab is in the **currently active window**
- The tab is **focused**
- Your computer is **not idle** (based on the idle threshold you configure)

---

## Where data is stored

| Storage | Contents |
|---------|----------|
| `chrome.storage.local` on your device | Daily visit statistics, generated reports, extension settings |
| `chrome.storage.session` | Temporary state for the current tracking session (cleared when the browser session ends) |

You can export all data as JSON from **Data Management**, or delete everything with **Delete data**.

---

## Permissions explained

| Permission | Why it is needed |
|------------|------------------|
| `storage` / `unlimitedStorage` | Save statistics and settings locally |
| `tabs` | Read the active tab URL and title to attribute time to a domain |
| `idle` | Pause tracking when you step away from the computer |
| `alarms` | Schedule periodic report generation |
| `<all_urls>` | Access tab URLs on regular http/https pages you visit |

---

## Optional email backup (user-configured)

If you enable **Email backup** in Settings, the extension sends periodic reports to an **email gateway URL that you provide** (for example, a self-hosted Cloudflare Worker included in this repository).

When enabled, the following may be transmitted **only to your configured gateway**:

- Report summary (period, totals, top sites)
- CSV and JSON attachments of the report

The extension **does not** embed email API keys. You control the gateway, recipient address, and access token.

We do **not** receive this data unless you configure a gateway we operate—which we do not provide as a hosted service.

---

## Third-party services

The extension itself does not include analytics or advertising SDKs.

If you configure an optional email gateway (e.g. Resend via Cloudflare Worker), that service’s privacy policy applies to emails sent through it.

---

## Data sharing

We do **not** sell, rent, or share your browsing data.

Data leaves your device only if **you**:

1. Export a backup file manually
2. Enable email backup to your own gateway
3. Use Chrome sync (if you sync extension storage—depends on your Chrome settings; this extension does not add separate cloud sync)

---

## Data retention & deletion

- Data is kept locally until you delete it or uninstall the extension
- Use **Delete data** in the dashboard to remove all statistics and reports
- Uninstalling the extension removes locally stored data associated with the extension (subject to Chrome’s behavior)

---

## Children’s privacy

Time Lens is not directed at children under 13, and we do not knowingly collect personal information from children.

---

## Changes to this policy

We may update this policy when the extension changes. The “Last updated” date at the top will reflect the latest version. Continued use after changes constitutes acceptance of the updated policy.

---

## Your rights

Because data stays on your device, you can access, export, or delete it at any time through the extension interface.

If you have questions, open an issue on GitHub or contact the developer through the Chrome Web Store listing.

---

## 中文摘要

时光镜默认**仅在本机**保存浏览统计，不上传至开发者服务器。扩展会读取您正在访问的网站域名、标题和 URL 以统计时长；可选的邮件备份功能仅在您自行配置网关后，将报告发送至您指定的邮箱。您可随时导出或删除全部数据。

完整中文说明见：[PRIVACY_zh-CN.md](./PRIVACY_zh-CN.md)
