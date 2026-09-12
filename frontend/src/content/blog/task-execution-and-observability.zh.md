当一个 AI 智能体执行任务时，会发生很多事情。它会规划、调用工具、写入文件、委派给其他智能体、汇报结果。知道发生了*什么*、*何时*发生、*由哪个智能体*完成、*是否成功*——这就是一个你信任的系统与一个你畏惧的系统之间的区别。

Builderforce 通过一套分层的体系为你提供这种可见性：**任务**、**执行**、**工作流遥测**，以及**实时门户时间线**。本文将逐层介绍。

![任务执行与可观测性：一次执行依次经历待处理、已提交、运行中，最终到达已完成或失败状态；其每个工具的 span 排布在时间线上，失败的调用被高亮显示；仪表板汇总卡片则展示总数、完成数、失败数、时长和 token](/blog/task-observability.svg)

---

## 数据模型

要理解 Builderforce 跟踪什么，就要理解四个相互关联的概念：

| 概念 | 代表什么 |
|---|---|
| **任务** | 项目中定义的一个工作单元（一个待办项、一项功能、一次缺陷修复） |
| **执行** | 在某个特定的 BuilderForce Agents 实例上运行该任务的一次具体尝试 |
| **工作流** | BuilderForce Agents 智能体为完成任务而执行的结构化多步骤编排 |
| **工作流任务** | 工作流中的单个步骤（例如“编码者”步骤或“评审者”步骤） |

一个**任务**随着时间推移可以有多次**执行**（重试、重新运行）。当 BuilderForce Agents 编排器运行一个 DAG 来完成任务时，每次执行都恰好对应一个**工作流**。

---

## 任务生命周期

任务会按照既定的状态顺序推进：

```
backlog → todo → ready → in_progress → in_review → done
                                   └─► blocked
```

你可以在[任务](/tasks)页面管理任务。每个任务会记录：

- **优先级**（`low`、`medium`、`high`、`urgent`）——决定是否自动触发审批关卡
- **分配的智能体主机**——应由哪个 BuilderForce Agents 实例来执行
- **角色设定**——应由哪个智能体角色主导执行
- **GitHub PR URL**——一旦智能体主机创建了拉取请求，便会自动关联

---

## 执行生命周期

当一个任务被提交执行时（通过 `POST /api/runtime/executions` 或门户调度），系统会创建一条**执行记录**，并通过中继向智能体主机分派一个 `task.assign` 事件。

执行遵循以下状态机：

```
pending → submitted → running → completed
                    └─► failed
                    └─► cancelled
```

智能体主机会自动把每一次状态转换回报给 Builderforce：

- **running**——智能体收到任务并开始处理的那一刻即回报
- **completed**——智能体的聊天会话产生最终回复时回报
- **failed**——会话以错误结束时回报

你可以在[时间线](/timeline)页面实时查看这些转换——执行卡片会随着智能体主机回报的状态实时更新。

---

## 工作流遥测

当 BuilderForce Agents 运行一个编排好的工作流来完成任务时，它会发出**结构化遥测 span**——每个工作流一个，每个任务步骤一个。这些 span 会出现在两个地方：

### 1. 本地 JSONL（在智能体主机上）

```bash
# Every span is written locally on the agentHost
cat .builderforce/telemetry/2026-03-11.jsonl | jq .

# Find slow tasks
cat .builderforce/telemetry/2026-03-11.jsonl | \
  jq 'select(.kind == "task.complete") | {role: .agentRole, ms: .durationMs}' | \
  sort -t: -k2 -n
```

### 2. Builderforce 门户（实时）

同样的 span 在发出的同时会被转发到门户：

- `workflow.start` → 在[工作流](/workflows)页面创建一条工作流记录
- `task.start` → 新增一个 `status: running` 的任务步骤
- `task.complete` / `task.fail` → 用最终状态和时长更新该步骤
- `workflow.complete` / `workflow.fail` → 关闭该工作流记录

这意味着，工作流页面就是一个**实时视图**，展示每个已连接的智能体主机此刻正在做什么。无需手动查询。

---

## 工作流页面

前往 [/workflows](/workflows)，查看整个集群中的所有工作流。

你可以按以下条件筛选：

- **状态**——运行中、已完成、失败、待处理
- **工作流类型**——功能、缺陷修复、重构、规划、对抗、自定义
- **智能体主机**——筛选到某台特定的机器

每条工作流记录都可以展开，显示其任务 DAG——各个步骤的智能体角色、描述、时长和状态。失败的步骤会直接内联显示错误信息。

---

## 执行仪表板

[/observability](/observability)（或任意项目页面上的仪表板链接）会显示汇总统计：

| 指标 | 衡量什么 |
|---|---|
| 执行总数 | 所选时间窗口内的全部运行 |
| 已完成 | 成功结束的运行 |
| 失败 | 以错误结束的运行 |
| 运行中 | 当前活跃的运行 |
| 平均时长 | 平均执行时间（仅统计已完成的运行） |
| token 用量 | 所有执行消耗的 token 总量 |

仪表板可按项目、智能体主机和智能体角色细分，让你看清系统中哪些部分消耗资源最多、失败最频繁。

---

## 工具审计事件

智能体发起的每一次工具调用都会记录在**工具审计日志**中——可在[日志](/logs)中搜索：

```
timestamp   | agentHost     | tool         | duration | status
2026-03-11T | agentHost-7   | read_file    | 42ms     | success
2026-03-11T | agentHost-7   | bash         | 1.2s     | success
2026-03-11T | agentHost-7   | write_file   | 38ms     | success
2026-03-11T | agentHost-7   | bash         | 3.4s     | error
```

每个事件都包含完整的输入参数和结果，因此你可以精确追溯智能体在每一步做了什么。这是最深的一层调试手段——当一次执行失败时，工具审计日志会告诉你究竟是哪一次工具调用导致的。

---

## 实时执行流

对于此刻至关重要的执行，你可以通过 `GET /api/runtime/executions/:id/stream` 这个 WebSocket 流订阅实时更新。门户的实时执行卡片在底层用的就是它——每一次状态转换和遥测事件，都会在从智能体主机到达的那一刻被推送出来。

该流会推送：

- 执行在各状态间转换时的 `status_change` 事件
- 执行完成或失败时的 `done` 事件
- 来自运行中会话的 token 用量快照

---

## 规格说明：执行的起点

Builderforce 上最高层级的规划原语是**规格说明**——一份结构化的规划文档，位于 [/tasks](/tasks) 的规划面板中。

一份规格说明会依次经历：

```
draft → reviewed → approved → in_progress → done
```

每份规格说明包含：

- **目标**——用平实语言表述的目标
- **PRD**——产品需求文档（借助[头脑风暴](/brainstorm)中的 AI 辅助撰写）
- **架构规格**——技术设计，可生成也可编辑
- **任务列表**——从规格说明中派生出的 JSON 任务数组，可直接在任务看板中创建

当规格说明进入 `approved` 状态时，任务列表就会变成一组可执行的任务。从那里开始，上文所述的执行生命周期便接手了。

---

## 最佳实践

**当你拥有一个集群时，请显式地为任务分配智能体主机。** 未分配的任务会广播给所有已连接的智能体主机——探索阶段没问题，但在生产环境中会很嘈杂。把任务固定到拥有合适工作区和模型的智能体主机上。

**有意识地选择工作流类型。** `bugfix` 工作流的路径是 bug-analyzer → coder → test-generator。`feature` 工作流的路径是 planner → architect → coder → reviewer → tester。选对类型，就意味着正确的智能体角色会以正确的顺序被调用，无需自定义编排。

**调试时先查审计日志。** 在重新运行一次失败的执行之前，先看看该执行的工具审计事件。失败通常只源于一次工具调用——一条返回非零退出码的 bash 命令，或一次遇到权限错误的文件写入。

---

## 后续步骤

- 在[时间线](/timeline)上查看你当前的执行
- 在 [Workforce 审批](/workforce?tab=approvals)中审阅高优先级任务的待处理审批
- 探索[工作流](/workflows)页面，看看你的智能体主机此刻正在编排什么
- 阅读[审批关卡与人工监督](/blog/approval-gates-and-human-oversight)，了解如何为高风险的执行步骤设置关卡
