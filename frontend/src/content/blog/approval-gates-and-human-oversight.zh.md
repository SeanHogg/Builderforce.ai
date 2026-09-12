自主智能体很强大。而这恰恰也是它们在缺乏合适护栏时变得危险的原因。一个能推送代码、修改生产配置或代表你发送消息的智能体极其有用——直到它做了你并不打算让它做的事。

Builderforce.ai 的**审批关卡**系统在基础设施层面解决了这个问题。你定义哪些操作类型需要人工签字确认；平台会阻塞执行，直到经理批准或拒绝；只有在决定被记录之后，智能体才会继续。整个闭环都有审计。

![审批关卡流程图：运行任务的智能体遇到一道关卡，通过 POST /api/approvals 阻塞执行；经理批准、拒绝或任其超时，每种结果都被记录进不可篡改的审计轨迹](/blog/approval-gates.svg)

---

## 审批关卡如何工作

这个流程有三个参与方：**智能体**（运行在 BuilderForce Agents 内部）、**Builderforce 门户**（向人展示审批的地方），以及**经理**（拥有 `MANAGER` 或更高角色的团队成员）。

```
Agent runs a task
    │
    └─► "This action requires approval"
            │
            ▼
    POST /api/approvals ──────────────────────────────────────┐
            │                                                  │
            ▼                                                  ▼
    Agent suspends execution              Portal notifies manager
    (awaiting decision)                   via dashboard + relay push
            │                                                  │
            └──────────────── Manager approves/rejects ────────┘
                                          │
                             approval.decision pushed to agentHost
                                          │
                               ┌──────────▼──────────┐
                               │ approved → continue  │
                               │ rejected → abort     │
                               └──────────────────────┘
```

关键特性在于：**执行被真正阻塞**。智能体不会继续、重试或悄悄超时。它会等待——最长到一个可配置的超时时间——等来自一个真实的人的真实决定。

---

## 审批页面

前往[团队成员审批](/workforce?tab=approvals)，查看你团队中待处理、已批准和已拒绝的关卡。

每个审批请求会显示：

| 字段 | 说明 |
|---|---|
| **操作类型** | 智能体试图做什么（`git.push`、`deploy`、`task.execution` 等） |
| **描述** | 智能体给出的通俗易懂的理由 |
| **请求方** | 哪个 BuilderForce Agents 实例提交了该请求 |
| **请求时间** | 请求的时间戳 |
| **过期时间** | 如果无人回应，请求将在何时自动超时 |
| **元数据** | 结构化上下文（任务 ID、优先级、文件列表、成本估算等） |

批准或拒绝只需点击一下。你还可以选择添加一条**评审备注**，它会与该决定一起记录，并在审计日志中可见。

---

## 什么会触发审批关卡

有两个来源：

### 1. 自动关卡（平台强制）

当一项任务被提交执行时，如果满足以下条件，Builderforce 运行时会自动评估一道关卡：

- 任务的**优先级为 `high` 或 `urgent`**

这是默认的安全网——高风险任务在智能体开始执行之前，总会经过人工审核。

### 2. 显式关卡（智能体发起）

BuilderForce Agents 的智能体可以在执行过程中的任何时刻，通过调用 `requestApproval()` 来请求审批：

```typescript
import { requestApproval } from "@builderforce/approval-gate";

const decision = await requestApproval({
  actionType: "git.push",
  description: "Push 42 changed files to the main branch",
  metadata: {
    files: changedFiles,
    branch: "main",
    estimatedRisk: "high",
  },
  timeoutMs: 10 * 60 * 1000, // 10 minute window
});

if (decision !== "approved") {
  throw new Error(`Push not approved: ${decision}`);
}

await git.push("origin", "main");
```

智能体会在 `await requestApproval(...)` 处挂起，直到：
- 经理批准 → 返回 `"approved"`
- 经理拒绝 → 返回 `"rejected"`
- 超时到期 → 返回 `"timeout"`

无需轮询，无需手动反复检查——经理一采取行动，决定就会立即推送到 agentHost。

---

## 角色要求

只有拥有 `MANAGER` 或 `OWNER` 角色的用户才能批准或拒绝关卡。查看者和开发者可以看到待处理的审批，但无法对其进行操作。

这是有意为之。审批权是一项治理控制——它应该对应到拥有部署权限的那批人，而不是整个团队。

你可以在[设置 → 成员](/settings)中管理团队角色。

---

## 通知

当审批请求到达时，经理会在三个地方看到它：

1. **门户**——侧边栏中的[团队成员审批](/workforce?tab=approvals)徽标会实时更新
2. **中继**——如果相关 agentHost 的聊天视图正在某个浏览器会话中打开，`approval.request` 事件会立即到达
3. **消息渠道**（将在第二阶段推出）——通过 Slack、Telegram、电子邮件发送审批请求通知

---

## 审计轨迹

每一个审批决定都是永久且不可篡改的。[审计日志](/admin)会记录：

- 谁发起了审批请求（agentHost ID）
- 谁做出了决定（用户 ID）
- 决定是什么，以及何时做出
- 评审备注（如有）

这就是你的合规轨迹。如果某次部署出了问题，你需要知道是谁批准的、为什么批准，就到这里来查。

---

## 超时与自动过期

审批请求有一个可选的 `expiresAt` 时间戳。当审批过期时：

- 其状态变为 `expired`
- 正在等待的智能体收到一个 `"timeout"` 决定
- 由智能体自行决定是中止还是重试

BuilderForce Agents 对交互式智能体请求的默认超时为 10 分钟。对于运行时间更长的后台工作流，你可以配置更长的时间窗口。

---

## 最佳实践

**把操作类型定义成一套分类体系。** 使用 `git.push`、`deploy.production`、`db.migrate`、`file.delete-bulk` 这类一致的字符串，而不是自由格式的描述。这样审计日志就可以筛选，你之后也能添加自动化规则。

**按风险设关卡，而不是按频率。** 并不是每个操作都需要审批——只有影响范围足够大的操作才需要。写入生产环境、破坏性的文件操作，以及会花钱或对外发送通信的外部 API 调用，都是天然的关卡点。

**让审批保持小粒度。** 一个审批请求应当只描述一个决定。“推送这 42 个文件”是可以据以行动的。“把整个部署做完”则不是——把它拆分成经理能够真正进行审核的检查点。

**设置切合实际的超时。** 对于低紧急度的工作流，一个智能体为了等一个早上 9 点才到的审批而阻塞 24 小时，完全没问题。对于面向用户的实时管道，请使用更短的超时，并配以清晰的回退行为。

---

## 后续步骤

- 打开[团队成员审批](/workforce?tab=approvals)，查看你团队的 agentHost 上是否有待处理的关卡
- 阅读[任务执行与门户](/blog/task-execution-and-observability)，了解审批如何与执行生命周期相互作用
- 查看[多智能体编排](/blog/multi-agent-orchestration)，了解将审批关卡与多步骤工作流相结合的模式
