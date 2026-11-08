单个通用智能体可以回答问题、编写代码、起草邮件。但现实中的工作流往往需要**多个专家智能体协同工作**：规划者、编码者、评审者、部署者。Builderforce Mesh 就是把它们连接起来的那一层。

![多智能体编排：一个编排者智能体拆解目标，并把每个子任务路由给专家——规划者、编码者、评审者、测试者、部署者——在节点之间传递结构化的 JSON 交接](/blog/multi-agent-orchestration.svg)

## Mesh 心智模型

可以把 Mesh 想象成智能体之间的消息总线。每个智能体都是一个**节点**，它会：

- 订阅自己能处理的一组**任务类型**
- 把结果发布回总线
- 可以把其他智能体作为子任务来调用

编排者（它本身也可以是一个智能体）把高层目标拆解为子任务，并把每个子任务路由给最合适的节点。

```
User prompt
    │
    ▼
Orchestrator Agent
    ├── → Planner Agent      → Plan document
    ├── → Coder Agent        → Implementation
    │       └── → Reviewer Agent → Code review
    └── → Deployer Agent     → Deployment manifest
```

## 在 Workforce 中注册智能体

在编排之前，智能体需要先**发布**到 Workforce 注册表。每个智能体需要声明：

- 对其他智能体可见的**名称**和**描述**
- 一组**技能**（结构化的能力标签）
- 一个**端点**（运行该智能体的 BuilderForce Agents 桥接）

训练完成后，在 IDE 的“发布”标签页中一键即可发布。

## 搭建 Mesh 工作流

### 1. 定义角色

确定你的工作流需要哪些专家智能体。一条软件交付流水线可能会用到：

| 角色 | 职责 |
|------|---------------|
| `planner` | 把功能需求拆分为任务 |
| `coder` | 用 TypeScript 实现每个任务 |
| `reviewer` | 评审 PR 的正确性与风格 |
| `tester` | 编写并运行单元测试 |

### 2. 分配技能

在[技能](/skills)页面，把相关技能分配给每个智能体的 AgentHost。技能会注入领域知识——例如，带有 `typescript-strict` 技能的 `coder` 智能体，会在输出中执行更严格的类型安全。

### 3. 接通编排者

编排者智能体接收最初的提示并分发子任务。在 Builderforce 项目中，你可以在聊天系统提示词里定义编排逻辑：

```
You are an orchestrator. When given a feature request:
1. Use the Planner to generate a task breakdown
2. For each task, invoke the Coder
3. Route each completed task to the Reviewer
4. Aggregate reviewed code and return the final diff
```

路由由 Mesh 负责——编排者只需按名称调用智能体技能。

## 上下文共享

智能体通过**结构化交接**共享上下文——这是携带任务状态、先前输出和元数据的 JSON 载荷。Builderforce 会自动对这些载荷进行序列化和反序列化，让每个智能体恰好获得它所需的上下文。

长期存在的上下文（对话历史、代码产物）可以固定到共享的 R2 存储桶中并按 ID 引用，从而让载荷保持精小。

## 可观测性

[可观测性](/observability)页面为你提供以下内容的实时视图：

- 智能体之间的消息流
- 每个节点的延迟
- 错误率与重试
- 整个 Mesh 的令牌用量

在调试复杂的多智能体工作流时，这非常宝贵——你能清楚地看到任务在哪里停滞，或者哪个智能体产生了意料之外的输出。

## 最佳实践

**让智能体小而专注。** 只写 Python 的编码者智能体，比那种既写代码、又评审、还负责部署的智能体更容易评估和改进。

**对每个智能体单独做 AI 评估。** 用有针对性的数据集微调，而不是一个庞大的语料库。Workforce 注册表的评估分数让比较智能体版本变得轻而易举。

**为你的智能体做版本管理。** 重新训练后发布新版本，并在开发期间把编排者固定到特定的智能体版本，以避免回归。

## 快速开始

准备好构建 Mesh 了吗？先[训练两个智能体](/dashboard)——一个规划者和一个编码者——把它们都发布出去，然后创建一个引用它们的编排者项目。在投入生产流水线之前，你可以通过 [Workforce 聊天](/workforce?tab=chats)界面交互式地测试这套编排好的工作流。
