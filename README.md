# dsh-plugin-trend-coach

趋势交易课程伴学插件：在 dsh 里向课程知识库提问，回答带视频出处，点一下就能定位到课程片段。

学员本地运行 dsh 客户端并使用自己的模型 Key（BYOK）；插件只负责课程检索、引用与播放，不做模型推理。

## 功能

- **课程检索工具**：`trend_coach_search` 调用云端知识库，返回片段、起止秒与「课程 / 章节 / 知识点」标题；无召回时给出相关知识点标题，并明确课程未覆盖。
- **引用可溯源**：回答中的 `seg-xxx` 代码块可点击，右栏播放器按云端返回的权威起止秒定位；也拦截 `https://trend-coach.local/segment/...` 链接。
- **右栏学习面板**：检索、设备登录、播放器与免责声明常驻。
- **设备码授权**：面板发起授权、展示设备码与验证地址；token 存入 dsh credentials，过期自动刷新，可退出并吊销本设备。
- **隐私可控**：指标上报默认关闭，学员显式同意后才上报白名单事件，可随时撤回。

## 环境要求

- dsh `0.2.1-rc.5`（`engines.dsh` 强制门禁 `>=0.2.1-rc.5 <0.3.0`，不满足会阻止安装/激活）。
- Web UI 需另装 `@deepseek-ai/dsh-web-app`。
- 云端服务需支持 HTTPS 与媒体 HTTP Range；部署见云端服务仓库的 `docs/operations/deployment-runbook.md`。

## 安装

```bash
npm pack                                  # 生成 dsh-plugin-trend-coach-0.1.0.tgz
npx --yes @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile <profile> add -w ./dsh-plugin-trend-coach-0.1.0.tgz
```

全新 profile 还需启用 Web UI：

```bash
npx --yes @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile <profile> add -w @deepseek-ai/dsh-web-app
npx --yes @deepseek-ai/dsh@0.2.1-rc.5 --profile <profile> --port 3080 --no-open
```

安装后重启 dsh。Host 半更新需重启，Browser 半支持热更新。

## 配置

配置项定义见 `src/host/config.ts`；在插件配置中覆盖，或用环境变量提供默认值。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `environment` | `local` | `local` / `staging` / `production`；非 local 必须 HTTPS，production 拒绝本机地址 |
| `baseUrl` | `http://127.0.0.1:3939` | 云端服务地址，不带查询串与账号密码 |
| `timeoutMs` | `10000` | 单次云端请求超时 |
| `logLevel` | `warn` | `silent` / `error` / `warn` / `info` / `debug` |
| `apiTokenRef` | `TREND_COACH_API_TOKEN` | 内部 token 回退引用；正常走设备码授权，一般无需设置 |

环境变量：`TREND_COACH_ENV`、`TREND_COACH_BASE_URL`、`TREND_COACH_LOG_LEVEL`。校验失败会阻止插件激活，避免带病请求。

模型 Key 由 dsh 管理，插件不读取、不存储、不转发任何模型凭据。

## 首次使用

1. 启动云端（本地可用插件仓库的 mock：`npm run mock`，监听 `127.0.0.1:3939`）。
2. 打开右侧栏的课程面板，按提示完成设备码授权。
3. 直接向 dsh 提问；回答中的片段可点击定位播放。

## 隐私与数据

- **本地留存**：授权 grant 存在 dsh credentials；插件不写配置文件、不落 query 原文与设备 ID 日志。
- **云端请求**：检索问题会发送到配置的云端地址；云端只返回课程片段，不提供模型推理。
- **指标事件**：默认关闭，面板内显式同意后开启，可撤回。白名单仅 `search_requested`（耗时、topK、命中数、是否空召回）、`citation_clicked`（segmentId）、`player_started`（起播耗时、自动播放是否被拒）、`feedback_submitted`（评分 up/down）。
- **不采集**：问题原文、回答内容、完整播放地址、反馈分类与备注；不接入第三方分析 SDK。
- **满意度**：转发 dsh 助手消息自带的点赞/点踩，仅评分，且只统计用过课程检索的会话。

## 安全与权限

- 不注册 shell、文件写入类工具，不另起 HTTP 端口，不提交任何密钥。
- 浏览器不持有 Bearer；播放使用云端签发的短时签名 HLS 地址。
- 云端标题与正文按不可信内容处理：固定边界包裹、剥离控制字符、转义伪造边界。
- 课程内容仅供学习，不构成投资建议。

## 开发

```bash
npm install
npm run typecheck   # tsc strict
npm run build       # Host tsc + Client esbuild → lib/
npm test            # 构建后跑 Host 边界/配置/契约/打包断言（需 ffmpeg 生成 HLS 样片）
npm run smoke       # 临时 DSH_HOME 新 profile 安装并启用插件
npm run mock        # mock 知识库 + 视频 @ 127.0.0.1:3939
```

目录与实现约束见 [CLAUDE.md](CLAUDE.md)；产品与接口见 [需求文档](docs/requirements/product-requirements.md) 与 [架构设计](docs/architecture/architecture-design.md)。

## 许可证

[Apache-2.0](LICENSE)
