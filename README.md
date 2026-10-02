<p align="center">
  <img src="icons/timer.svg" width="112" alt="Time Lens · 时光镜 logo">
</p>

<h1 align="center">Time Lens · 时光镜</h1>

<p align="center"><strong>本地优先的网站访问计时、可视化与周期报告。</strong></p>

<p align="center">
  <a href="https://github.com/yuzhounh/timelens-chrome-extension/releases/latest"><img src="https://img.shields.io/github/v/release/yuzhounh/timelens-chrome-extension?style=flat&amp;color=0969da&amp;label=Release" alt="Latest stable release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=flat" alt="License: MIT"></a>
  <a href="https://chromewebstore.google.com/detail/idihkkiapagakajacljibnpekkfpiacm"><img src="https://img.shields.io/badge/Platform-Chrome%20MV3-4285f4?style=flat&amp;logo=googlechrome&amp;logoColor=white" alt="Platform: Chrome MV3"></a>
  <img src="https://img.shields.io/badge/JavaScript-Browser-f7df1e?style=flat&amp;logo=javascript&amp;logoColor=white" alt="JavaScript: Browser">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/idihkkiapagakajacljibnpekkfpiacm">安装扩展</a> · <a href="https://github.com/yuzhounh/timelens-chrome-extension/releases/latest">下载发布版</a> · <a href="#快速开始">快速开始</a> · <a href="LICENSE">开源协议</a>
</p>

一个本地优先的 Chrome Manifest V3 扩展。它只累计“当前窗口中激活的网页”且电脑处于非空闲状态时的访问时间，并按网站域名汇总。

## 功能特点

- 有效访问计时：切换标签、切换窗口或电脑空闲时自动暂停
- 今日弹窗：快速查看今日总时长和前五网站
- 可视化仪表盘：按日、周、月、季度、年或所有时间查看趋势、占比和网站排行
- 历史追溯：选择任意日期后定位到它所在的周、月、季度或年份，并可前后翻页
- JSON 完整备份的导入、合并与替换恢复
- 单个周期报告 JSON 下载
- 本周、本月、本季度、本年度报告手动生成
- 周末、月末、季末、年末自动生成上一周期报告并保存在本地
- 通过安全邮件网关自动发送 HTML 报告及 JSON 附件
- 排除指定网站、调整空闲阈值、独立开关各类自动报告

## 快速开始

先下载并解压仓库 ZIP，或运行 `git clone https://github.com/yuzhounh/timelens-chrome-extension.git` 获取代码。

1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录。
5. 正常浏览几分钟，点击工具栏中的“时光镜”查看今日数据，或按 `Ctrl+Shift+Y` 打开完整仪表盘。

插件需要读取标签页 URL 才能按域名统计，并需要访问配置的邮件网关；所有记录默认保存在 `chrome.storage.local`，不会主动上传。Chrome 内部页、扩展页和本地文件不会被统计。

## 配置邮件自动备份

浏览器扩展不应直接保存 Resend、SendGrid 或邮箱 SMTP 密钥。本项目提供了一个无第三方依赖的 Cloudflare Worker 示例，将真正的邮件 API 密钥保留在服务端。

1. 准备一个 [Resend](https://resend.com/) 账号并验证发件域名。
2. 进入 `email-worker` 目录，登录并部署：

   ```powershell
   npx wrangler login
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put BACKUP_SECRET
   npx wrangler secret put REPORT_FROM_EMAIL
   npx wrangler deploy
   ```

   - `RESEND_API_KEY`：Resend API 密钥。
   - `BACKUP_SECRET`：自行生成的一段长随机字符串。
   - `REPORT_FROM_EMAIL`：已验证域名下的发件地址，例如 `时光镜 <report@example.com>`。

3. 在插件“设置 → 邮件备份”中填写：
   - 邮件网关 URL：部署返回的 Worker URL。
   - 收件邮箱。
   - 网关访问令牌：与 `BACKUP_SECRET` 相同。
4. 设置会在填写后自动保存；然后到“周期报告”勾选“同时发送”，先生成一次报告验证配置。

若不配置邮件网关，自动报告仍会正常生成并保存在插件本地。

### 区分不同设备的邮件

在每台设备的“设置 → 本机名称”填写自定义名称，例如“办公室电脑”或“家用笔记本”，修改后自动保存。新报告的邮件主题会以 `[办公室电脑]` 开头，正文显示设备名和设备 ID，JSON 附件也包含 `device: { id, name }`。

留空时使用 `Time Lens` 加本机 ID 前八位。ID 自动随机生成，按浏览器配置保存在本地，后台重启和改名不会改变；重新安装或清除扩展存储后会重新生成。备份导入不会覆盖本机 ID 或名称，已有报告保留生成时的设备信息。旧报告没有设备信息时仍能正常显示。

升级时需同时更新扩展和 `email-worker/worker.js` 邮件网关，邮件主题及正文才会显示设备信息。自建其他网关可读取 `report.device` 使用相同信息。

### 邮件后台队列

报告先保存在本地，再由独立邮件队列发送；发送期间不阻塞网站计时。扩展请求 15 秒超时，网关访问 Resend 12 秒超时。临时失败最多尝试 3 次，重试间隔为 1、2 分钟，由已有分钟闹钟唤醒；后台重启后继续处理已保存的待发任务。永久请求错误停止重试，页面自动显示待发送、已发送或失败状态。

同一报告的待发任务去重，重试保持相同正文和发送标识；随附网关将标识传给 Resend 的 [Idempotency-Key](https://resend.com/docs/dashboard/emails/idempotency-keys)。自动重试仅在创建后 23 小时内进行，以保持在其 24 小时去重窗口内。其他网关也需处理 `deliveryId` 去重。导入的报告只作为归档，不会触发补发；改变收件邮箱或网关后需重新生成报告。

## 数据格式

统计记录按本地日期和域名保存：

```json
{
  "dailyStats": {
    "2026-08-09": {
      "example.com": {
        "durationMs": 1800000,
        "visits": 3,
        "title": "Example",
        "url": "https://example.com/"
      }
    }
  }
}
```

“合并导入”会将相同日期、相同网站的时长和访问次数相加，适合汇总多台设备，但重复导入同一备份也会重复累计。“替换导入”会覆盖现有访问记录和报告。

## 开发校验

无需安装依赖。使用 Node.js 检查核心计算：

```powershell
node test/core.test.js
node test/service-worker-lifecycle.test.js
node test/email-queue.test.js
node test/email-worker.test.mjs
```

修改后台脚本后，在 `chrome://extensions/` 点击该扩展的“重新加载”。

## 相关项目

- [soft-trace](https://github.com/yuzhounh/soft-trace)：统计 Windows 软件使用时间；时光镜侧重网站访问时间。
- [focus-pace](https://github.com/yuzhounh/focus-pace)：提供专注与休息节奏提醒。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
