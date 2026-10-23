<p align="center">
  <img src="icons/timer.svg" width="112" alt="Time Lens · 时光镜 logo">
</p>

<h1 align="center">Time Lens · 时光镜</h1>

<p align="center"><strong>网站访问计时、可视化与 Google 账户跨设备同步。</strong></p>

<p align="center">
  <a href="https://github.com/yuzhounh/timelens-chrome-extension/releases/latest"><img src="https://img.shields.io/github/v/release/yuzhounh/timelens-chrome-extension?style=flat&amp;color=0969da&amp;label=Release" alt="Latest stable release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=flat" alt="License: MIT"></a>
  <a href="https://chromewebstore.google.com/detail/idihkkiapagakajacljibnpekkfpiacm"><img src="https://img.shields.io/badge/Platform-Chrome%20MV3-4285f4?style=flat&amp;logo=googlechrome&amp;logoColor=white" alt="Platform: Chrome MV3"></a>
  <img src="https://img.shields.io/badge/JavaScript-Browser-f7df1e?style=flat&amp;logo=javascript&amp;logoColor=white" alt="JavaScript: Browser">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/idihkkiapagakajacljibnpekkfpiacm">安装扩展</a> · <a href="https://github.com/yuzhounh/timelens-chrome-extension/releases/latest">下载发布版</a> · <a href="#快速开始">快速开始</a> · <a href="LICENSE">开源协议</a>
</p>

一个通过 Google 账户同步多台设备的 Chrome Manifest V3 网站计时扩展。它只累计“当前窗口中激活的网页”且电脑处于非空闲状态时的访问时间，并按网站域名汇总。

当前日常源码为2.1.2，公开发行和商店版本单独维护。修正2.1.1历史迁移把对象字段顺序变化误判为数据变化的问题：按内容校验，数组顺序和数值仍须一致；日期摘要采用稳定键序，已经建立的旧索引也先校验、提交新索引后再清理。统计按日期保存，更新活动只读取、哈希和写入涉及的日期；小时分段、访问次数、原设备身份、账户及JSON备份格式保持。云同步复用未变化日期的摘要，扩展及网页看板在隐藏时合并变更，回到前台刷新；网页单日分块最多并发读取4个。

## 功能特点

- 有效访问计时：切换标签、切换窗口或电脑空闲时自动暂停
- 今日弹窗：快速查看今日总时长和前五网站
- 可视化仪表盘：按日、周、月、季度、年或所有时间查看趋势、占比和网站排行
- 历史追溯：选择任意日期后定位到它所在的周、月、季度或年份，并可前后翻页
- JSON 完整备份的导入、合并与替换恢复
- 排除指定网站、调整空闲阈值
- Google 账户同步：跨设备同步统计和通用设置，支持离线记录与联网补传

## 快速开始

先下载并解压仓库 ZIP，或运行 `git clone https://github.com/yuzhounh/timelens-chrome-extension.git` 获取代码。

1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录。
5. 打开完整仪表盘，点击右上角设置 → 账户与同步，登录 Google，同一账户下的设备自动同步。
6. 正常浏览几分钟，点击工具栏中的“时光镜”查看今日数据，或按 `Ctrl+Shift+Y` 打开完整仪表盘。

插件读取活动标签页 URL 以按域名统计；登录 Google 后，访问统计和通用设置自动同步至 Firebase。本机保存记录与缓存，离线时继续计时，联网后补传。Chrome 内部页、扩展页和本地文件不会被统计。

## Google 账户同步（本地使用版）

在右上角设置 → 账户与同步中登录 Google，同一账户的数据通过 Firebase 项目 `timelens-chrome-extension` 同步。约每 5 分钟自动同步，也可点击“立即同步”。概览可按设备显示名称筛选或合并查看所有设备；工具栏弹窗继续统计本机。头像、姓名、邮箱和同步状态统一显示在设置弹窗的账户与同步分组。

其他电脑需要复制当前本地扩展文件并加载已解压的扩展，再登录同一 Google 账户。GitHub 和商店版本尚不包含本地改动。扩展代码不通过 Firebase 更新；更新文件后在 Chrome 扩展管理页重新加载。安装、同步范围、离线行为和验证记录见 [同步说明](docs/cloud-sync.md)。

2.0 主界面只保留概览，移除左侧栏。右上角设置弹窗集中提供常规、账户与同步、设备管理、数据管理四个分类；支持键盘切换分类、关闭按钮和 Esc，清除本机数据仍需 5 秒倒计时确认。修改后的设置自动保存。周期报告、自动报告与邮件备份已停用；旧报告仅作为兼容归档保留在 JSON 备份与云端历史数据中。

## 趋势与浏览规律

趋势参考 SoftTrace：周、月和季度保留完整日历范围，年视图显示十二个月；全部时间在超过 100 天时按月汇总。灰色短线表示无记录，虚线表示未来，均不伪装成零浏览。点击柱形进入对应日/月，也可用左右方向键、Home/End 和 Enter 导航。

多日范围提供网站集中度、平均访问时长及浏览最多的日期；实际范围满七天时增加星期规律。年视图及跨度至少一年的全部时间提供学期与寒暑假对比，按固定月份分为寒假（2 月）、暑假（7–8 月）、春季学期（3–6 月）和秋季学期（9 月至次年 1 月），至少有两个阶段存在记录才显示。日均统计排除无记录日期。

新版按设备记录时的本地小时拆分浏览时长，保留每日总量；有小时明细的日视图显示 00–23 时分布，累计至少两个有小时明细的日期后显示多日小时规律。旧记录只有每日总量，不补造小时数据。显示语言跟随设置切换中英文。修改后需重新加载本地扩展并刷新面板，不要卸载扩展。

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

新记录可额外包含 `hourlyMs`（24 项毫秒数组）。此字段只覆盖新版实际记录的小时部分，可小于该日 `durationMs`；旧记录不增加该字段。Firebase 同步、设备汇总和 JSON 导入导出保留小时数组。

“合并导入”会将相同日期、相同网站的时长、访问次数及小时明细相加；重复导入同一备份也会重复累计。“替换导入”会覆盖现有访问记录和报告。

## 开发校验

无需安装依赖。使用 Node.js 检查核心计算：

```powershell
node test/core.test.js
node test/service-worker-lifecycle.test.js
node test/cloud-sync.test.js
node test/analytics.test.js
node test/analytics-view.test.js
node test/hourly-tracking.test.js
```

修改后台脚本后，在 `chrome://extensions/` 点击该扩展的“重新加载”。

## 相关项目

- [soft-trace](https://github.com/yuzhounh/soft-trace)：统计 Windows 软件使用时间；时光镜侧重网站访问时间。
- [focus-pace](https://github.com/yuzhounh/focus-pace)：提供专注与休息节奏提醒。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
