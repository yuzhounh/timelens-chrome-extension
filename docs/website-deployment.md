# 产品网站发布

产品网站源码为 `site/`，包含产品主页、Google 登录与个人云端仪表盘；采集仍由原程序或扩展负责。只发布必要展示资源，不上传本地数据库或登录凭据。

- 网站名称：`timelens-extension`。
- GitHub 仓库：`yuzhounh/timelens-chrome-extension`；Pages 入口使用现有仓库路径。
- 构建：`node scripts/build-site.mjs`；输出 `site/dist/`，含公开文件 SHA-256 和源码提交清单 `release.json`。
- GitHub Pages：工作流 `.github/workflows/pages.yml`，只上传静态发布目录。
- Cloudflare Pages、Vercel：发布同一静态目录；先确认账号、项目及原名地址归属。
- Firebase：`firebase deploy --config site/firebase.json --only hosting --project timelens-chrome-extension`；仅操作 Hosting 站点 `timelens-extension`，不修改数据库规则、认证或其他站点。
- Netlify：只注册独立站点且不连接 Git 自动构建。2026-10-21 15:00 Asia/Shanghai 前不部署；之后遵守每项目滚动 168 小时最多一次提交，记录以维护 Hub 的 `review/netlify_deployments.md` 为准。
- 普通 GitHub 推送提交保留 `[skip netlify]`。

现有应用功能改动未纳入本次网站提交；网站下载链接指向现有公开发行版。原 Firebase Hosting 站点 timelens-chrome-extension 和现有登录回调保持独立。

## 当前发布状态（2026-10-20）

网站源码提交：`40e51d57fdb22956e6c1c7510725445a7d54ad73`（默认今日、按日期范围加载）。

- GitHub Pages：https://yuzhounh.github.io/timelens-chrome-extension/；工作流 `39411174020` 成功，包含网站测试及构建。
- Cloudflare Pages：https://timelens-extension.pages.dev/；部署 `57af778e`。
- Vercel：https://timelens-extension.vercel.app/；部署 `dpl_Fp4dMxpWEgdUb8h2eF2uR3YktKHA` Ready。
- Firebase Hosting：https://timelens-extension.web.app/；工程 `timelens-chrome-extension` 下的独立产品介绍站。
- Netlify：https://timelens-extension.netlify.app/；站点 `8c4966b4-8362-403e-895b-728033f8f62e` 已注册，未连接 Git、未部署。保持原定北京时间 2026-10-21 15:05 一次性发布安排，届时核对额度及滚动 168 小时窗口，使用本次最新已验证网站包。

本次复用已通过构建，核对全部 20 项公开资源与提交源码一致，再更新 release.json 中的源码提交。四平台各核验首页、app 入口、三个读取/展示脚本、认证脚本、公开客户端配置及发布清单，32 项检查通过，模块 MIME 正确。结果在 `results/website/verification-demand.json`，平台回执在同目录 `*-demand.log`。未为发布重新扫描个人 Firestore 记录；GitHub Pages 沿用现有仓库路径。

在线版默认今日视图，读取设备日期清单后仅下载选定范围的数据分块。切换日期、周/月/季/年、前后周期、回到本期及图表下钻均触发对应范围加载；显式选择“所有时间”才加载全部历史。已校验且未变化的日期分块复用缓存，相同范围的并发请求合并，不同范围顺序处理，账号切换隔离旧请求。本次仅提交网站展示层与相关测试，本地扩展源码及运行方式未修改。

## Google 登录与云端仪表盘

网站首页提供 Google 登录，登录后进入 app/。界面取自当前本地页面的展示层，网站专用适配器仅用当前登录用户的 Firebase ID Token 读取本人记录；不连接 localhost，不执行采集、导入、删除或设备改名。账号切换后重置内存缓存；退出后返回首页。浏览器保留 Firebase 登录会话，不把浏览记录写入网站发布包。

Soft Trace 按真实活动起止时间查询并分页，兼容旧状态记录的 stateStartUtc/stateEndUtc，时间轴以区间并集计算实际使用。Time Lens 按设备清单读取按日分块记录，校验 SHA-256，保留小时统计和原有图表逻辑。静态包包含页面、展示脚本和公开 Firebase 客户端配置，不包含用户数据或管理凭据。

网页仪表盘以云端已成功同步的记录为准；本机新记录需等待原设备同步。网站安全策略允许界面所需的内联样式，脚本来源仍限定为本站与 Google 官方 SDK；Firebase 托管认证辅助地址不应用页面框架限制。

本轮将账户信息、刷新和退出统一收进设置，移除额外顶栏；主页按钮“打开网页面板”位于两个下载/安装按钮右侧。Time Lens 标签标题为“Time Lens · 时光镜”。Soft Trace 逐段明细的滚动条使用更浅颜色；同一颜色修改已写回本地网页源码。

Google 登录由用户在真实浏览器完成；Soft Trace 已展示云端活动记录。Time Lens 分块校验已对齐扩展现有 SHA-256 前 32 位格式，用户刷新后确认图表和网站排行正常。自动化浏览器连接后续暂时失效，因此本轮不将退出操作标记为真实浏览器验收通过；账号退出逻辑调用 Firebase signOut，原有云端数据不会被删除。静态资源与账户隔离、跨午夜统计/分块完整性检查通过。

## 趋势核对、网页设置和月份分组（2026-10-20）

Time Lens 在相同 Home PC 设备、2026-10-01 至 2026-10-19 的 19 个完整日期逐日核对：本地和云端时长、访问次数均一致，总时长均为 251200955 毫秒，差值为 0。网页默认“所有设备”和本地“仅本机”不能直接比较，已按同设备对齐；网页设备选择按账户记忆。

Soft Trace 本地已读取相同闭合日期范围的 27234 条区间、2 台设备。云端返回 HTTP 429 / RESOURCE_EXHAUSTED / Quota exceeded，故本轮未完成其逐日数值一致性验证，也未将其记为通过。已修正当前周期结束时间导致缓存失效的问题，同一范围切换设备复用读取，后续刷新使用更新时间增量查询，额度错误后暂停自动读取。首次载入很长历史范围仍会有较大的读取量，不能把额度恢复等同于无限历史查询能力。

网页设置仅保留页面外观/语言、账户及云端刷新、只读设备信息。移除或隐藏采集状态、空闲阈值、Windows 自启动、原始记录导入/删除和设备改名；原程序/扩展继续管理这些本地功能。

两端月份分组统一为寒假 2 月、暑假 7–8 月、春季学期 3–6 月、秋季学期 9 月至次年 1 月。页面不显示学校名称、官方校历或来源链接。Time Lens 本地与网页分析代码均已修改；Soft Trace 本地后端构建通过，受影响的 18 项原生趋势/月份测试通过。日常程序更新遵循用户单独授权及正常退出后切换；旧后端不展示新分组的错误口径，显示更新提示。

数据核对原始库和浏览器存储均只读。临时筛选输入保存在忽略的 tmp/website-consistency/，结果摘要在 results/website/consistency.json；Soft Trace 的额度阻断证据在其 results/website/consistency-blocker.json。没有修改云端使用记录或访问规则。
