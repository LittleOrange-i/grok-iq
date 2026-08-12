# Grok Account Monitor

> 面向账号质量巡检的可视化工作台：批量发起探针、追踪任务与样本证据、识别异常表现，并支持后续处置与复测。

![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

## 一眼了解

Grok Account Monitor 将日常账号巡检集中到一个界面中：从账号筛选、批量建测、排队执行，到样本详情、风险趋势和复测，所有操作都有清晰的进度与可回看记录。

- **账号探针**：按状态、判定等条件筛选账号，批量创建测试、启用或停用。
- **任务中心**：查看队列和执行进度，支持停止、删除、重测与批量操作。
- **风险判断**：结合响应表现、连续异常和多出口结果，呈现可追溯的风险结论。
- **微信提醒**：异常账号进入风险状态时，可通过微信测试公众号模板消息提醒。
- **计划任务**：用 Cron 定期巡检，避免重复堆积任务。
- **Worker 可观测性**：查看并发执行状态、阻塞原因和近期日志。
- **聊天广场**：用于流式对话验证，支持多套模型配置、本地会话历史和 Markdown / HTML 预览。

## 界面预览

> 所有截图均为脱敏的示例数据：邮箱使用 `example.com`，IP 使用 RFC 示例地址段，不包含真实账号、密钥、代理或数据库内容。点击图片可查看原图。

<p align="center">
  <a href="docs/screenshots/monitoring-overview.png">
    <img src="docs/screenshots/monitoring-overview.png" alt="监控概览" width="100%" />
  </a>
  <br />
  <sub>监控概览：账号规模、风险数量、样本趋势、队列与风险排行</sub>
</p>

### 巡检与调度

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/account-probes.png"><img src="docs/screenshots/account-probes.png" alt="账号探针" /></a><br />
      <sub><b>账号探针</b> · 筛选账号、查看当前表现，以及批量操作</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/task-center.png"><img src="docs/screenshots/task-center.png" alt="任务中心" /></a><br />
      <sub><b>任务中心</b> · 任务队列、执行进度、重测、停止与删除</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/cron-schedules.png"><img src="docs/screenshots/cron-schedules.png" alt="定时计划" /></a><br />
      <sub><b>定时计划</b> · Cron 表达式、时区、重叠策略与调用记录</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/worker-runtime.png"><img src="docs/screenshots/worker-runtime.png" alt="Worker 运行状态" /></a><br />
      <sub><b>Worker 运行状态</b> · 并发实例、当前任务和队列阻塞情况</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/worker-logs.png"><img src="docs/screenshots/worker-logs.png" alt="Worker 日志" /></a><br />
      <sub><b>Worker 日志</b> · 最近执行记录，便于定位异常任务</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/probe-profiles.png"><img src="docs/screenshots/probe-profiles.png" alt="探针方案" /></a><br />
      <sub><b>探针方案</b> · 管理内置与自定义的测试内容和判定标记</sub>
    </td>
  </tr>
</table>

### 任务与样本证据

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/account-detail.png"><img src="docs/screenshots/account-detail.png" alt="账号详情" /></a><br />
      <sub><b>账号详情</b> · 风险原因、出口对比、最近任务和样本</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/run-detail.png"><img src="docs/screenshots/run-detail.png" alt="任务详情" /></a><br />
      <sub><b>任务详情</b> · 逐轮指标、样本分类与响应内容</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/decision-guide.png"><img src="docs/screenshots/decision-guide.png" alt="判定说明" /></a><br />
      <sub><b>判定说明</b> · 样本分类、风险累计、任务与恢复状态说明</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/expected-output-editor.png"><img src="docs/screenshots/expected-output-editor.png" alt="预期结果编辑器" /></a><br />
      <sub><b>预期结果编辑器</b> · 编辑参考输出，并预览 Markdown、HTML 或 SVG</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/profile-editor.png"><img src="docs/screenshots/profile-editor.png" alt="探针方案编辑" /></a><br />
      <sub><b>方案编辑</b> · 配置提示词、模型、校验标记和输出参考</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/cron-plan-editor.png"><img src="docs/screenshots/cron-plan-editor.png" alt="定时计划编辑" /></a><br />
      <sub><b>计划编辑</b> · 搜索、多选账号、选择方案、轮次与出口</sub>
    </td>
  </tr>
</table>

### 聊天与系统设置

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/chat-playground.png"><img src="docs/screenshots/chat-playground.png" alt="聊天广场" /></a><br />
      <sub><b>聊天广场</b> · 流式输出、思考内容、本地历史与多回复版本</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/html-preview.png"><img src="docs/screenshots/html-preview.png" alt="HTML 预览" /></a><br />
      <sub><b>HTML 预览</b> · 预览与源码切换，方便核对生成结果</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/playground-provider-settings.png"><img src="docs/screenshots/playground-provider-settings.png" alt="聊天提供商设置" /></a><br />
      <sub><b>聊天提供商</b> · 维护多套地址、密钥和模型列表</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/settings-connection.png"><img src="docs/screenshots/settings-connection.png" alt="连接设置" /></a><br />
      <sub><b>连接设置</b> · 在控制台完成服务连接与凭据配置</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/settings-queue.png"><img src="docs/screenshots/settings-queue.png" alt="任务队列设置" /></a><br />
      <sub><b>任务队列设置</b> · 并发、容量、重试与诊断参数</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/settings-risk.png"><img src="docs/screenshots/settings-risk.png" alt="风险设置" /></a><br />
      <sub><b>风险设置</b> · 异常信号区间、连续次数与自动处置</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/integration-settings.png"><img src="docs/screenshots/integration-settings.png" alt="联动设置" /></a><br />
      <sub><b>联动设置</b> · 配置导入后的自动巡检策略</sub>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/first-time-setup.png"><img src="docs/screenshots/first-time-setup.png" alt="首次使用" /></a><br />
      <sub><b>首次使用</b> · 创建管理员后即可进入控制台</sub>
    </td>
  </tr>
</table>

## 能做什么

- **批量跑探针**：筛选、多选或全选账号后直接入队。不同账号并行，同一账号串行。
- **正常定检与异常诊断**：正常定检保持账号当前固定出口不变；只有人工诊断才临时切换出口。
- **两种执行模式**：完整对话用于看实际回复和指标；快速质量测试仅用于诊断出口质量。
- **定时执行**：每个计划单独配置 Cron、时区、账号、方案、轮次和出口。
- **保存完整结果**：记录首 Token、生成耗时、输出 Token、TPS、分类、错误和响应正文。
- **风险标记**：按连续异常、跨出口结果和预期内容匹配情况计算账号状态。
- **任务控制**：查看队列和 Worker，支持停止、重试、删除以及批量操作。
- **结果回看**：从账号、任务或样本详情里直接看指标和原始输出，长内容按需展开。
- **注册联动**：接收 [grok-register](https://github.com/kaibush/grok-register) 的 Webhook，账号导入后可自动创建探针任务。

## 微信测试公众号提醒

在“系统设置 → 通知推送”打开开关，填下面 4 项即可：

先在微信测试公众号后台把运行监控后端的出口 IP 加到接口白名单，再填写下面的值。

| 设置 | 从哪里拿 |
| --- | --- |
| `AppID` | 微信测试公众号的 appID |
| `AppSecret` | 微信测试公众号的 appsecret |
| `OpenID` | 测试公众号用户列表里的 OpenID |
| `模板 ID` | 测试公众号里新建模板后得到的 ID |

模板内容可以直接按下面的字段建，保存后点“保存并发送测试消息”确认联通：

```text
{{first.DATA}}
账号：{{account.DATA}}
状态：{{status.DATA}}
风险分：{{score.DATA}}
TPS：{{tps.DATA}}
原因：{{reason.DATA}}
时间：{{time.DATA}}
{{remark.DATA}}
```

系统只在账号首次进入 `watch`、`suspect`、`high_risk` 或 `quarantined`，以及风险升级时推送；开关关闭时自动推送和测试消息都不发送。

## 和 grok-register 联动

配套注册项目：[kaibush/grok-register](https://github.com/kaibush/grok-register)

```text
grok-register 注册完成
  -> grok_build 导入 Grok2API 成功
  -> Webhook 通知本项目
  -> 匹配 Grok2API 账号
  -> 记录注册风险 / 可选自动创建探针
```

只有 `grok_build` 已被 Grok2API 接收后才会发送事件。注册成功但导入失败时不会提前触发监控。

### 怎么接

1. 在本项目打开“系统设置 → 联动与启动项”。
2. 设置 `grok-register` 联动令牌，复制页面生成的完整 Webhook 地址。
3. 按需开启“注册后自动探针”，并选择方案、执行模式、轮次和出口。
4. 在 `grok-register` 打开“系统设置 → Grok2API”，开启账号监控联动。
5. 粘贴 Webhook 地址和同一个 Token，保存即可。

独立部署时，Webhook 地址必须能从 `grok-register` 进程或容器访问。统一 Compose 中使用内部地址：

```text
http://monitor-backend:8090/api/integrations/grok-register/account-imported
```

请求使用 `x-monitor-token`，两边填写的 Token 必须一致。

最小请求体只需要邮箱，监控端会从 Grok2API 按邮箱精确匹配账号：

```json
{
  "email": "user@example.com"
}
```

调用方存在自动重试时，推荐提供稳定的 `event_id`；同一次事件的每次重试必须使用相同值：

```json
{
  "event_id": "registration:123:grok2api-imported",
  "email": "user@example.com"
}
```

完整请求体还支持以下可选字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event_id` | string | 幂等事件 ID；省略时按邮箱生成 |
| `event_type` | string | 事件类型，默认 `grok2api.account_imported` |
| `registration_id` | string | 调用方自己的注册记录 ID |
| `grok2api_account_id` | integer | 已知时可传；未知时按邮箱匹配 |
| `bot_risk` | boolean | 注册阶段是否发现风控，默认 `false` |
| `bfs` | string / integer | 注册阶段的 bfs 风控值 |
| `occurred_at` | string | 事件发生时间，建议使用 ISO 8601 |

接口返回 HTTP `202` 表示事件已经持久接收，账号匹配、失败重试和探针执行由后台继续完成。探针方案、模式、轮次和出口均使用监控端“默认策略”，调用方不需要传入。

### 投递行为

- `grok-register` 先把事件写入本地 Outbox，再由后台线程投递；网络错误或非 `2xx` 会自动退避重试。
- 每个注册结果使用稳定的 `event_id`。本项目按事件 ID 去重，重复投递不会重复创建探针。
- Webhook 返回 `2xx` 只表示本项目已接收。后续账号匹配、排队和探针执行由本项目继续处理。
- 如果账号暂时还没出现在 Grok2API，本项目会继续重试匹配；关闭自动探针时仍会保留导入事件。
- `grok-register` 的账号详情会显示投递状态、尝试次数、接收时间和最近错误，方便查联动问题。

### 三个服务一起跑

`grok-register` 仓库已经提供 `compose.monitor.yaml`，可以一起启动注册机、监控后端和监控前端：

```bash
git clone https://github.com/kaibush/grok-register.git
cd grok-register
cp .env.example .env

# 编辑 .env，至少设置：
# MONITOR_GROK2API_BASE_URL
# MONITOR_GROK2API_ADMIN_USERNAME
# MONITOR_GROK2API_ADMIN_PASSWORD
# MONITOR_WEBHOOK_TOKEN

docker compose -f compose.yaml -f compose.monitor.yaml pull
docker compose -f compose.yaml -f compose.monitor.yaml up -d
```

默认端口：`grok-register` 使用 `8787`，本项目 Web 页面使用 `8091`。探针配置只在本项目维护，注册机只负责在导入成功后发送事件。

## grok2api 运行依赖

本项目需要连接到具备管理员权限的 grok2api 实例。无需在本项目中复制账号或出口数据，但目标实例应提供以下能力：

| 能力 | 用途 |
| --- | --- |
| 管理员鉴权 | 连接检查、读取运行状态，以及执行受控的管理操作。 |
| 账号查询与分页搜索 | 在账号探针、计划任务和批量操作中实时加载账号。 |
| 出口节点查询 | 选择测试出口，并记录测试实际使用的出口。 |
| 账号状态与路由设置 | 批量启停账号；测试期间临时调整账号的出口、优先级或并发设置，并在完成后恢复。 |
| 临时模型路由与 Client Key | 将一次完整对话测试限定到指定账号，任务结束后自动清理。 |
| 对话补全与流式响应 | 执行完整对话测试，采集首 Token、生成时长、输出 Token 和响应正文。 |
| 快速出口质量测试 | 对已启用、配置代理的出口进行快速筛查。 |
| 请求审计查询 | 依据请求标识核验实际命中的账号和出口，为样本保留审计依据。 |

首次启动后，可在“系统设置 → 连接与凭据”中填写服务地址和管理员凭据并测试连接。若缺少某项能力，对应页面会提示连接或执行失败；建议使用支持以上能力的 grok2api 版本。

## 快速开始

### Docker Compose 部署

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

默认访问地址为 `http://127.0.0.1:8091`。

首次进入时创建管理员账号；随后前往“系统设置”完成连接与运行参数配置，即可开始创建探针任务。

如需从当前源码构建镜像：

```bash
docker compose up -d --build
```

### 本地开发

后端：

```bash
python3 -m venv .venv
.venv/bin/pip install -e 'backend[dev]'
cd backend
../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8090 --reload
```

前端：

```bash
cd frontend
npm ci
npm run dev
```

## 日常使用流程

1. 在“系统设置”完成连接、队列和风险规则配置。
2. 打开“账号探针”，筛选并选择需要关注的账号。
3. 选择测试方案、轮次和目标后创建任务。
4. 在“任务中心”跟踪进度；必要时停止、删除或重测。
5. 在账号或任务详情中查看样本证据和风险原因，再决定后续操作。
6. 对稳定重复的巡检需求，使用“定时计划”自动执行。

## 数据保存与备份

Docker Compose 默认使用命名卷 `monitor-data` 保存运行数据，包括任务、样本、设置、自动生成的密钥和轮转日志。迁移或备份时，请将该数据卷作为一个整体处理。

## 许可

本项目采用 [MIT License](LICENSE)。
