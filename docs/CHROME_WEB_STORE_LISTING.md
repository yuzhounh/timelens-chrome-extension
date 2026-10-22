# Chrome Web Store Listing Copy

Local copy for 2.1.1. This wording describes the current daily version; it has not been submitted to the Chrome Web Store.

## English

### Extension name
Time Lens · Website Tracker

### Short description
Website time tracking and charts with automatic Google account sync across devices, offline tracking, and JSON backups.

### Detailed description
Time Lens tracks active browsing time by website and synchronizes your devices through your Google account.

- Sign in with the same Google account on each device to sync statistics and shared settings automatically through Firebase.
- Track only the focused tab while the computer is active; tracking continues offline and changes upload when connectivity returns.
- View trends, website rankings and time distribution by day, week, month, quarter, year or all time.
- Switch between all devices and this device in Overview.
- Export this device’s JSON backup, or merge and restore a backup.
- Set website exclusions, an idle threshold, a device name and the interface language.
- Clear this device’s records with a countdown confirmation. This change syncs to the cloud; other devices’ records remain.

Google sign-in is required for cloud sync. The extension stores records and caches on the device for offline use. No ads or analytics SDKs. Periodic report generation and email backup are retired in the current version.

## 中文

### 扩展名称
时光镜 · 网站访问统计

### 简短说明
网站访问计时与可视化，通过 Google 账户自动同步多台设备，支持离线计时和 JSON 备份。

### 详细说明
时光镜按网站统计有效浏览时间，通过 Google 账户在多台设备之间同步记录。

- 在各设备登录同一 Google 账户，通过 Firebase 自动同步统计和通用设置。
- 仅在当前标签页获得焦点、电脑非空闲时计时；离线继续记录，联网后自动补传。
- 按日、周、月、季度、年或所有时间查看趋势、网站排行与时间分布。
- 在概览中切换所有设备或仅本机。
- 导出本机 JSON 备份，或合并、恢复备份。
- 配置排除网站、空闲阈值、设备名称和界面语言。
- 清除本机记录需要倒计时确认；清除操作同步到云端，其他设备记录保留。

云端同步需要先登录 Google。本机保存记录与缓存，以支持离线使用。无广告、无分析 SDK；当前版本已停用周期报告生成与邮件备份。

## Maintenance note

This file is a local wording draft, not a publication instruction. Any future store submission needs disclosures matching the actual Firebase authentication and synchronization flow, current permissions, and the published privacy policy.

## Historical release records

The following release notes and packaging notes describe earlier published versions.

## Release notes — 1.6.10

- Update extension and email gateway version metadata to 1.6.10; runtime behavior is unchanged.

## Previous release — 1.6.9

- Name each browser profile to identify its reports in email subjects, messages and JSON attachments.
- Save reports before sending email, so a slow gateway never blocks browsing-time collection.
- Recover pending email after background restarts, with request timeouts, bounded retries and delivery deduplication.
- Keep archived report device names unchanged and prevent imported backups from sending email.

## Previous release — 1.6.8

- Settings now save and apply automatically; the manual save button was removed.
- Updated interface-language labels in Chinese and English.
- Report downloads and email attachments now use JSON only.
- Improved bilingual store-submission and privacy guidance.

---

## Store checklist before upload

- [ ] Enable 2-Step Verification on the publishing Google account
- [ ] Register Chrome Web Store developer account ($5 one-time)  
- [ ] Verify the publisher contact email
- [ ] Upload zip built with `node scripts/package-store.mjs`  
- [ ] Add 128×128 icon (`icons/timer-128.png`)  
- [ ] Add at least 1 screenshot (1280×800 recommended)  
- [ ] Add a 440×280 small promotional image
- [ ] Paste privacy policy URL  
- [ ] Fill permission justifications  
- [ ] Declare that no remote code is used and complete data-use disclosures
- [ ] Paste the reviewer test instructions above
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
