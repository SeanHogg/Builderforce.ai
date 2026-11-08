分析往往恰恰在它变得有用的那一刻发生割裂。数据在电子表格里，图表在笔记本里，决策在文档里，面向高管的版本在幻灯片里。每多一份副本，就削弱一分与证据之间的联系。

Creation Canvas 把完整的数据故事视为一组相互连接的实时对象。

![一块实时 Data Story 画布的产品视图：一个源 Dataset 表格连接到 Chart 和 KPI，汇总成 Dashboard 和 Report，并通过 Slides 呈现，其间可见数据、引用和演示三类连线](/blog/live-data-stories-workspace.svg)

## 从证据开始，而不是从截图开始

Dataset 对象可以把 CSV 或 TSV 内容导入到有界的结构化字段中。画布会记录列、行数和一份用于检查及 Brain 上下文的安全样本，而不是把一张无限大的表塞进每一次推理请求。

对 Dataset 做数据画像，以了解其形态和覆盖范围。将其可视化，即可创建一个与源数据相连的 Chart。对于手动分析，Table 和 Spreadsheet 对象保存结构化的行、列和公式。它们是用途不同的不同工件，而不是一张通用的“数据卡片”。

## 构建决策层

Chart 对象保存图表类型、标签、数值和来源。KPI 对象携带数值、目标、单位、趋势和来源引用。Dashboard 可以把 KPI 和图表素材组装成运营视图；刷新和下钻操作仍原生属于该对象。

Report 和 Evaluation 则加入解读。Report 可以组合 Markdown、图表数据和引用。Evaluation 记录结论、缺口、建议和来源。Brain 可以跨越所选的证据对象和分析对象开展工作，而不会把它们的视觉位置与数据依赖混为一谈。

![Dataset、Table 和 Spreadsheet 对象构成证据层；Chart 和 KPI 对象构成视觉层；Dashboard、Report 和 Evaluation 构成决策层；Slides 呈现叙事，而带类型的数据、引用和演示连线则保留了数据溯源](/blog/data-story-object-pipeline.svg)

## 关系承载含义

画布上的一条线不仅仅是装饰。当一个对象提供数值时，使用**数据**连线；当结论引用证据时，使用**引用**连线；当 Dashboard 或 Report 为 Slides 提供支撑时，使用**演示**连线。

这张语义图让 Brain 能够区分“这张图表使用了该数据集”和“这张幻灯片提到了该报告”。它也让没有参与构建的人能够审阅这个可视化的故事。

## 从完整的套件开始

内置的 **Data story** 模板会在画布上放置一个 Source Dataset、Key trend Chart、Decision Dashboard 和 Executive data story Slides 对象，并带有实用的初始关系。它是一个脚手架，而不是封闭的工作流。你可以添加用于计算的 Spreadsheet、用于设定目标的 KPI、用于指出缺口的 Evaluation，或用于反映交付表现的 Project 上下文。

## 让面向高管的产出保持关联

当叙事发生变化时，证据应当仍然可以检查。画布上的 Slides 对象可以保留来源，而不是成为一份脱离上下文的幻灯片中的终端副本。审阅者可以从一个论断顺藤摸瓜，追溯到 Report、Dashboard、Chart，并最终到达支撑它的 Dataset。

这就是用图表装点一个结论与构建一个值得信赖的数据故事之间的区别：

**数据行 → 画像 → 视觉证据 → 决策视图 → 书面解读 → 演示**

每个阶段都仍然是一个对象。每个重要的依赖关系都可以保留为一条带类型的边。

[构建数据故事 →](/create/new)
