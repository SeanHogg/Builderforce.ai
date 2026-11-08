从设计到代码，最昂贵的部分往往不是实现，而是重建上下文：批准的是哪个概念，哪个组件实现了它，哪条诊断信息才重要，以及本地预览是否反映了当前分支。

Creation Canvas 可以把这条链路保存为一组相互连接的工件，而不是散落在各个工具之间的一串链接。

![设计到调试会话的产品视图：Website 和移动端 WYSIWYG 工件与 Repository、Editor selection、Diagnostics、Terminal output、Local service 和 Browser preview 对象相连](/blog/design-build-debug-workspace.svg)

## 设计工件保持可编辑

Website 对象代表一个多页面站点概念，包含标题、正文、行动号召、强调色、视口和页面。WYSIWYG Prototype 为更聚焦的产品工作提供交互式概念。Mockup 和 Mockup Set 对象则支持可单独评审的功能概念及其交付。

这些对象既可以直接修订，也可以由 Brain 通过它们声明的可变字段来编写。预览始终是对象的原生操作，而不是贴进对话里的一张截图。

## 开发上下文来自 VS Code

原生的 BuilderForce VS Code 界面可以把 Repository、当前的 Editor selection、Diagnostics、Terminal output、Local service、Code workspace 和 Browser preview 添加到同一个由服务端支撑的 Session 中。

每个对象都携带与其类型相称的上下文：仓库 URL 和分支；选中的代码、语言、路径和范围；诊断条目和严重程度；终端内容和退出码；或本地服务的 URL 和端口。终端工件会被明确标记为需要进行密钥审查，敏感的上下文键会被排除在 Brain 的安全对象适配器之外。

![Website、WYSIWYG Prototype 和 Mockup 构成设计层；Repository、Selection 和 Code 构成实现上下文；Diagnostics 和 Terminal 提供故障证据；Local service 驱动 Browser preview；获批的产出可以成为受治理的 Project Task](/blog/design-to-debug-object-graph.svg)

## 把故障与它影响的对象连起来

带类型的关系让调试画布真正有用。一个 Selection 可以**引用**一个 Prototype。Diagnostics 可以**引用**该 Selection。一个 Local service 可以**控制**一个 Browser preview。预览可以**呈现**当前的 Website。获批的 Mockup 可以通过**交付**关系连接到一个 Task。

这样，Brain 就能回答一个限定范围的问题，例如“这个实现是否满足所选的移动端概念，以及是什么阻碍了预览？”，回答时使用的是相关对象，而不是整个代码仓库或一份被压平的对话记录。

## 修改工作区之前先评审

如果 Brain 提议新增代码工件、更新验收标准、重新排布 Frame 或添加关系，这些变更会以提案集的形式出现。原生的操作性动作保留各自的权限。本地匿名画布可以勾勒出完整的实现全貌，但持久的交付和指派要等到有账号支撑的工作区才能进行。

## 一次交接，仍是同一个会话

产品和设计可以通过浏览器参与，工程可以通过编辑器参与。任何一方都不会沦为另一方的嵌入式视图。共享的对象图就是交接契约：

**获批的意图 → 实现上下文 → 诊断证据 → 运行中的服务 → 浏览器结果 → 受治理的交付**

当工件、代码和故障都在一处时，“我们当初想构建的是什么？”就不再是一项反复出现的调试任务。

[开启一次从设计到代码的会话 →](/create/new)
