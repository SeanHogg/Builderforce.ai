开发者笔记本电脑上的单个 BuilderForce Agents 实例已经足够强大。而一支由十个实例组成的机群——每个实例专精一类工作，分布在多台机器上，把任务路由给最合适的那个实例——则完全是另一个量级。

Builderforce.ai 就是这支机群的控制平面。本文将介绍如何在门户中注册实例、声明能力、智能路由任务，以及监控你的网格。

![机群路由：一个声明了所需能力的传入任务，由机群路由器对在线的 AgentHost 逐一评分，派发给最匹配的主机，离线主机被跳过，部分匹配的主机则作为备选](/blog/fleet-routing.svg)

---

## 什么是 AgentHost 机群？

**AgentHost 机群**是注册到你租户下的所有 BuilderForce Agents 实例。每个实例都是一台运行 BuilderForce Agents 网关的机器——可能是开发者的笔记本电脑、专用服务器、CI 工作节点，也可能是云端虚拟机。

在 Builderforce 门户中，你可以在 [仪表板](/dashboard) 和 AgentHost 详情面板中查看你的机群。每个 AgentHost 会显示：

- **状态**——在线/离线（根据最近一次心跳判断）
- **机器档案**——主机名、IP、工作区路径、隧道 URL
- **最后在线**——该 AgentHost 最后一次发送心跳的时间
- **能力**——该 AgentHost 声明自己能做什么
- **已分配项目**——与它关联的项目
- **用量统计**——近期的 token 消耗和执行次数

---

## 注册新的 AgentHost

要把一个 AgentHost 加入你的机群：

1. 前往 [仪表板](/dashboard) → **Add AgentHost**
2. 为它设置名称和 slug（例如 `backend-server-1`）
3. 复制生成的 API 密钥——它**只显示一次**，之后无法再次获取
4. 在目标机器上设置：

```bash
export BUILDERFORCE_AGENTS_LINK_API_KEY=<your-api-key>
export BUILDERFORCE_AGENTS_LINK_URL=https://api.builderforce.ai
builderforce start
```

AgentHost 会在第一次心跳时自动完成注册。它的机器档案、工作区路径和网络元数据都会根据第一次心跳的载荷自动填充。

---

## 心跳与在线状态

已连接的 AgentHost 每 5 分钟通过 `PATCH /api/agent-hosts/:id/heartbeat` 发送一次**心跳**。心跳会更新：

- `lastSeenAt`——用于判断在线/离线状态
- `connectedAt`——在第一次心跳时设置
- `capabilities`——声明的能力集（见下文）
- `machineProfile`——主机名、IP、端口、隧道 URL

如果一个 AgentHost 的 `lastSeenAt` 在最近 10 分钟以内，它就被视为**在线**。如果 AgentHost 离线，分配给它的任务会继续排队——除非你配置了备选方案，否则它们不会被自动重新路由。

---

## 能力声明

能力是网格的路由词汇。AgentHost 声明自己能做什么；门户则依据这些声明，把任务路由给最匹配的对象。

每个 AgentHost 都在心跳载荷中声明自己的能力：

```json
{
  "capabilities": ["chat", "tasks", "relay", "remote-dispatch"],
  "declaredCapabilities": ["typescript", "react", "testing", "refactor"]
}
```

第一组（`capabilities`）是 BuilderForce Agents 的协议接口。第二组（`declaredCapabilities`）是你的自定义词汇——任何你用来给工作分类的标签都可以。

### 按能力查询

在任意 AgentHost 上（或通过门户），你都可以提问：*“机群中哪个 AgentHost 最适合做这项工作？”*

```
GET /api/agent-hosts/fleet/route?requires=typescript,testing
```

它会针对给定的能力集返回最匹配的在线 AgentHost，并优先选择声明了全部所需能力的 AgentHost。

---

## 用 `remote:auto` 智能路由

能力声明真正的威力，在于 BuilderForce Agents 工作流中的**自动路由**。

当你在工作流中把智能体角色指定为 `remote:auto[caps]` 时，负责派发的 AgentHost 会查询机群、找到最佳匹配，并把任务转发过去：

```yaml
# .builderforce/workflows/feature-build.yaml
steps:
  - role: planner
    description: "Break down the feature into tasks"

  - role: remote:auto[typescript,react]
    description: "Implement the UI components"

  - role: remote:auto[testing]
    description: "Write unit tests for the implementation"

  - role: reviewer
    description: "Review the complete implementation"
```

`remote:auto[typescript,react]` 这一步会派发给机群中与这两项能力最匹配的在线 AgentHost。如果该 AgentHost 正忙，就选择次优的匹配。

---

## 用 `remote:<id>` 手动路由

如果你需要确定性的路由——比如前端任务始终在某台特定工作站上运行——可以直接使用 AgentHost 的 slug 或数字 ID：

```
remote:frontend-workstation
remote:42
```

这会跳过能力评分，直接派发给该 AgentHost。如果该 AgentHost 离线，任务会立即失败，而不会回退到其他主机。

---

## AgentHost 详情面板

在 [仪表板](/dashboard) 中点击任意 AgentHost，即可打开它的详情面板。面板包含以下几个标签页：

### 聊天
一个连到该 AgentHost 当前聊天会话的实时终端——你可以发送任务、查看流式响应，并实时观看智能体工作。

### 会话
在该 AgentHost 上运行过的所有会话记录，包括开始时间、持续时长和 token 用量。点击任意会话即可查看完整记录。

### 项目
该 AgentHost 被分配到的项目。你可以在这个标签页中分配或取消分配项目。

### 技能
该 AgentHost 当前加载的技能——包括租户级分配和针对该 AgentHost 的覆盖设置。这里的更改会在 AgentHost 下次重启时生效（技能在启动时获取）。

### 工作区
该 AgentHost 同步到 Builderforce 的目录——文件清单、同步状态以及最近一次同步的时间戳。

### 用量
每个会话的 token 消耗、上下文窗口利用率以及压缩事件。用来在上下文爆满酿成问题之前及早发现它。

### 调试
原始机器档案、网络元数据、中继连接状态，以及最近 20 次心跳的载荷。当某个 AgentHost 意外离线时，这是你首先应该查看的地方。

---

## 项目分配

没有分配项目的 AgentHost 没有任何上下文——它不知道该加载哪个代码库、哪些规则或哪些记忆。请为每个 AgentHost 至少分配一个项目：

1. 打开 AgentHost 详情面板 → **Projects** 标签页
2. 点击 **Assign Project** 并选择项目
3. AgentHost 会在下一次心跳时获取更新后的分配上下文

一个 AgentHost 可以分配到多个项目。当前激活的项目由正在执行的任务决定——AgentHost 会自动加载相应的项目上下文。

---

## AgentHost 间派发

同一机群中的 AgentHost 可以直接相互委派任务，无需经过门户中转。这就是 **AgentHost 间网格**。

所有 AgentHost 之间的派发都是：

- **HMAC 签名的**——每个载荷都带有 `X-AgentHost-Signature: sha256=<hex>` 请求头；接收方 AgentHost 在执行前会先验证签名
- **Bearer 认证的**——每个请求都带有 `Authorization: Bearer <apiKey>`
- **中继辅助的**——位于 NAT 或防火墙之后的 AgentHost，通过 Builderforce 上的 `AgentHostRelayDO` Durable Object 相互连通；无需直接的网络路径

中继拓扑如下：

```
AgentHost A (laptop) ──────────────────────────────► Builderforce relay
                                                      │
                                         dispatches to AgentHost B via relay
                                                      │
                                              AgentHost B (server) ◄───────
```

两个 AgentHost 都不需要能从对方的网络直接访问。路由由 Builderforce 负责。

---

## 大规模下的机群可见性

对于运行大量 AgentHost 的团队，[仪表板](/dashboard) 的机群视图会在一张表中显示所有实例。你可以按以下条件筛选：

- **状态**——仅显示在线
- **项目**——分配到某个特定项目的 AgentHost
- **能力**——声明了某个能力标签的 AgentHost

机群视图就是你的网格的指挥控制台。需要暂停某个 AgentHost 上的工作？把它的状态改为 `inactive`。怀疑某个 AgentHost 行为异常？查看它的工具审计日志。需要把新的技能分配推送给所有 AgentHost？在租户级别更新，每个 AgentHost 会在下次启动时自动获取。

---

## 最佳实践

**给 AgentHost 起有意义的名字。**`agentHost-1`、`agentHost-2` 很快就会变得难以管理。`backend-sean-mbp`、`frontend-ci-worker`、`refactor-server` 能让机群视图一目了然。

**精确地声明能力。**避免使用 `general` 或 `everything` 这类大而全的声明。你的能力词汇越精细，自动路由的决策就越准确。如果一个 AgentHost 擅长 Python、不擅长 TypeScript，就声明 `python`，而不要声明 `typescript`。

**尽量让每个 AgentHost 只有一个主项目。**分配了很多项目的 AgentHost 在启动时会加载更多上下文，还可能把工作路由到错误的项目上下文。一个 AgentHost 对应一个代码库，是最清晰的思维模型。

**在生产环境中监控 `lastSeenAt`。**设置一个 Grafana 告警（或者在门户的通知钩子上线后使用它），当某个 AgentHost 在工作时间离线超过 15 分钟时发出提醒——这通常意味着进程崩溃或网络发生了变化。

---

## 后续步骤

- 在 [仪表板](/dashboard) → Add AgentHost 中注册一个新的 AgentHost
- 阅读 [多智能体编排](/blog/multi-agent-orchestration)，了解 `remote:auto` 如何融入一个完整的工作流
- 阅读 [技能分配](/blog/skills-assignment-and-the-marketplace)，了解如何为机群中的 AgentHost 配备由门户管理的能力
