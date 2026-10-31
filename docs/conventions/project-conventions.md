# 趋势伴学插件 · 项目规范（v1.2）

- 状态：v1.2，依据 dsh 0.2.1-rc.5 官方插件实现、M0 实测结论与插件管理器/市场源码调研；补充播放会话、签名媒体与 HLS 选择顺序
- 日期：2026-10-31
- 适用范围：本仓库全部代码、配置、文档与提交
- 关联文档：[架构设计](../architecture/architecture-design.md)、[产品需求](../requirements/product-requirements.md)

**强制级别**

- **必须（MUST）**：违反会导致运行失败、安全问题或契约破坏。
- **应当（SHOULD）**：默认遵守；偏离需在 PR/提交说明中给出理由。
- **建议（MAY）**：随规模演进逐步补齐。

---

## 1. 仓库与文件组织

```
src/                  Host 与 Client 源码
  index.ts            Host 入口（name/inject/Config/apply）
  client/             Client 入口与 dsh 类型声明
scripts/              构建脚本
spike/                本地 mock 与测试资产（不随包发布）
docs/                 需求、架构、规范
cordis.patch.yml      bundle patch（随包发布）
```

- **必须**：构建产物（`lib/`）、依赖（`node_modules/`）、打包文件（`*.tgz`）、`.playwright-mcp/` 不入库。
- **应当**：目录用 kebab-case；源文件用小驼峰（入口 `index.ts` 除外）；React 组件用 PascalCase；常量用 UPPER_SNAKE_CASE。
- **应当**：新增文档放入 `docs/<category>/`，文件名 kebab-case；文档首部写状态、日期与上游链接。

---

## 2. 包与 manifest

参考官方双端插件（如 `@deepseek-ai/dsh-schedule`、`@deepseek-ai/dsh-api-remotes`）的 manifest 形状。

- **必须**：包名 `dsh-plugin-trend-coach`，`"type": "module"`，`main` 指向 `lib/index.js`，`types` 指向 `lib/index.d.ts`。
- **必须**：声明 `dsh.client` 时必须同时满足：`dsh.client.platform === "web"` 且 `exports["./client"]` 存在，否则 dsh 加载报错。
- **必须**：提供 `dsh.bundle.patch` 才能作为 profile bundle 层生效；patch 文件使用顶层 YAML 数组。
- **必须**：`files` 精确列出发布物（`lib`、`cordis.patch.yml`），不发布 `src`、`spike`、`docs`。
- **应当**：同时暴露 `exports["."]`、`exports["./client"]`、`exports["./package.json"]`；需要类型时一并暴露 `.d.ts`。
- **应当**：`dsh.client.inject` 仅表达包级依赖信息，**不是** cordis 服务注入；真正的服务注入写在代码 `inject` 中。
- **应当**：`dsh.client.external` 只列平台基座之外的精确请求；纯类型 import 会在构建期擦除，不要列入。
- **应当**：`publishConfig.access = "public"`；`license = "MIT"`。
- **必须**：`engines.dsh` 是被强制的门禁：dsh 插件管理器在 `engines.dsh`（缺省时回退到 DSH peer 依赖）不满足时**阻止安装与激活**，插件市场也据此计算兼容性。范围必须收紧到实测通过区间（当前 `>=0.2.1-rc.5 <0.3.0`），不得使用 `latest` 或宽松范围。
- **必须**：升级 dsh 版本时同时更新 `engines.dsh`、peer/dev 精确版本与兼容矩阵，三者不得单独漂移。

---

## 3. 依赖与版本

官方插件对 dsh 包使用精确版本，cordis/schemastery 用波浪范围。

- **必须**：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-typert-protocol` 等 dsh 包与运行时精确一致（当前 `0.2.1-rc.5`）。
- **必须**：`@deepseek-ai/cordis` 用 `~4.0.5`，`@deepseek-ai/schemastery` 用 `~3.18.5`，`zod` 用精确 `4.4.3`。
- **必须**：不把 `@deepseek-ai/*` 运行时包放入 `dependencies`；它们由 dsh 宿主提供，只作为 `peerDependencies` + `devDependencies`。
- **必须**：不使用 `^0.0.1-rc.x` 之类旧范围——会解析到旧依赖链并把未发布包拖入安装，导致 404。
- **应当**：升级 dsh 版本时同步更新 peer/dev 版本、构建产物与兼容矩阵，不单独升级某一个 dsh 包。
- **必须**：加密 HLS 用内置 `hls.js`（MSE）播放并动态加载；dsh/Chromium 无原生 HLS，禁止依赖 CDN 脚本或额外播放服务。普通 MP4 仍用原生 `<video>`，按源类型选择路径。
- **必须**：HLS 选择顺序为 `Hls.isSupported()` 优先，只有 MSE 不可用且 `canPlayType('application/vnd.apple.mpegurl')` 非空时才交给原生播放；Chrome on macOS 会对该类型返回 `maybe` 但无法播放，禁止单独用 `canPlayType` 判断。
- **应当**：新增第三方运行时依赖（如 hls.js）须在 PR 说明用途、许可证与打包体积；纯浏览器/宿主已有能力（如 Web Speech API）不引依赖。

---

## 4. Cordis 插件结构

官方入口惯例如 `dsh-tool-web`：`name` / `inject` / `Config` / `apply`。

- **必须**：入口导出 `name`、`inject`、`Config`（有配置时）、`apply(ctx, config)`。
- **必须**：工具、tab 类型、DOM 监听等注册放进 `ctx.effect(() => disposer, label)`，确保卸载可逆；slot 按官方模式 `ctx.slots.inject(name, () => ctx.slots.register(...))` 注册，由注入作用域管理清理。
- **必须**：静态 `inject` 只声明激活前就保证存在的服务（如 `tools`、`credentials`、`slots`、`sidebarRightTabs`、`sidebarRight`、`remote`）。
- **必须**：`remote.<namespace>` 不得写入静态 `inject`；先 `ctx.remote.$mount()`，成功后在 `ctx.inject(['remote.<ns>'], scoped => …)` 内使用。
- **必须**：Host 端依赖 `credentials` 时必须写进静态 `inject`（`['tools', 'credentials']`）。dsh 的激活顺序不保证 `dsh-credentials-local` 先于本插件，`apply` 里直接 `ctx.get('credentials')` 可能为空。
- **必须**：动态依赖用 `ctx.inject([...], child => …)`，不要在回调外缓存 `child` 的服务引用。
- **必须**：配置用 schemastery 定义默认值；敏感配置使用 credential-ref：
  `z.string().role("credential-ref").default("ENV_NAME").volatile()`，不得明文保存。
- **必须**：设备 grant（access/refresh token、deviceId、expiresAt）存 `credentials` 的 `grant` 记录，键用 `credentialKey('trend-coach', '<用途>')`；刷新用 `modifyRecord()` 的串行读改写，禁止自建 token 文件。
- **应当**：使用 `.volatile()` 的 Config 不要标注 `Schema<Config>`；volatile 字段输入是 `string`、输出是 `Volatile<string>`，标注会触发 TS2322。
- **应当**：日志用 `ctx.logger`，实例命名 `ctx.logger("trend-coach")`；错误消息带包名前缀。
- **应当**：可路由的错误用稳定 code（`HarnessError` / `RemoteError`），普通失败抛 `Error`。

---

## 5. Tool 规范

官方契约见 `@deepseek-ai/dsh-tools` 的 `defineTool` 类型；官方示例见 `dsh-tool-web` 的 `web_search`。

- **必须**：字段完整：`name`、`description`、`parameters`、`output.schema`、`output.render`、`execute`；返回值必须符合 `output.schema`。
- **必须**：工具名全局唯一，使用 snake_case；本插件统一前缀 `trend_coach_`；`run_code` 为保留名，禁止注册。
- **必须**：`execute(args, exec)` 透传 `exec.signal` 到所有网络请求。
- **必须**：描述写清“何时必须调用”“不得编造时间点”“无召回时的行为”，不写实现细节。
- **必须**：参数由 registry 校验后，工具内只做跨字段或业务语义校验；非法参数作为普通错误返回。
- **应当**：`render` 输出的引用链接格式固定，并明确要求模型原样复制。
- **应当**：结果只包含完成回答所需字段；不把云端原始响应整包塞入模型上下文。
- **必须**：片段展示字段（`courseTitle/chapterTitle/knowledgePointTitle`）与空召回用的 `relatedKnowledgePoints` 只来自云端；相邻知识点只给 ID 与标题，**不得**携带时间点或片段正文。
- **建议**：需要展示优化时再加 `presentationMeta` / `presentCall` / `presentResult` / `timeoutMs` / `isConcurrencySafe`，不要提前铺开。

---

## 6. Remote（Typert）规范

官方双端插件（如 `dsh-user-questions`、`dsh-agent-preset-registry`）提供了 Host/Client 两侧写法。

- **必须**：Host 服务继承 `TypertRemoteService`，`super(ctx, "trendCoach")`；方法加 `@Remote`。
- **必须**：方法参数为位置参数，`signal: AbortSignal` 固定最后一位。
- **必须**：客户端 spec 的 `package` 为包名，method key 为 `服务名/方法名`，参数声明 `wire` / `source: "json"` / `codec` / `strictCodec`，结果使用 strict codec。
- **必须**：客户端先 `$mount` 再调用；`$mount` 返回的 unmount 必须在 effect 清理阶段执行。
- **必须**：调用结果按 `{ ok, value } | { ok, error }` 处理，不假设一定成功；错误码稳定可读。
- **应当**：服务 key 用小驼峰（`trendCoach`）；方法名用动词（`search`、`getSegment`）。
- **应当**：跨端类型放在共享声明中；客户端不直接 import Host 模块。

---

## 7. Client UI 规范

官方客户端 bundle 由 `window.__ModuleLoader__.load({ id, factory(require) })` 包装；UI 扩展通过 slots 与右侧栏指南注册。

- **必须**：构建产物为 `lib/client.js`，保留 `__ModuleLoader__` 包装与 package id。
- **必须**：构建时外置平台基座依赖（react、react-dom、cordis、zod、client-ui-slots、client-ui-primitives、client-ui-dockkit 等），不重复打包。
- **必须**：`sidebarRightTabs.register()` 的 `guide` 为数组，条目含 `id` / `order` / `title()`；tab body 注册在 keyed slot `sidebar.right.pane.tab`，key 等于 tab 定义的 `id`。
- **必须**：页面型 tab 通过 `ctx.sidebarRight.openTab(kind, { params })` 打开；参数必须是 `Record<string, unknown>`（对象需展开复制）。
- **必须**：DOM 级监听（如引用点击）必须绑定在 `scoped.effect` 内，并在清理函数中移除。
- **必须**：引用只接受 `segmentId` 代码块与 `https://trend-coach.local/segment/...` 链接；不新增自定义 scheme 依赖。
- **应当**：组件不直接 fetch 云端；所有数据经 Remote。
- **应当**：UI 文案用中文；代码标识符用英文；面向学员的错误文案不暴露内部错误码。
- **建议**：UI 规模扩大后迁移到 CSS Modules + `--dsw-*` token + `@deepseek-ai/dsh-client-ui-primitives`；当前内联样式为阶段性方案。
- **建议**：需要多语言时使用 `locale/<lang>.json` 与 `ctx.locale.register()`，slot 上声明 `locale` 命名空间。

---

## 8. 云端接口与数据边界

- **必须**：HTTPS + Bearer 鉴权 + 限流；只读接口；不下发全库正文。
- **必须**：Host 在边界处校验响应结构；`segments` 非数组或元素不合法即失败，不静默过滤。
- **必须**：Host 边界限制 `query` 1–500 字符、`topK` 1–20、`courseId` ≤64 且 `[A-Za-z0-9._-]`、`segmentId` 形如 `seg-...` 且 ≤80；响应 ≤512KiB、单片段 `text` ≤4000 字符、`relatedKnowledgePoints` ≤5 条。
- **必须**：Typert 失败码仅 `gateway/bad-request｜cancelled｜internal`：入参非法→bad-request，取消→cancelled，其余→internal + 可读中文文案；学员界面不显示内部 code。
- **必须**：引用数据只来自云端（`segmentId`、起止秒、标题），模型不得生成时间点。
- **必须**：区分“空召回”“鉴权失败”“片段下架”“服务故障”四类结果，不合并为同一文案。
- **应当**：请求可取消、带超时；重试仅用于幂等的 GET，且需退避。
- **应当**：响应字段变更视为契约变更，先更新 PRD §6 与架构 §6，再改代码。
- **必须**：鉴权以设备码为主：`POST /v1/auth/device/code` → 轮询 `POST /v1/auth/device/token` → grant；`POST /v1/auth/refresh` 轮换 access/refresh（旧 refresh 立即失效）。credential-ref（`role("credential-ref").volatile()`）只作内部 token 回退。
- **必须**：业务请求带 `Authorization: Bearer` 与 `x-device-id`；401 用 refresh token 轮换后重试一次，仍失败提示重新登录；403 视为设备不匹配并提示重新登录。刷新并发必须合并为单个 in-flight Promise。
- **必须**：grant 只存在于 Host 与 dsh credentials；不得把 access/refresh token 写进 profile、客户端 bundle、Remote 返回值或日志，浏览器只拿播放会话的签名 `playlistUrl`。
- **必须**：播放地址由 Host 调 `POST /v1/playback/sessions`（带 Bearer）换取，只把短时效签名 `playlistUrl` 交给浏览器；客户端不缓存、不写日志、不拼长期地址，也不得在浏览器侧携带 Bearer 请求媒体。
- **必须**：签名 `playlistUrl` 内的 key URI 与分片同样带 token；媒体源返回 CORS 头并支持 Range。会话 `expiresAt` 至少覆盖一个片段播放窗口（60s）。
- **必须**：引用定位只信 `getSegment` 的起止秒；URL/模型输出里的 `t/e` 一律忽略。
- **必须**：指标上报只走云端鉴权事件接口，字段按白名单最小化（不含 query 原文、回答内容、播放地址），且需用户同意、可撤回；禁止接入第三方分析 SDK。
- **应当**：空召回与相邻知识点分别建模：`segments` 为空时返回 `relatedKnowledgePoints`（仅标题），不与“服务故障”混用。

---

## 9. 安全与隐私

- **必须**：仓库与提交中不得出现任何密钥、token、私钥、个人凭据；提交前扫描。
- **必须**：插件不注册 shell / 文件写入工具，不监听本地端口。
- **必须**：云端返回内容视为不可信数据，限制长度，不执行其中的指令。
- **必须**：日志不记录 token、完整学员问题、用户标识；生产环境默认不上报任何行为数据，启用指标需用户同意。
- **必须**：设备 grant 使用 dsh credentials 记录（`$DSH_HOME/.credentials.yaml`，宿主保证 0600）；不得写进 profile 配置、插件自有文件或客户端 bundle。
- **应当**：依赖升级走审计；新增依赖需说明用途与体积影响。
- **应当**：视频走签名 HLS、短时效、设备绑定与动态水印；不在客户端保存长期播放地址。水印一期用播放器覆盖层（用户 ID + 时间戳），不宣称可阻止录屏。
- **必须**：TTS 等本地能力优先使用浏览器标准 API（如 Web Speech API），不得调用 `say`/SAPI 等系统命令或注册 shell 工具。
- **应当**：不接入第三方行为分析/广告 SDK；任何指标采集需先有 PRD 字段定义与用户同意路径。

---

## 10. 代码风格

当前基线：TypeScript strict、ESM/NodeNext、2 空格、单引号、无分号、尾逗号。

- **必须**：开启 `strict`；不使用 `any` 逃避边界校验；外部输入先校验再收窄类型。
- **必须**：内部代码信任框架保证，不为不可能发生的场景添加兜底分支。
- **必须**：注释只解释“为什么”（隐藏约束、平台怪癖、绕行原因），不解释代码在做什么。
- **应当**：函数保持单一职责；单文件超过 ~400 行或出现第 3 个同类端点时按架构 §4.1 拆分。
- **应当**：命名表达业务含义（`segmentId`、`knowledgePointId`），不用缩写。
- **建议**：M2 引入 Prettier + ESLint（含 import 顺序与未使用变量检查）；在此之前保持现有风格一致。

---

## 11. Git 与文档

- **必须**：提交信息使用 Conventional Commits：`feat|fix|refactor|docs|test|chore|perf|build(<scope>): <描述>`。
- **必须**：按逻辑分批提交，不把无关改动混在一个提交；不提交生成物。
- **必须**：提交前做敏感信息检查（文件名 + 内容模式）。
- **必须**：契约、流程、平台约束变化时同步更新 PRD、架构与规范；三者冲突时以 PRD 为准，并在架构文档记录偏差。
- **应当**：PRD 版本号随实质变更递增；架构/规范文档首部更新状态与日期。
- **应当**：PR/提交说明写“为什么”，而不是罗列文件。

---

## 12. 测试与发布

**每次改动的最低门槛**

1. `npm run typecheck`
2. `npm run build`
3. `npm run mock` + 插件在 dsh 中冒烟（Remote 挂载、检索、引用定位）
4. 涉及打包/依赖/manifest 时：`npm pack` 后在全新 profile 安装验证

**发布检查**

- [ ] 版本号与 peer 精确版本正确
- [ ] `files` 清单完整且无多余文件
- [ ] `npm pack --dry-run` 内容符合预期
- [ ] 全新 profile 安装后：宿主组件运行中、客户端加载、工具可调用、引用可定位
- [ ] 无敏感信息
- [ ] PRD / 架构 / 规范已同步

**兼容矩阵**：至少覆盖“最低支持 dsh 版本”和“当前开发版本”；升级 dsh 时两列都要跑。

---

## 13. 禁止清单

- ❌ 把 `remote.<namespace>` 写进静态 `inject`
- ❌ `sidebarRightTabs.register()` 的 `guide` 传对象
- ❌ 依赖自定义 URL scheme 做引用跳转
- ❌ 客户端直连云端或另起 HTTP 端口
- ❌ 下发/缓存全库正文
- ❌ 注册 shell、文件写入或任意命令执行工具
- ❌ 明文保存或提交 token / 密钥
- ❌ 把设备 grant、refresh token 传给浏览器、写入 profile/日志，或绕过 dsh credentials 自建 token 存储
- ❌ 在 `apply` 中凭 `ctx.get('credentials')` 取服务而不把 `credentials` 写进静态 `inject`
- ❌ 提交 `lib/`、`*.tgz`、`.playwright-mcp/`
- ❌ 使用 `latest` 或宽松 dsh 版本范围
- ❌ 在无召回时编造课程内容或时间点
- ❌ 依赖 CDN 脚本或第三方播放服务加载 HLS
- ❌ 仅凭 `canPlayType` 判断 HLS 支持，或在 Chrome/macOS 上跳过 hls.js
- ❌ 把 Bearer、长期播放地址或未经签名/未开 CORS 的媒体地址交给浏览器
- ❌ 信任引用 URL 或模型输出中的起止秒（`t/e`），而不调 `getSegment`
- ❌ 用 shell/系统命令实现 TTS 或其他本地能力
- ❌ 接入第三方分析 SDK 或未经同意上报行为数据

---

## 附录：官方依据（dsh 0.2.1-rc.5）

| 主题 | 参考包与文件 |
|---|---|
| manifest 类型 | `@deepseek-ai/dsh-package-manifest` `lib/types/types.d.ts` |
| client 校验 | `@deepseek-ai/dsh-client-modules` `lib/index.js` |
| 插件入口示例 | `@deepseek-ai/dsh-tool-web` `lib/index.js` |
| credential-ref | `@deepseek-ai/dsh-llm-deepseek-api-key` `lib/index.js` |
| credentials 服务 / grant 记录 | `@deepseek-ai/dsh-credentials` `lib/index.js`、`@deepseek-ai/dsh-credentials-local` `lib/index.js`、`@deepseek-ai/dsh-base` `cordis.patch.yml`（id `credentials`） |
| Tool 契约 | `@deepseek-ai/dsh-tools` `lib/types/schema.d.ts` |
| Remote Host | `@deepseek-ai/dsh-agent-preset-registry` `lib/index.js` |
| Remote Client | `@deepseek-ai/dsh-api-remote-access` `lib/client.js` |
| 右栏 guide/slots | `@deepseek-ai/dsh-client-ui-sidebar-right` `lib/client.js` |
| bundle patch | `@deepseek-ai/dsh-base` `cordis.patch.yml`、`@deepseek-ai/dsh-experimental-ralph-bundle` |
| 客户端产物格式 | `@deepseek-ai/dsh-client-ui-theme` `lib/client.js` |
| 版本门禁 | `@deepseek-ai/dsh-plugin-manager` `lib/types/tools.js`（engines.dsh / DSH peer 阻止安装与激活）、`@deepseek-ai/dsh-plugin-market`（兼容性判据） |
| 播放与 TTS 现状 | dsh 客户端包内无 HLS 播放器与 TTS 服务；HLS 需自备 hls.js，TTS 用 Web Speech API |
| 产品分析边界 | `@deepseek-ai/dsh-client-product-analytics` 仅桌面端，第三方插件标识不构成分析维度 |
