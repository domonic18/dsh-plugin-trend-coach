# CLAUDE.md

趋势交易课程伴学插件（dsh 0.2.1-rc.5）。学员本地 dsh 客户端 + 本插件，BYOK；云端只提供课程知识与内容服务。

## 先读这些

- 产品需求：`docs/requirements/product-requirements.md`
- 架构设计：`docs/architecture/architecture-design.md`
- 项目规范：`docs/conventions/project-conventions.md`（含官方 dsh 依据与禁止清单）

冲突时以 PRD 为准；平台约束以 PRD §3.1 实测结论为准。

## 硬约束（改代码前必须确认）

1. `remote.trendCoach` **禁止**写入静态 `inject`：先 `ctx.remote.$mount()`，成功后在 `ctx.inject(['remote.trendCoach'], scoped => …)` 里使用。
2. `sidebarRightTabs.register()` 的 `guide` 必须是数组；tab body 注册在 keyed slot `sidebar.right.pane.tab`，key = tab 定义 `id`。
3. 引用只走两条路：`seg-xxx` 代码块点击（主）/ `https://trend-coach.local/segment/...` 链接拦截（备）。自定义 scheme 在 dsh Markdown 中不可点。起止秒只信 `getSegment`，URL 里的 `t/e` 一律忽略。
4. 视频定位要求服务端支持 HTTP Range。
5. 安装/打包：dsh 包 peer 版本精确锁 `0.2.1-rc.5`；`engines.dsh` 是强制门禁（不满足会阻止安装/激活），保持 `>=0.2.1-rc.5 <0.3.0`；新 profile 安装用 `dsh plugin --profile <name> add -w <tgz>`；Web UI 还需安装 `@deepseek-ai/dsh-web-app`。
6. 插件最小权限：不注册 shell / 文件写入工具，不另起 HTTP 端口，不提交任何密钥；TTS 等本地能力用浏览器标准 API（Web Speech），不调用系统命令。
7. 加密 HLS：dsh 无原生 HLS，用内置 hls.js + MSE 动态加载；普通 MP4 走原生 `<video>`。播放地址由 Host 调 `POST /v1/playback/sessions` 换签名 `playlistUrl`，浏览器不持 Bearer；`Hls.isSupported()` 优先，禁止仅凭 `canPlayType`（Chrome on macOS 会误报 `maybe`）跳过 hls.js。
8. 鉴权与数据：设备码授权为主（`device/code` → 轮询 `device/token` → `refresh` 轮换），S2 已验证；grant 存 dsh credentials 的 grant 记录，刷新用 `modifyRecord` 合并并发；credential-ref 仅作内部 token 回退。token 不进浏览器/日志/配置。指标只走云端鉴权事件白名单，不接第三方分析 SDK。
9. Host 静态 `inject = ['tools', 'credentials']`：dsh 激活顺序不保证 `dsh-credentials-local` 先就绪，`credentials` 必须与 `tools` 一起声明。

## 常用命令

```bash
npm run typecheck                     # tsc strict
npm run build                         # Host tsc + Client esbuild → lib/
npm test                              # 构建后跑 Host 边界/契约/打包断言
npm run mock                          # mock KB + video @ 127.0.0.1:3939
npm pack                              # 生成安装包（*.tgz 已 gitignore）
npx --yes @deepseek-ai/dsh@0.2.1-rc.5 --profile <name> --port <port> --no-open
```

## 代码地图

- `src/index.ts`：Host 半（Config、`trend_coach_search` 工具、Remote 服务、云端请求）
- `src/auth.ts`：Host 授权（credential-ref、设备码登录/轮询、grant 存储、401 刷新、设备绑定）
- `src/errors.ts`：Host 边界（入参/响应校验、错误映射、限长 JSON 读取）
- `src/untrusted.ts`：Host 不可信文本处理（固定边界包裹、控制字符剥离、边界伪造转义）
- `src/client/index.ts`：Browser 半（Remote spec、右栏面板含设备登录、播放器、引用拦截）
- `scripts/build-client.mjs`：Client bundle 构建与 `__ModuleLoader__` 包装
- `test/`：Host 边界、不可信文本、mock 云端契约与发布包断言（`npm test`）
- `cordis.patch.yml`：bundle patch，注入插件配置
- `spike/`：mock KB、fixtures、测试视频（不随包发布）

## 改动规则

- 工具/Remote/云端接口的字段变化：先更新 PRD §6 与架构 §6，再改代码。
- 新增注册一律放进 `ctx.effect(...)` 并返回清理函数。
- 云端响应在 Host 边界校验；非法数据报错，不静默丢弃。
- 云端标题/正文渲染一律经 `untrusted.ts`（固定边界 + 转义 + 控制字符剥离），工具描述与渲染需声明内容不可信；面板与播放器常驻免责声明。
- 入参/响应边界：query 1–500 字符、topK 1–20、courseId/segmentId 白名单；响应 ≤512KiB、单片段文本 ≤4000 字符、标题与展示标题 ≤200 字符。错误统一映射 `RemoteError`（bad-request/cancelled/internal），日志不落 token、query 原文、设备 ID。
- 注释只写“为什么”；不写多段注释。
- 依赖：dsh 包与宿主精确同版本；不加无用运行时依赖。
- 提交：Conventional Commits，分批提交，提交前检查敏感信息。

## 完成定义

`npm run typecheck`、`npm run build`、`npm test` 通过；mock 下 Remote 挂载、检索、引用点击定位可用；涉及打包时在全新 profile 安装验证；相关文档已同步。
