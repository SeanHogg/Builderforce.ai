空白画布带来一次解放。而可重复的团队流程，需要可以复用、又不会把每个项目冻结成同一份文档的结构。

Creation Canvas 区分了四种复用：起步套件、可复用 frame、具名检查点和分支。

![Canvas 模板菜单的产品视图，包含六个内置套件、一个带 frame 的工作区、具名检查点历史、分支标识，以及逐对象的合并审阅控件](/blog/canvas-reuse-versioning-workspace.svg)

## 套件创建可运转的对象系统

Builderforce 通过 Canvas 模板目录提供六个起步套件：

- **Campaign studio**——Workflow、Website、Dashboard 和营销活动 Agent。
- **Product discovery**——Dataset、Feature Summary、Mockup Set 和 Evaluation。
- **Data story**——Dataset、Chart、Dashboard 和 Slides。
- **Impromptu stand-up**——Stand-up、Staff Member、Agent 和后续 Task。
- **Evermind model lab**——Dataset、Evermind、Evaluation 和已发布模型的 Agent。
- **Executive review**——Project、Dashboard、Roadmap 和 Slides。

套件放置的是真实注册的对象类型和起步关系。此后接入的每一项实时资源，仍由租户策略管辖；安装一个套件并不会授予对 Project、模型、Agent 或集成的访问权限。

## Frame 保存有用的布局

Frame 是一等的协作对象，带有用途、颜色和边框。团队可以用它把评审区域、工作坊、模型流水线或演示序列归为一组，而不意味着附近的每个对象都会一起执行。

自定义 frame 预设可以私密地保存在设备上，并从模板菜单中再次插入。这对不值得做成完整工作区模板的周期性仪式和布局惯例很有用。

![起步套件放置已注册的对象和带类型的边；可复用的 Frame 保存本地的布局；具名检查点保存有意义的服务器状态；分支支持独立的实验；合并审阅为每个匹配的对象选择分支版本或父级版本](/blog/canvas-reuse-layers.svg)

## 检查点为有意义的状态命名

自动历史回答的是“改了什么？”。具名检查点回答的是“团队认定重要的是哪个状态？”。在有服务器支持的 Session 中，编辑者可以在高管评审、实验、交付决策或模型训练变更之前，为检查点命名。

检查点会与修订快照一起出现在会话历史中。它们不能替代分支实验；它们是当前工作线上的一个持久地标。

## 分支隔离实验

分支会创建一个派生自父级的独立 Session。把它用于不同的信息架构、营销活动方向、模型方案或优先级视角。协作者可以在不让父画布经历每一个中间状态的情况下工作。

当分支回归时，Builderforce 会准备一份明确的合并审阅。对于两个版本中都存在的每个对象，审阅者选择分支版本或保留父级版本。新对象可以被接受，而不会替换无关的父级工作。

这种逐对象的模型，比“替换整块看板”更贴合创作的实际单位。

## 导出让会话可移植

Canvas 导出提供了另一条恢复和可移植的路径。这些层次合在一起，构成一个实用的递进：

**用套件获得起步系统 → 用 frame 获得可复用的布局 → 用检查点获得商定的状态 → 用分支进行实验 → 用合并做出明确的决定 → 用导出实现可移植**

复用因此变得更精确，因为每种机制回答的是不同的问题。

[从 Creation Canvas 套件开始 →](/create/new)
