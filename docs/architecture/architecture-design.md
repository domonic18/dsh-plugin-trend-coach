# 趋势伴学插件 · 架构设计（v1.4）

- 状态：v1.4，基于 PRD v1.3 与 dsh 0.2.1-rc.5 实测/源码调研结论；补齐需求覆盖矩阵与待决策清单
- 日期：2026-10-31
- 上游文档：[产品需求文档](../requirements/product-requirements.md)
- 配套规范：[项目规范](../conventions/project-conventions.md)
- 版本变更：v1.4 落地退出并注销（`POST /v1/auth/revoke`）、面板跨挂载状态保留、`npm run smoke` 与 CI，并记录 S9 真实云端联调结果；v1.3 落地指标事件同意与上报（`GET/PUT /v1/events/consent` + 三类白名单事件），并记录 S8 真实云端联调结果；v1.2 落地播放会话契约（`POST /v1/playback/sessions`）、媒体 CORS 要求、引用时间点只信 `getSegment`、hls.js 优先于 `canPlayType` 的选择顺序，并记录 S1 端到端验证结果；v1.1 补齐播放语义、HLS 方案、鉴权分期、水印、TTS、指标、显示字段/相邻知识点、`engines.dsh` 与 §17/§18。

---

## 1. 目标与范围

本文定义 `dsh-plugin-trend-coach` 的运行时架构、模块边界、接口契约与演进路径，作为 M2 及后续里程碑的实现依据。

**在范围内**

- 学员本地 dsh 客户端中的插件：Host 半（工具 + Remote 服务 + 云端访问）与 Browser 半（右栏问答面板、播放器）。
- 与云端知识库、视频分发、账号体系的接口边界。
- M2 核心链路：课程问答 → 引用 → 视频定位。

**不在范围内**

- 云端检索、内容生产、后台管理的内部实现（仅在契约层约束）。
- 多模态输入、AI 互动课堂、后台管理的详细设计（M4–M5 单独补充设计章节）；体系页契约见 §6.6。
- dsh 本体与 cordis 框架的改造。

---

## 2. 设计原则与约束

| 原则 | 含义 |
|---|---|
| 宿主优先 | 推理、会话、凭据由 dsh 提供（BYOK）；插件不自建模型调用链 |
| 只读云端 | 一期云端只提供检索、片段元数据与视频分发，不接收写入 |
| 契约显式 | 工具、Remote、云端接口均有可校验的 schema；跨边界数据先校验后使用 |
| 引用可溯源 | 引用只能来自云端返回的 `segmentId`，模型不得生成时间点/链接 |
| 最小权限 | 不注册 shell / 文件写入工具；不另起 HTTP 端口；不采集未声明数据 |
| 平台约束内建 | dsh 的注入顺序、Markdown 限制、Range 要求等硬约束进入代码结构，而非注释提醒 |

**版本基线**：dsh `0.2.1-rc.5`、cordis `~4.0.5`、schemastery `~3.18.5`、zod `4.4.3`。预览期不追 latest，升级需过兼容矩阵（见 §14）。

---

## 3. 系统上下文

```mermaid
flowchart LR
  subgraph Local["学员电脑 · dsh 0.2.1"]
    A[dsh Agent Loop] -->|tool call| H[Host 半<br/>工具 + Remote 服务]
    U[Browser UI] -->|remote.trendCoach| H
    H -->|render result| A
    A -->|回答 + 引用| U
    U --> P[右栏播放器 tab]
  end

  subgraph Cloud["云端 · 知识与内容服务"]
    KB[知识库检索<br/>POST /v1/kb/search]
    SG[片段元数据<br/>GET /v1/kb/segments/:id]
    V[私有加密 HLS<br/>签名 URL]
    AC[账号 / 设备授权]
  end

  H -->|HTTPS + Bearer| KB
  H -->|HTTPS + Bearer| SG
  P -->|签名 HLS| V
  H -.->|M3 设备码| AC
```

**职责边界**

| 端 | 负责 | 不负责 |
|---|---|---|
| Host 半 | 工具注册、云端检索、片段查询、入参校验、超时与取消 | 渲染、播放、模型推理 |
| Browser 半 | 右栏面板、引用点击、播放器定位、UI 状态 | 直接访问云端、持有长期凭据 |
| dsh | agent loop、LLM、会话、权限、profile 管理 | 课程内容与检索 |
| 云端 | 账号、知识库、embedding、视频分发、限流 | 推理与 agent 编排 |

---

## 4. 运行时架构

### 4.1 Host 半

当前实现集中在 `src/index.ts`，职责链如下：

```
apply(ctx, config)                                  // 静态 inject: ['tools', 'credentials']
├── resolveConfig(config)                           // src/host/config.ts：校验与规范化
├── createHostLogger(ctx.logger('trend-coach'), …)  // src/host/log.ts
├── new AuthManager(ctx, config)                    // src/auth.ts
│   ├── credential-ref 解析（M2 内部 token 回退）
│   ├── 设备码：beginDeviceAuth / pollDeviceAuth / signOut
│   └── request()：Bearer + x-device-id；401 刷新一次；403 → DEVICE_MISMATCH
├── new TrendCoachService(ctx, auth, logger)        // src/host/service.ts
│   ├── @Remote search / getSegment / createPlaybackSession
│   └── @Remote authStatus / beginDeviceAuth / pollDeviceAuth / signOut
│       └── src/host/cloud-client.ts：云端 HTTP + 响应结构校验
└── registerSearchTool(ctx, auth)                   // src/host/tool.ts
    ├── parameters: query / courseId? / topK?
    ├── output.schema + render
    └── execute → searchKnowledge(...)
```

**配置（`src/host/config.ts`）**

| 字段 | 默认 | 约束 |
|---|---|---|
| `environment` | `local`（`TREND_COACH_ENV` 可覆盖） | `local/staging/production`；非 local 强制 HTTPS；production 拒绝本机地址 |
| `baseUrl` | `TREND_COACH_BASE_URL` 或 `http://127.0.0.1:3939` | 仅 http/https；禁止账号密码、查询串、锚点；末尾斜杠规范化 |
| `apiTokenRef` | `TREND_COACH_API_TOKEN`（credential-ref） | 仅内部 token 回退 |
| `timeoutMs` | `10000` | 正数 |
| `logLevel` | `warn`（`TREND_COACH_LOG_LEVEL` 可覆盖） | `silent/error/warn/info/debug` |

`cordis.patch.yml` 不再写死 `baseUrl`，安装后可用环境变量或 profile 配置切换 staging/production。配置校验失败会阻止插件激活，避免用错误地址静默请求。

**关键点**

- 工具与 Remote 共用同一个 `searchKnowledge()`，避免两套检索逻辑漂移。
- 所有业务请求统一走 `AuthManager.request()`；工具与 Remote 都透传调用方 `AbortSignal`，再与 `AbortSignal.timeout(timeoutMs)` 合并。
- 云端响应在边界处做结构校验（`isSegment`），非法数据直接报错，不进入模型上下文。
- 设备 grant 以 `credentialKey('trend-coach', 'device')` 存入 dsh credentials；`modifyRecord()` 的串行读改写保证 refresh token 轮换不会并发覆盖。
- `credentials` 与 `tools` 一样是静态 `inject` 依赖：dsh 的激活顺序不保证 `dsh-credentials-local` 先于本插件。`remote.*` 仍禁止静态注入。

**模块拆分**：Host 已按职责拆分，`src/index.ts` 只保留入口装配。

| 模块 | 职责 |
|---|---|
| `src/host/config.ts` | 配置 schema、环境与日志校验、`baseUrl` 规范化 |
| `src/host/log.ts` | 按 `logLevel` 过滤 Host 日志 |
| `src/host/cloud-client.ts` | 云端请求、响应结构校验、超时与取消透传 |
| `src/host/tool.ts` | `trend_coach_search` 定义、渲染与工具错误映射 |
| `src/host/service.ts` | Typert Remote 服务与统一失败日志 |
| `src/shared/contracts.ts` | Host/Client 共用领域类型与长度上限 |

Client 仍为单文件；出现第 3 个页面型 tab 时再拆为 `panel.tsx` / `player.tsx` / `citations.ts`。

### 4.2 Browser 半

当前实现集中在 `src/client/index.ts`，启动顺序是硬约束：

```
apply(ctx)
├── ctx.effect($mount(remote info))            // 先挂载 Remote
│   └── 成功后 ctx.inject(['remote.trendCoach'], scoped => …)
│       ├── scoped.slots.inject('sidebar.right.pane.tab', Panel)
│       └── scoped.effect(document capture click handler)
├── ctx.effect(sidebarRightTabs.register(检索 tab, guide: [ ... ]))
├── ctx.effect(sidebarRightTabs.register(播放器 tab, guide: [ ... ]))
└── ctx.slots.inject('sidebar.right.pane.tab', Player)
```

**模块职责**

| 模块 | 职责 |
|---|---|
| `Panel` | 授权状态（设备登录/退出、设备码展示与轮询）+ 输入问题 → Remote 检索 → 渲染片段列表 → 点击打开播放器（先换播放会话） |
| `Player` | 读取 `useTabInfo()` 的 params/revision → 签名源 → hls.js/原生 `<video>` → `loadedmetadata` 后 seek，播到片段上限自动暂停 |
| `parseCitation` | 解析 `https://trend-coach.local/segment/:id?t&e`，只取 `segmentId`；拒绝其他 host |
| capture handler | 优先处理引用链接，其次处理 `seg-xxx` 代码块；两条路径都经 `getSegment` 取权威起止秒 |

**引用点击双路径**

1. 主路径：`<code>seg-xxx</code>` → `getSegment` → `openTab(player, params)`。不依赖模型配合，历史回答同样可用。
2. 备选：`https://trend-coach.local/...` 链接在 capture 阶段拦截。链接可点，但模型未必原样复制，不能作为唯一方案。

### 4.3 云端知识服务（契约视角）

| 能力 | 接口 | 当前状态 |
|---|---|---|
| 混合检索 | `POST /v1/kb/search` | 契约已定，mock 已验证 |
| 片段元数据 | `GET /v1/kb/segments/{segmentId}` | 契约已定，mock 已验证 |
| 账号 / 设备码 | 待定 | 契约已定，mock + dsh 已验（S2） |
| 视频签名 HLS | `POST /v1/playback/sessions` | 契约已定，mock + 浏览器已验（S1） |
| 学习进度 | `GET /v1/catalog/*` + `PUT /v1/progress/knowledge-points/{id}` | 契约已定，云端 + mock 已验证（M3） |

---

## 5. 关键链路

### 5.1 课程问答

```mermaid
sequenceDiagram
  participant S as 学员
  participant A as dsh Agent
  participant T as trend_coach_search
  participant C as 云端 KB
  participant M as 学员模型

  S->>A: 提问
  A->>T: execute(query, topK)
  T->>C: POST /v1/kb/search
  C-->>T: segments[]
  T-->>A: 结构化结果 + 引用链接
  A->>M: 系统提示 + 工具结果
  M-->>A: 回答（复制引用链接 / segmentId）
  A-->>S: Markdown 回答
```

**要求**：工具描述明确「回答课程内容前必须先调用」；无召回时返回固定文案，模型必须回答「课程未覆盖」，并只能引用 `relatedKnowledgePoints` 的标题作为相近内容提示，不得补造时间点。

### 5.2 引用点击 → 播放定位

```mermaid
sequenceDiagram
  participant U as 聊天 DOM
  participant H as Client capture
  participant R as Remote trendCoach
  participant P as 播放器 tab
  participant V as 视频服务

  U->>H: click(code/a)
  H->>H: 匹配 seg-id 或 trend-coach.local
  H->>R: getSegment(segmentId)
  R-->>H: {startSec, endSec, title}
  H->>P: openTab(kind, {params})
  P->>P: useTabInfo() + loadedmetadata
  P->>V: Range 请求 + seek(startSec)
```

**验收口径**：跳转成功率 ≥ 99%，seek 误差 ≤ 2s。服务端必须支持 HTTP Range。

**播放语义**（对齐 PRD F1.3，M2 落地）

| 行为 | 约定 |
|---|---|
| 起播位置 | 从 `startSec` seek 并尝试自动播放 |
| 片段时长 | 播放至 `min(endSec, startSec + 60)` 后自动暂停，避免一次播完整章 |
| 区间高亮 | 播放器展示 `[startSec, endSec]` 高亮区间与时间戳；超出区间仍可手动拖动 |
| 重复定位 | 同一 tab 再次引用时依赖 `navigation.revision` 重新 seek，不重建 `<video>` |
| 自动播放被拒 | 浏览器无用户手势时 `play()` 可能被拒；降级为「已定位、待点击播放」，不循环重试、不报错弹窗 |
| 上下文 | 播放器只读 tab params，不写全局状态；离开 tab 即丢弃播放状态 |

### 5.3 右栏主动检索

`Panel` → `scoped.remote.trendCoach.search(query, 5)` → 渲染片段按钮 → 与 5.2 相同的播放器路径。该链路不经过模型，可用于自检和调试。

---

## 6. 接口契约

### 6.1 工具 `trend_coach_search`

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 学员问题检索语句，去首尾空白后 1–500 字符 |
| `courseId` | string | 否 | 限定课程，≤64 字符且仅 `[A-Za-z0-9._-]` |
| `topK` | number | 否 | 取整收敛到 1–20，默认 5 |

**输出**

```jsonc
{
  "query": "string",
  "segments": [{
    "segmentId": "string",
    "courseId": "string",
    "chapterId": "string",
    "knowledgePointId": "string",
    "title": "string",
    "startSec": 0,
    "endSec": 0,
    "text": "string",
    "score": 0.0,
    "courseTitle": "string | undefined",
    "chapterTitle": "string | undefined",
    "knowledgePointTitle": "string | undefined"
  }],
  "relatedKnowledgePoints": [{
    "knowledgePointId": "string",
    "title": "string"
  }]
}
```

- `courseTitle/chapterTitle/knowledgePointTitle` 为展示字段，用于渲染「课程 → 章节 → 知识点」；Host 校验可选字段 ≤200 字符，工具与客户端优先展示标题，缺失时回退显示 ID，不阻塞引用。
- `relatedKnowledgePoints` 在空召回或最高分低于阈值时返回相邻知识点（≤ 5 条），支撑 F1.4「课程未覆盖 → 给最近知识点」；不得包含时间点，避免被误当引用。
- 响应边界：单次响应 ≤512KiB；单片段 `text` ≤4000 字符、`title` 与展示标题 ≤200 字符；`relatedKnowledgePoints` ≤5 条；越界或结构不合法整体失败，不静默截断。
- **当前差距**：M0 实现仅返回基础字段与空数组；上述字段为 M2 契约目标，云端与工具渲染需同步补齐。

**渲染约定**：每个片段附 `https://trend-coach.local/segment/<segmentId>?t=<start>&e=<end>`，并指示模型原样复制、不得自行生成时间点。空结果渲染固定拒答文案，并附 `relatedKnowledgePoints` 标题作为「相近内容」提示（仅标题，不给时间点）。

### 6.2 Remote 方法

| 方法 | 入参（位置参数） | 结果 |
|---|---|---|
| `trendCoach/search` | `query: string, topK: number, signal` | `{query, segments[], relatedKnowledgePoints[]}` |
| `trendCoach/getSegment` | `segmentId: string, signal` | `Segment`（含展示标题） |
| `trendCoach/createPlaybackSession` | `segmentId: string, signal` | `{sessionId, playlistUrl, expiresAt, watermark?}` |
| `trendCoach/authStatus` | 无 | `{mode: 'device'\|'credential'\|'none', authorized, deviceId?}` |
| `trendCoach/beginDeviceAuth` | `signal` | `{userCode, verificationUri, expiresAt, interval}` |
| `trendCoach/pollDeviceAuth` | `signal` | `{status: 'pending'\|'authorized'\|'expired'}` |
| `trendCoach/signOut` | 无 | `{signedOut: true}`；先尽力调用 `POST /v1/auth/revoke` 吊销本设备令牌，再删除本地 grant，网络失败不阻塞登出 |

- 客户端调用返回 `{ ok: true, value } | { ok: false, error }`。
- spec 的 `package` 必须为 `dsh-plugin-trend-coach`；method wire 名为 `服务名/方法名`；result 使用 strict codec。
- `signal` 固定为最后一个参数，服务端必须转发到 fetch。
- 客户端先 `$mount`，成功后再动态 `inject(['remote.trendCoach'])`；**禁止**写入静态 `inject`。

### 6.3 云端 HTTP

**检索**

```http
POST /v1/kb/search
Authorization: Bearer <token>
Content-Type: application/json

{ "query": "...", "topK": 5, "courseId": "optional" }
```

响应：

```jsonc
{
  "segments": [/* Segment，含 courseTitle/chapterTitle/knowledgePointTitle */],
  "relatedKnowledgePoints": [{ "knowledgePointId": "string", "title": "string" }]
}
```

`score` 为 0–1；`relatedKnowledgePoints` 可为空数组，仅在 `segments` 为空或低分时填充。云端不得在相邻知识点中携带 `startSec/endSec`。请求与响应边界同 §6.1：Host 在调用前校验入参，返回后校验结构、字段上限与响应体积。

**片段**

```http
GET /v1/kb/segments/{segmentId}
Authorization: Bearer <token>
```

**播放会话**

```http
POST /v1/playback/sessions
Authorization: Bearer <token>
Content-Type: application/json

{ "segmentId": "seg-tc101-m3-kp3-1" }
```

响应：

```jsonc
{
  "sessionId": "string",
  "playlistUrl": "https://media.example.com/hls/index.m3u8?token=...",
  "expiresAt": 1760000000000,
  "watermark": { "label": "学员 1001" }
}
```

- `playlistUrl` 是**短时效签名地址**，其 m3u8 内的 key URI 与分片地址同样携带同一 token；浏览器直接向媒体源取流，不需要也不得携带 Bearer（A15）。
- `expiresAt` 必须覆盖一个片段的完整播放窗口（当前片段上限 60s）；mock 取 10 分钟，真实云端按云点播签名策略下发。播放中过期由 hls.js 报网络错误，播放器给出可读提示。
- 媒体源必须返回 CORS 允许头（至少 `GET/OPTIONS`、`Range`、`Content-Type`），否则浏览器侧 hls.js 取流失败；文档与部署检查表须包含该条。
- 响应同样是 JSON 对象；字段不合法则整体失败，不进入播放器。

**设备码授权**

```http
POST /v1/auth/device/code
Content-Type: application/json

{ "clientId": "dsh-plugin-trend-coach", "deviceId": "插件首启随机生成" }
```

响应 `{ deviceCode, userCode, verificationUri, expiresIn, interval }`；客户端展示设备码并每 `interval` 秒轮询：

```http
POST /v1/auth/device/token
Content-Type: application/json

{ "deviceCode": "..." }
```

响应 `{ "status": "pending" }` / `{ "status": "expired" }` / `{ "status": "authorized", "grant": {...} }`，grant 为 `{ accessToken, refreshToken, expiresAt, deviceId }`。

```http
POST /v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "...", "deviceId": "..." }
```

响应为新的 grant（access/refresh 双双轮换，旧 refresh 立即失效）。业务接口携带 `Authorization: Bearer <accessToken>` 与 `x-device-id: <deviceId>`；grant 只存 dsh credentials，不进配置、日志或浏览器。

**错误语义**：`401` 未授权/令牌过期（设备模式下自动刷新一次后仍失败则提示重新登录）、`403` 设备不匹配（提示重新登录）、`404` 片段不存在（提示内容已下架）、`429` 限流（退避提示）、`5xx` 服务不可用（可重试提示）。响应必须是 JSON 对象；`segments` 必须是数组；任一元素不合法则整体失败，不做静默丢弃。

### 6.4 播放器 tab 与引用 URL

**tab 参数**

| 字段 | 类型 | 必填 |
|---|---|---|
| `segmentId` | string | 否（无片段时展示空播放器） |
| `title` | string | 否 |
| `startSec` | number | 否（来自 `getSegment`，不信任 URL） |
| `endSec` | number | 否（来自 `getSegment`，不信任 URL） |
| `src` | string | 否（播放会话下发的签名 `playlistUrl`） |
| `watermark` | string | 否（播放会话下发的展示标签） |
| `error` | string | 否（会话换取失败时的可读提示） |

同一 tab 重复打开通过 `navigation.revision` 触发重新定位。

**播放源与解密**

- 打开任何片段前先调 `createPlaybackSession`（Host 持 Bearer），浏览器只拿到签名 `playlistUrl`；不把 Bearer、也不把长期播放地址暴露给客户端。
- dsh/Chromium 不内置 HLS 播放能力，加密 HLS 由插件内置的 hls.js 经 MSE 播放（A9）；普通 MP4 仍走原生 `<video>`。
- **选择顺序**：`Hls.isSupported()` 为真时一律走 hls.js；只有 MSE 不可用且 `canPlayType('application/vnd.apple.mpegurl')` 非空时才交给原生播 HLS。不得用 `canPlayType` 作为“支持 HLS”的唯一依据——Chrome on macOS 会返回 `maybe` 但实际不能播。
- 播放语义：seek 到 `startSec` 后尝试自动播放，被浏览器拦截时显示“点击播放”；播放到 `min(endSec, startSec + 60)` 自动暂停并提示继续；`revision` 变化重新定位。水印覆盖层随播放时间每 15s 换角，作为威慑与追溯线索；取证级水印另行评估（A11）。
- 解密失败、签名过期、播放中断均落到播放器内可读提示，不静默黑屏。

**引用 URL**：`https://trend-coach.local/segment/{encodeURIComponent(segmentId)}?t={startSec}&e={endSec}`。客户端只接受该 host 与 `/segment/` 前缀，且 `t/e` 仅作兼容展示——实际定位以 `getSegment` 返回的权威起止秒为准，避免历史回答或模型改写时间点。

### 6.5 数据模型与不变量

| 不变量 | 说明 |
|---|---|
| `segmentId` 全局唯一且稳定 | 跨版本、跨回答可复用；下架后返回 404 |
| `startSec < endSec`，整数秒 | 映射粒度为秒 |
| `courseId/chapterId/knowledgePointId` 稳定 | 转写、文章、视频片段共用同一知识点 ID |
| `score ∈ [0, 1]` | 仅用于排序与展示，不作为可信度承诺 |
| 不下发全库正文 | 只返回 Top-K 片段与元数据 |

### 6.6 M3 体系页与学习进度（客户端、云端与 mock 已实现；后台内容管理待 M3.2）

**Remote 方法（新增）**

| 方法 | 入参（位置参数） | 结果 |
|---|---|---|
| `trendCoach/catalogCourses` | `signal` | `{courses: CatalogCourseSummary[]}` |
| `trendCoach/catalogCourse` | `courseId: string, signal` | `{courseId, title, chapters[]}`（知识点含进度） |
| `trendCoach/knowledgePoint` | `knowledgePointId: string, signal` | `{knowledgePointId, courseId, chapterId, title, article?, segmentId?, adjacentKnowledgePoints[]}` |
| `trendCoach/reportProgress` | `knowledgePointId: string, watchedSec: number, completed: boolean, signal` | `{knowledgePointId, watchedSec, completed, updatedAt}` |

**云端 HTTP（Bearer + `x-device-id`）**

```http
GET /v1/catalog/courses
GET /v1/catalog/courses/{courseId}
GET /v1/catalog/knowledge-points/{knowledgePointId}
PUT /v1/progress/knowledge-points/{knowledgePointId}
```

课程列表：

```jsonc
{
  "courses": [{
    "courseId": "string",
    "title": "string",
    "chapterCount": 3,
    "knowledgePointCount": 24,
    "completedCount": 5
  }]
}
```

课程树：

```jsonc
{
  "courseId": "string",
  "title": "string",
  "chapters": [{
    "chapterId": "string",
    "title": "string",
    "position": 0,
    "knowledgePoints": [{
      "knowledgePointId": "string",
      "title": "string",
      "position": 0,
      "segmentId": "seg-...",
      "watchedSec": 120,
      "completed": false
    }]
  }]
}
```

知识点详情：

```jsonc
{
  "knowledgePointId": "string",
  "courseId": "string",
  "chapterId": "string",
  "title": "string",
  "article": { "markdown": "string", "version": 1, "publishedAt": 1760000000000 },
  "segmentId": "seg-...",
  "adjacentKnowledgePoints": [{ "knowledgePointId": "string", "title": "string" }]
}
```

进度上报：

```jsonc
{ "watchedSec": 120, "completed": false }
```

- 只返回 `published` 课程、章节、知识点与文章；未发布或不存在返回 `404`。
- 课程列表 ≤50；单课程 ≤50 章节、总知识点 ≤1000；标题 ≤200 字符；单次响应 ≤512KiB。
- 课程树不携带 `startSec/endSec`；播放定位仍以 `getSegment` 的权威起止秒为准。`segmentId` 可缺省，表示该知识点暂无可用片段。
- `article` 可为 `null`；`markdown` ≤20000 字符，只允许 Markdown 子集，不执行 HTML/脚本。文章与标题按不可信内容处理，Host 校验长度；客户端使用内置 Markdown 子集渲染器，只生成 React 元素，不使用 `dangerouslySetInnerHTML`，不加载外部资源。
- `watchedSec` 为整数秒，范围 0–86400；云端按 `max(旧值, 新值)` 保存，`completed` 一旦为 `true` 不可回退；接口幂等，重复上报返回同一结果。
- `adjacentKnowledgePoints` ≤5 条且仅含 ID 与标题，不携带时间点。
- 进度属于业务写入，不走 `POST /v1/events`，不受指标同意开关影响；只允许当前授权设备读写本人进度，设备不匹配 `403`，超限 `429`。
- 后台管理接口不属于插件契约，学员令牌不可访问。体系页到片段跳转 ≤3 次点击；播放器在 30s、暂停、结束与片段播完时上报，失败只记 debug 日志，不阻塞播放。

---

## 7. 关键设计决策（ADR）

| 编号 | 决策 | 理由 | 代价 |
|---|---|---|---|
| A1 | Host/Client 双半，经 Typert Remote 通信 | 复用 dsh 会话与权限；不另起端口；类型契约可生成 | 受 Remote 注入顺序约束 |
| A2 | 检索走工具，而非客户端直连云端 | 模型需先取证据再作答；云端凭据留在 Host | 工具调用增加一轮延迟 |
| A3 | 引用以 `segmentId` 代码块为主路径 | dsh 不渲染自定义 scheme；模型不可靠复制链接 | 需要 `getSegment` 接口 |
| A4 | 播放器为独立右栏 tab | 与聊天解耦，可重复定位；支持历史引用 | tab 状态需参数化 |
| A5 | 云端只读 + Top-K | 降低内容外流与越权面 | 离线不可用 |
| A6 | 学员 BYOK，插件不碰模型 Key | 成本与合规归属清晰 | 低能力模型影响体验 |
| A7 | 单 npm 包同时含双半 | 安装一次、版本一致 | 构建需分别产出 Host/Client |
| A8 | 预览期锁定 dsh 精确版本 | API 漂移风险高；`engines.dsh` 与 DSH peer 依赖由插件管理器强制校验，不满足会阻止安装/激活 | 升级需主动跟进并把 `engines.dsh` 收紧到实测区间 |
| A9 | 内置 hls.js 播放加密 HLS，优先走 MSE | dsh 不提供 HLS 播放器；Chrome on macOS 对 `canPlayType` 返回 `maybe` 却无法播放，不能据此跳过 hls.js | client bundle 约 588KB（min）；S1 已验明文/加密 HLS、seek、片尾暂停，后续再评估按需拆包 |
| A10 | credential-ref 内部 token 作回退，设备码换短时 token（S2 已闭环） | 公测前必须有账号体系（D5），但内部试用不应被账号体系阻塞 | 云端需实现设备码/刷新/设备绑定；Host 统一走 AuthManager 处理 401/403 |
| A11 | 水印先做客户端动态覆盖层，取证级水印后置 | 零云端改造即可上线，满足「提高抓取成本」的定位 | 覆盖层可被系统录屏绕过；M4 评估服务端取证水印 |
| A12 | TTS 使用浏览器 Web Speech API（系统语音） | dsh 无 TTS 服务；Web Speech 不需 shell、不引入外网依赖，符合最小权限 | 音色与质量依赖操作系统；M5 需验证中文可用性并保留降级文案 |
| A13 | 指标走云端鉴权事件，不接第三方分析 SDK | dsh 产品分析仅桌面端，且不把第三方标识作为分析维度 | 已落地事件白名单与同意开关（S8），默认关闭、可撤回 |
| A14 | 兼容性以 `engines.dsh` + 市场兼容性判据为准 | 插件管理器按 `engines.dsh`（否则 DSH peer 依赖）拦截安装与激活 | 版本范围必须收紧，发布前跑最低支持版本矩阵 |
| A15 | 播放地址由 Host 换取签名会话，浏览器不持 Bearer | Bearer 留在 Host；签名 URL 只对一次播放有效，可按用户/设备/并发约束 | 多一个端点与会话 TTL；过期后需重新换会话 |
| A16 | 设备 grant 存 dsh credentials（`credentialKey('trend-coach','device')`），刷新走 `modifyRecord()` | 宿主提供 0600 文件与跨进程串行读改写，避免并发刷新互相覆盖；插件不自定义密钥落盘 | 依赖 `credentials` 服务且必须静态 `inject`；`$DSH_HOME/.credentials.yaml` 的迁移由 dsh 管理 |

---

## 8. 生命周期与状态

- **Host**：由 profile bundle 激活；工具与 Remote 随 `apply` 注册。Host 更新需重启 dsh。
- **Client**：bundle 加载后执行 `apply`；所有注册必须包在 `ctx.effect` 内并返回清理函数。Browser 半支持热更新。
- **Remote**：`$mount` 返回 unmount；插件卸载时先释放动态 inject 作用域，再 unmount。
- **UI 状态**：面板查询状态为组件本地状态；播放器位置来自 tab params，不写入全局 store。跨会话历史由 dsh 管理。
- **重复导航**：`revision` 自增即为“重新定位”信号，组件 effect 依赖 `revision`。

---

## 9. 错误处理

| 场景 | Host 行为 | 客户端表现 |
|---|---|---|
| 参数非法 | 边界校验拦截（query 1–500、topK 1–20、courseId/segmentId 白名单），Remote 映射 `gateway/bad-request`，工具返回普通错误 | 模型收到可读错误；面板显示中文文案 |
| 网络超时 | `AbortSignal.timeout` 中止，映射 `gateway/internal` + 超时文案 | 面板显示可读错误；回答提示重试 |
| 401/403 | 自动刷新一次后仍失败抛鉴权错误（`AUTH_EXPIRED` / `DEVICE_MISMATCH`） | 提示登录/授权失效 |
| 404 | 上游 404 映射「内容不存在或已下架」 | 播放器提示「引用片段不可用，可能已下架」 |
| 429 | 上游 429 映射「请求过于频繁」 | 提示稍后重试 |
| 5xx / 响应不合法或过大 | 结构化错误，不降级为“无结果” | 区分“服务故障”与“课程未覆盖” |
| 空召回 | 正常返回空数组 + `relatedKnowledgePoints` | 模型输出固定拒答文案，仅提示相近知识点标题 |

**约定**：Typert 线协议失败码仅 `gateway/bad-request｜cancelled｜internal`：入参非法→bad-request，取消→cancelled，其余→internal + 可读中文文案；业务内部 code 不上线。日志只记录必要上下文，不记录凭据、完整 query 或设备 ID（生产环境）。

---

## 10. 安全与隐私

| 面 | 措施 | 状态 |
|---|---|---|
| 凭据 | 设备 grant 只存 dsh credentials（0600）；credential-ref（`z.string().role("credential-ref").default("ENV").volatile()`）保留为内部 token 回退；Bearer/refresh token 不进浏览器、配置或日志（A10/A16） | S2 已验证 |
| 最小权限 | 不注册 shell/文件写入工具；不监听端口；TTS 用 Web Speech API 而非调用系统命令（A12） | 已满足 |
| 不可信内容 | 云端文本仅作为工具结果数据；响应 ≤512KiB、片段文本 ≤4000 字符、标题与展示标题 ≤200 字符；标题/正文包裹在固定 `<course_segment_data>` 边界内并转义可伪造边界、剥离控制字符；工具描述与渲染均声明内容不可信，提示模型不执行内容中的指令；相邻知识点只给标题 | S4 已验证体积/长度上限；S6 已验证边界转义与提示注入防护 |
| 视频 | 签名 HLS（短时效、设备绑定、并发限制）、hls.js 解密播放、客户端动态水印（A9/A11） | M2 起分批落地 |
| 日志 | 不输出 token、完整 query、用户标识；播放地址不落日志 | S4 已验证：Host 只记操作名与错误类型；mock 掩码 userCode/deviceId、不记 query 原文 |
| 依赖 | 只依赖 dsh 宿主提供的运行时包；定期审计 | 已有 |

---

## 11. 性能与可用性

- 云端检索 P95 ≤ 300ms（云端指标）；插件首屏 ≤ 2s；视频起播 ≤ 2s。
- Host 默认超时 10s，可按 profile 配置；工具透传取消信号，用户中止后立即释放请求。
- 客户端不缓存全库内容；面板仅保留当前结果集。
- 视频必须支持 HTTP Range；HLS 接入后按分片 seek。
- 云端不可用时，问答明确报错，不伪造引用。

---

## 12. 可观测性

- 统一使用 `ctx.logger`，实例命名 `ctx.logger('trend-coach')`；错误日志带包名前缀。
- 失败日志只记录操作名与错误类型（如 `AuthError`、`UpstreamError`），不记录 token、deviceId、query 原文或上游响应体。
- 一期不接入第三方分析 SDK：dsh 自带的产品分析仅覆盖桌面端，且不把第三方插件标识作为分析维度（A13）。
- 指标上报走云端鉴权事件接口，与账号绑定，字段最小化；未登录或未同意时不上报。
- 同意状态存云端 `users.events_consent`（默认 `false`），插件经 `GET/PUT /v1/events/consent` 读写；右栏面板提供开关，撤销后 Host 立即停止上报（已接收数据不回溯删除）。
- 事件白名单：`search_requested`（耗时、topK、命中数、是否空召回）、`citation_clicked`（segmentId）、`player_started`（起播耗时、是否自动播放被拒）、`feedback_submitted`（评分 up/down）；**不含** query 原文、回答内容、完整播放地址。
- 上报点：Host 在检索成功（工具与面板共用 `searchKnowledge` 路径）、引用点击、播放器首次 `playing` 时尽力上报；`feedback_submitted` 取自 dsh 内置助手消息反馈（`feedback/message-put` 会话事件），只转发 `positive → up` / `negative → down`，不转发分类、备注或消息内容，且只处理用过 `trend_coach_search` 的会话。失败只记 debug 日志，不影响检索与播放主流程。
- 关键错误按 §9 的错误码分桶，避免把「空召回」与「服务故障」混在同一指标。

---

## 13. 代码结构（现状与演进）

```
src/
├── index.ts                 # Host 入口：name/inject/Config/apply 装配
├── auth.ts                  # Host：设备码授权、grant 存储、令牌刷新
├── errors.ts                # Host：入参/响应边界校验、错误映射、限长 JSON 读取
├── untrusted.ts             # Host：不可信文本边界包裹、控制字符剥离、边界伪造转义
├── host/
│   ├── config.ts            # 配置 schema、环境/日志校验、baseUrl 规范化
│   ├── log.ts               # 按 logLevel 过滤日志
│   ├── cloud-client.ts      # 云端请求与响应结构校验
│   ├── events.ts            # 指标事件上报与同意状态缓存
│   ├── tool.ts              # trend_coach_search 工具与渲染
│   └── service.ts           # TrendCoach Remote 服务
├── shared/
│   └── contracts.ts         # Host/Client 共用领域类型与上限
└── client/
    ├── index.ts             # Client：Remote spec、面板、播放器、引用拦截
    └── dsh.d.ts             # dsh 客户端服务的最小类型声明
scripts/build-client.mjs     # esbuild → lib/client.js（__ModuleLoader__ 包装）
cordis.patch.yml             # bundle patch：插入插件（config 走 schema 默认值）
spike/                       # mock KB、fixtures、测试视频
test/                        # Host 边界、配置、不可信文本、mock 契约、发布包断言
docs/                        # 需求、架构、规范
```

**演进规则**：`index.ts` 保持薄入口；云端客户端、工具与 Remote 服务分别演进。Client 组件超过 2 个页面型 tab 时拆为 `panel.tsx` / `player.tsx` / `citations.ts`。共享类型放入 `src/shared/`，但不得把 Node 专属代码引入 Client bundle。

---

## 14. 测试与验收

**每次改动的最低门槛**

1. `npm run typecheck`
2. `npm run build`
3. `npm test`（Host 边界、配置校验、不可信文本、mock 云端契约、打包清单）
4. 本地 mock：`npm run mock` + dsh 新 profile 安装 tarball
5. 浏览器冒烟：面板检索、Remote 挂载、引用点击、seek 定位
6. `npm pack` 后在全新 profile 安装，确认 bundle 注册与双半加载

**分层策略**

| 层级 | 内容 | 状态 |
|---|---|---|
| 类型/构建 | tsc strict + esbuild | 已有 |
| 契约 | 工具/Remote/云端响应 schema 校验 | Host 手写校验 + `test/*.test.mjs` 断言 |
| 集成 | mock KB + 插件 E2E | mock 六接口契约已脚本化；GitHub Actions 跑 typecheck + test；浏览器 E2E 仍手工 |
| 兼容 | dsh 版本矩阵（最低支持版本 + 当前版） | 最低=当前=dsh 0.2.1-rc.5；`engines`/peer 由 `test/package.test.mjs` 断言；新 profile 安装由 `npm run smoke` 验证 |

**契约测试（2026-10-31）**：`npm test` 启动独立端口的 mock，覆盖设备码授权/轮换/设备绑定、检索与空召回、非法入参、片段详情、播放会话与签名 HLS、Range、401 过期；同时断言 Host 入参/响应边界、错误映射、不可信文本处理与发布包清单。浏览器内的 Remote 挂载、引用点击与播放定位仍按第 4–6 项手工冒烟。

**发布前检查**：版本号、peer 精确版本、`files` 清单、无凭据、`npm run smoke`（临时 DSH_HOME 新 profile 安装并启用插件）、PRD/架构/规范同步。

---

## 15. 里程碑映射

| 阶段 | 架构增量 | 本文需更新 |
|---|---|---|
| M0（已完成） | 双半骨架、工具、Remote、引用/播放器链路、打包验证 | — |
| M2 | 接通真实云端、credential-ref 鉴权、错误码、显示字段/相邻知识点契约、面板完善、播放器接 hls.js + 客户端水印、指标事件上报 | §4、§6、§10、§12 |
| M3 | 设备码换取短时 token、体系页、学习进度、后台接口 | 新增账号与体系页章节 |
| M4 | 多模态输入、ASR 对接、上下文携带；评估取证级水印 | 新增输入管线章节 |
| M5 | 互动课堂、Web Speech TTS、白板、测验 | 新增课堂运行时章节 |
| M6 | 安装包、灰度、兼容矩阵、合规 | 发布与运维章节 |

---

## 16. 开放问题

1. 设备码主流程已按轮询实现并验证（S2）；账号与后台登录方式已定（M3.1：管理员创建账号 + 密码/邀请码，设备授权页绑定账号）。剩余待定：access/refresh token 实际 TTL、并发设备上限与多设备登录策略。credential-ref 仍作为内部 token 回退。
2. 引用链接的 host（`trend-coach.local`）是否长期保留；若云端提供真实域名，拦截逻辑需同时支持，且不得放宽到任意 host。
3. 插件侧提示注入防护已落地（S6：固定边界 + 转义 + 控制字符剥离）；云端片段文本长度上限仍需在 M2 与云端定稿（建议单片段 ≤ 2KB、总 ≤ 12KB，超限截断并标记，当前插件按 4KB/512KiB 校验）。
4. dsh 预览版后续版本若改变 Remote/slot API，升级窗口与回滚策略待定；`engines.dsh` 需随兼容矩阵同步收紧。
5. Web Speech API 在 macOS/Windows 上的中文音色与可用性需在 M5 实机验证；不可用时降级为纯文字讲解。
6. 客户端水印能否满足版权方要求、是否需要服务端取证水印，需 M4 与法务/版权方确认。

---

## 17. 需求覆盖矩阵

以 PRD v1.3 为准，标注架构承接位置与闭合状态。状态含义：**已闭合**＝设计可落地且有验证；**部分**＝设计明确但存在契约/实现差距；**待设计**＝后续里程碑单独补充。

| 需求 | 优先级 | 架构承接 | 状态 | 闭合前置 |
|---|---|---|---|---|
| F1 课程问答与视频溯源 | P0 | §4.1、§5.1、§5.2、§6.1–6.4 | 已闭合 | mock 展示字段（S5）+ 真实云端检索/播放/引用定位联调（S7） |
| F1.3 自动播放 30–60s、片段高亮、水印 | P0 | §5.2 播放语义、§6.4、A11 | 已闭合 | mock（S1+S3）+ 真实云端签名 HLS 解密播放（S7） |
| F1.4 未覆盖给最近知识点 | P0 | §6.1 `relatedKnowledgePoints` | 已闭合 | mock 展示（S3）+ 真实云端低置信过滤与空召回相邻知识点（S7）；阈值仍需 M1 评估集校准 |
| F2 知识体系化呈现 | P0 | §4.3、§6.6 | 部分 | 体系页、文章阅读与学习进度已实现；后台内容管理待 M3.2 |
| F3 学习场景即时提问（多模态） | P0 | §1 范围外，M4 补充 | 待设计 | 选中文本/页面上下文采集方式、ASR 接入 |
| F4 AI 互动课堂 | P1 | A12、M5 | 待设计 | 课堂运行时章节、Web Speech 验证 |
| F5 后台管理 | P0 | 云端职责，M3 | 部分 | 账号与后台登录、React 内容控制台待 M3.1/M3.2 验收 |
| NFR 性能（检索 P95 ≤ 300ms、首屏 ≤ 2s、起播 ≤ 2s） | P0 | §11 | 部分 | 真实环境压测；hls.js 懒加载 |
| NFR 安全（最小权限、不可信内容、签名播放、水印） | P0 | §10、A10、A11–A13、A16 | 部分 | 设备码/凭据、水印、输入/响应上限、日志脱敏、提示注入防护（S1–S7）、真实云端 429 提示（S9）已验证；真实环境压测待 M6 |
| NFR 合规（风险提示、AI 合规、隐私） | P0 | §10、PRD §7 | 部分 | 面板与播放器常驻免责声明（S6）、指标同意与撤回（S8）、退出并注销与服务端吊销（S9）已验证；账号级删除随 M3 |
| 指标（激活/引用点击/满意度等） | P0 | §12、A13 | 部分 | 检索/引用/播放三类事件与同意开关已验证（S8）；满意度（点赞/点踩）与激活率聚合未接入 |

**S1 验证记录（2026-10-31，mock + dsh 0.2.1-rc.5 + Chrome）**：`POST /v1/playback/sessions` → 签名 m3u8 → key/分片（均带 token）→ hls.js 解密播放，起播定位到 `startSec`；`min(endSec, start+60)` 片尾暂停与“继续播放”提示生效；`<code>seg-xxx</code>` 与 `trend-coach.local` 链接两条引用路径都经 `getSegment` 取权威起止秒，URL 里的 `t/e` 被忽略。CORS、错误 403（token 无效/过期）已验证。

**S2 验证记录（2026-10-31，mock 授权服务 + dsh 0.2.1-rc.5 + Chrome）**：面板发起设备码 → 展示 `userCode` / `verificationUri` → 批准后轮询返回 grant 并写入 dsh credentials；检索携带 Bearer + `x-device-id` 成功，设备不匹配 403。服务端吊销 access token 后，下一次检索触发 401 → Host 用 refresh token 轮换并重试成功，旧 refresh 复用被拒；重启 dsh 后授权状态保留；退出登录删除 grant，检索提示未授权。

**S3 验证记录（2026-10-31，mock + dsh 0.2.1-rc.5 + Chrome）**：无召回时 mock 返回 `relatedKnowledgePoints`（≤3 条、仅标题），工具渲染与右栏面板均展示；模型回答明确「课程未覆盖」，并标注相关知识点不构成引用、无时间点，回答中无引用链接。播放器新增 `[startSec, endSec]` 高亮条与当前位置标记：485–750s 片段定位后高亮正确，播至 `min(endSec, start+60)=545s` 自动暂停仍生效。

**S4 验证记录（2026-10-31，mock + dsh 0.2.1-rc.5 + Chrome）**：Host 边界校验 query 1–500、topK 1–20、courseId/segmentId 白名单；编译产物断言覆盖合法/非法入参与错误映射（bad-request / cancelled / internal）。服务端重启导致 refresh 失效时，面板显示「登录已过期，请重新设备授权」（无内部 code 前缀），重新设备授权后检索恢复；合法格式但不存在的片段返回「引用片段不可用，可能已下架」。mock 日志仅记录 query 长度与掩码后的 userCode/deviceId，无完整 query；正常检索与无召回兜底无回归。

**S5 验证记录（2026-10-31，mock + dsh 0.2.1-rc.5 + Chrome）**：mock 在检索与片段详情返回 `courseTitle/chapterTitle/knowledgePointTitle`；右栏面板与工具渲染均按「课程 / 章节 / 知识点」展示标题。知识点 `KP-3.2` 故意不配标题时，面板回退显示 `KP-3.2`，课程与章节标题仍正常展示。点击结果与回答中的引用链接，播放器仍按 `getSegment` 返回的权威起止秒定位（2300s、1870s），无回归。

**S6 验证记录（2026-10-31，mock + dsh 0.2.1-rc.5 + Chrome）**：工具渲染将标题/正文包裹在固定 `<course_segment_data>` 边界内，控制字符被剥离，正文伪造的边界 token 被转义为全角 `<`；编译产物断言覆盖剥离、转义与包裹行为。工具描述声明云端内容不可信并要求回答结尾附免责声明。右栏面板与播放器（含无播放地址状态）常驻展示「课程内容仅供学习，不构成投资建议。」。模型回答「止损」片段时输出课程/章节/知识点层级、保留原样引用链接并附免责声明；面板检索与引用定位无回归。

**S7 验证记录（2026-10-31，真实云端 trend-coach-cloud + PostgreSQL + dsh 0.2.1-rc.5 + Chrome）**：面板设备码重新授权成功；检索「均线」返回 `seg-tc101-m2-kp2-1`，课程/章节/知识点标题与 920–1150s 正确；点击结果打开课程视频，加密 HLS 经 hls.js/MSE 解密，播放位置 920.5s → 929.9s，`readyState=4`、无错误；对话触发 `trend_coach_search`，模型 5s 内产出 2 条引用并附免责声明；点击引用定位约 923s。服务端吊销 access token 后，下一次检索按 `401 → /v1/auth/refresh 200 → 检索 200` 自动恢复。联调中发现并修复低置信误召回：原 `SEARCH_MIN_SIMILARITY=0.05` 让无关 query「量子纠缠与超导」仅凭单个补位 trigram（0.0588）命中；现区分召回阈值（0.05，只捞候选）与引用置信阈值（`SEARCH_MIN_CONFIDENCE=0.15`），低于置信度的候选不返回，全部过滤后按未覆盖处理。修复后该 query 显示「课程未覆盖该问题。」，「趋势反转怎么判断」的 0.1 低置信片段被过滤；临时下架「均线」片段后，面板显示「课程未覆盖」及「相关知识点（仅标题）：均线的方向与排列 · KP-2.1」，恢复后命中恢复。云端新增契约测试覆盖低置信按未覆盖处理与相邻知识点回退。

**S8 验证记录（2026-10-31，真实云端 trend-coach-cloud + PostgreSQL + dsh 0.2.1-rc.5 + Chrome）**：右栏面板新增指标同意开关，默认未勾选；授权后读取 `GET /v1/events/consent` 显示 `false`，未同意时检索后云端 `events` 表无新记录。勾选后 `PUT /v1/events/consent` 返回 `true` 并落库：面板检索上报 `search_requested`（hits=3、topK=5、empty=false、6ms），点击结果上报 `citation_clicked`（segmentId），播放器首次 `playing` 上报 `player_started`（startupMs=36、autoplayBlocked=false）；对话触发 `trend_coach_search` 上报 hits=1，点击回答内引用链接再上报 `citation_clicked`，事件均不含 query 原文或回答内容。取消勾选后云端同意状态回到 `false`，再次检索不再新增事件。云端契约测试覆盖同意默认值/读写/撤回与事件门禁，插件 mock 契约测试同步覆盖。

**S9 验证记录（2026-10-31，真实云端 trend-coach-cloud + PostgreSQL + dsh 0.2.1-rc.5 + Chrome）**：云端以 `RATE_LIMIT_SEARCH_PER_MINUTE=3` 启动，面板连续检索第 4 次显示「请求过于频繁，请稍后重试」，无内部状态码；恢复默认配额后检索恢复。切换右栏 tab 再返回，输入框与上次检索结果（含错误提示）保留。点击「退出并注销」后云端 `devices.status` 变为 `revoked`、该设备 3 个 access 与 3 个 refresh 全部标记吊销，面板回到未授权并隐藏指标开关；重新设备授权后设备状态恢复 `active`，检索正常。

**M2 前必须闭合**：真实云端检索返回展示字段与播放语义已闭合（S7）。设备码授权、错误码映射与日志脱敏（S2/S4）、展示字段与回退（S5）、提示注入防护与常驻免责声明（S6）、低置信回退（S7）、事件同意与上报（S8）、429 提示与注销（S9）已闭合。剩余：检索阈值按 M1 评估集校准。

---

## 18. 待决策清单

| 事项 | 当前结论 | 状态 | 决策位置 |
|---|---|---|---|
| HLS 播放方案 | 内置 hls.js，MSE 优先；MSE 不可用才回退原生 HLS | 已决并完成 S1 验证 | A9 |
| 播放会话换取 | Host `POST /v1/playback/sessions` 换签名 `playlistUrl`，浏览器不持 Bearer | 已决并完成 mock 验证 | A15、§6.3 |
| 鉴权分期 | credential-ref 内部 token 作回退；设备码换短时 token 已实现并验证（S2） | 已决并完成 S2 验证 | A10、A16、§6.3 |
| 水印实现 | M2 客户端动态覆盖层；取证级后置 | 已决（取证待评估） | A11、§16.6 |
| TTS 方案 | 浏览器 Web Speech API | 已决（中文可用性待验证） | A12、§16.5 |
| 指标采集边界 | 云端鉴权事件，字段白名单，同意后可撤回 | 已决 | A13、§12 |
| 最近知识点接口 | 检索响应扩展 `relatedKnowledgePoints`（仅标题） | 已决（云端待实现） | §6.1、§6.3 |
| dsh 版本门禁 | 以 `engines.dsh` + peer 精确版本为安装/激活判据 | 已决 | A8、A14、规范 §2 |
| 引用 host | 保留 `trend-coach.local`，真实域名上线时增量支持 | 待定 | §16.2 |
| 片段长度/注入防护 | 单片段 ≤ 2KB、总 ≤ 12KB（建议值） | 待定 | §16.3 |
| 设备码流程 | 轮询/回调、token 生命周期 | 待定 | §16.1 |
| 服务端取证水印 | 是否引入 | 待定 | §16.6 |
