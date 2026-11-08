当每张卡片都是定制组件、每个集成都发明一种新行为时，可视化工作区就会变得脆弱。Creation Canvas 转而采用注册表驱动的契约：**48 种对象类型**，每一种都有确定的分组、渲染器、检查器、操作、可变字段、连接、安全的 Brain 上下文和预览适配器。

![Creation Object 调色板的产品视图，展示十个分组、画布上具有代表性的实时对象卡片、能力徽章，以及六种语义连接类型](/blog/creation-object-registry-workspace.svg)

## 十个分组覆盖全部工作，而不将其压平

调色板把对象组织为 Build、Data、Knowledge、Insights、Work、People、Agents、Models、Collaborate 和 Integrations 十个分组。

Build 包括 Workflow、Website、Chat、Dataset、WYSIWYG Prototype、Code、Browser preview、仓库与编辑器工件、本地服务以及 Video。Data 包括 Table、Spreadsheet、Chart 和 KPI。Knowledge 包括 Documents、Slides、文件、URL 和知识条目。Insights 包括 Dashboards、Reports、Evaluations、对比、Roadmaps 和 Notes。

Work、People、Agents、Models 和 Collaborate 承载围绕交付的规划、劳动力、模型和多人协作工件。Integrations 目前把 MCP 工具作为原生对象开放，而不是隐形的聊天配置。

## 每个对象都声明 Brain 可以做什么

注册表提供默认数据、原生操作以及可变字段的白名单。Website 可以编辑、预览和发布。Dataset 可以导入、剖析和可视化。Project 可以展开和比较。Agent 可以检查、配置和分派。Evermind 可以教学、训练、评估和发布。MCP 对象可以认证和执行。

Brain 读取的，正是驱动检查器的那同一份声明。它无法凭空捏造一个不受支持的字段或操作，并让画布默默接受。

![48 种对象类型中的每一种都要通过同一份注册表契约，涵盖默认数据、渲染、检查、原生操作、可变字段、安全的 AI 上下文、预览、能力策略，以及六种允许的语义关系：data、control、reference、presentation、delivery 和 membership](/blog/creation-object-registry-contract.svg)

## 六种边把布局变成图

Creation Canvas 定义了六种语义连接类型：

- **data**——一个对象向另一个对象提供数值；
- **control**——一个对象驱动或配置另一个对象；
- **reference**——一个工件引用或依赖另一个工件；
- **presentation**——一个工件呈现另一个工件；
- **delivery**——一个获批的工件走向执行；
- **membership**——一个人、智能体或条目属于某个群组或仪式。

空间上的邻近仅仅是视觉上的。含义存在于显式的边之中。

## 能力门控保护租户策略

有些类型——Evermind、MCP、Agent、LLM、Voice 和 Video——会声明平台能力。调色板会依据可用的能力集对它们进行过滤。模板只能引用已注册的类型，但安装模板绝不会绕过租户的访问控制或认证。

## 一份与传输方式无关的契约贯穿各个界面

对象类型、连接类型以及带修订号的命令类型，都位于一份共享契约中，供 Web 画布和 VS Code 界面共同使用。因此二者可以谈论同一个对象身份和图操作，而无需把一个 UI 序列化到另一个 UI 里。

命令词汇涵盖整图替换；对象的添加、更新、移动和删除；连接的添加和删除；以及视口变更。服务端的修订号为这些命令提供了排序与冲突的边界。

## 可扩展性依然可检查

注册表不只是一份调色板列表。它是对象声明自己被允许暴露、接受、预览和执行什么的地方。这让新的对象类型从一开始就能与 Brain、协作、模板以及两个客户端界面自由组合。

画布可以不断生长，而不会变成一堆无类型的卡片。

[探索 Creation Object 调色板 →](/create/new)
