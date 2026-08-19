<p align="center">
  <img src="icons/timer.svg" width="112" alt="时光镜图标" />
</p>

<h1 align="center">时光镜</h1>

<p align="center"><strong>Chrome 网站访问时间统计、可视化与周期报告</strong></p>

一个本地优先的 Chrome Manifest V3 扩展。它只累计“当前窗口中激活的网页”且电脑处于非空闲状态时的访问时间，并按网站域名汇总。

## 已实现

- 有效访问计时：切换标签、切换窗口或电脑空闲时自动暂停
- 今日弹窗：快速查看今日总时长和前五网站
- 可视化仪表盘：按日、周、月、季度、年或所有时间查看趋势、占比和网站排行
- 历史追溯：选择任意日期后定位到它所在的周、月、季度或年份，并可前后翻页
- JSON 完整备份的导入、合并与替换恢复
- 当前时间范围及周期报告的 CSV 导出
- 本周、本月、本季度、本年度报告手动生成
- 周末、月末、季末、年末自动生成上一周期报告并保存在本地
- 通过安全邮件网关自动发送 HTML 报告及 CSV、JSON 附件
- 排除指定网站、调整空闲阈值、独立开关各类自动报告

## 安装插件

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
4. 保存后到“周期报告”勾选“同时发送”，先生成一次报告验证配置。

若不配置邮件网关，自动报告仍会正常生成并保存在插件本地。

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
```

修改后台脚本后，在 `chrome://extensions/` 点击该扩展的“重新加载”。

## 开源许可

本项目基于 [MIT License](LICENSE) 开源。
