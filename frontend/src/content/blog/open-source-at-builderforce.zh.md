Builderforce 中运行在你机器上或浏览器里的部分，正是你应该能够阅读的部分。它们会接触你的文件、你的密钥、你的模型以及你用户的会话。对这些事情来说，“相信我们”是个糟糕的回答，更好的回答是源代码。

所以 Builderforce 赖以构建的运行时都以 MIT 许可开源。一共有四个，每一个都是产品真正在运行的代码，而不是从中裁剪出来的演示版。两个库完全不需要账户；两个桌面应用会登录 Builderforce 来使用云端的那部分功能。四个项目都可以在 [builderforce.ai/open-source](/open-source) 找到。

```bf-figure
{
  "kind": "stack",
  "title": "四个项目，其上是一个平台",
  "bands": [
    { "label": "BuilderForce WebContainers", "note": "浏览器内开发运行时：预览、构建、类型检查、Node、npm 和 shell，无需 COOP/COEP，没有会话上限。", "hue": "make", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Memory", "note": "面向任何智能体的持久化、可在浏览器中训练的 SSM 记忆，能削减 token 开销的语义缓存，以及一个 MCP 服务器。", "hue": "idea", "tag": "TypeScript · npm" },
    { "label": "BuilderForce Inference", "note": "桌面应用 Synapse，以及在你自己机器上运行模型的原生引擎 bfi。", "hue": "run", "tag": "Rust" },
    { "label": "BuilderForce Spawn", "note": "通过对话构建 Roblox 游戏：一个桌面应用加一个 Roblox Studio 桥接。", "hue": "reach", "tag": "Rust" }
  ],
  "caption": "四个项目都采用 MIT 许可。库不需要账户；桌面应用会为云端部分登录。"
}
```

## BuilderForce WebContainers——每个预览背后的运行时

**它是什么。** 一个开放、可复刻的浏览器内开发运行时。把项目以文件形式交给它，它就会提供实时预览：使用 React、Vue 或 Svelte 的 Vite 项目、Create React App 和静态网站。它能在页面中构建部署产物（`runtime.build()`）和做类型检查（`createChecker()`），还能运行 Node 程序、从真实仓库执行 `npm install`，并提供交互式 shell，每个进程一个 Web Worker。

**它的价值。** 它只需要一个安全上下文和一个 Service Worker，别无其他。不需要 COOP/COEP 响应头，意味着你应用里的登录弹窗、支付框架和嵌入内容都能照常工作。没有会话上限，意味着打开预览不花钱。可插拔的端口，意味着你可以替换编译器或包 CDN，而不必复刻核心。它取代了 StackBlitz WebContainers，支撑着 Builderforce 上的每个画布预览、发布和检查。

**说清楚它的限制。** 原生插件、安装脚本，以及 Next.js、Nuxt、SvelteKit、Remix 和 Astro 的开发服务器都无法运行；运行时会识别这些项目并说明原因。WebSocket 和流式响应已列入路线图。

[阅读项目介绍页](/open-source/builderforce-webcontainers) · [阅读发布公告](/blog/builderforce-webcontainers-open-source) · [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)

## BuilderForce Memory——任何智能体都能保有的记忆

**它是什么。** 一个为任何 AI 智能体提供可在浏览器中训练的持久化记忆的框架。它包含三个包：由 WebGPU Mamba 状态空间内核、训练器和分词器组成的引擎（`@seanhogg/builderforce-memory-engine`）；带有 Anthropic、OpenAI 和 Fetch 桥接、推理路由、在线蒸馏和记忆存储的运行时（`@seanhogg/builderforce-memory`）；以及一个 MCP 服务器，附带一个安装器，可以把它注册到 Claude Code、Claude Desktop、Cursor、Windsurf、VS Code、Cline、Gemini CLI 和 Codex CLI 中（`@seanhogg/builderforce-memory-mcp`）。

**它的价值。** 更低的 token 账单，以及始终保持最新的知识。当新提示只是某个已回答问题的换种说法时，语义缓存会复用之前的答案，前沿模型根本不会被调用。写穿式认知会在有证据支持新事实时替换掉过时的事实，而不是把两者堆在一起等人来调和。它是 Builderforce 上 Evermind 的记忆层，并且与模型提供商无关，所以在一个从没听说过我们的智能体下面，它同样有用。

[阅读项目介绍页](/open-source/builderforce-memory) · [GitHub](https://github.com/SeanHogg/builderforce-memory)

## BuilderForce Inference——在你自己的机器上运行模型

**它是什么。** Builderforce 桌面应用 Synapse，以及它下面的本地 AI 运行时。`bfi` 是一个用 Rust 编写的原生引擎，它读取 GGUF 模型，提供兼容 OpenAI、Anthropic 和 Ollama 的 HTTP API，并在你的硬件上运行。Synapse 负责管理它，所以不需要 Ollama。同一个工作区里还有代码索引、用于连接器的 MCP 宿主、Evermind 记忆客户端，以及保存在操作系统凭据存储中的密钥。

**它的价值。** 私密的工作保持私密。本地模型无需网络调用就能回应你的编辑器和脚本，Evermind 在你机器上学到的东西也会留在那里，除非你选择发布。CPU 路径今天已经可用；我们没有宣称 GPU 性能与 llama.cpp 持平，README 里也是这么写的。

[阅读项目介绍页](/open-source/builderforce-inference) · [GitHub](https://github.com/SeanHogg/builderforce-inference)

## BuilderForce Spawn——通过对话构建 Roblox 游戏

**它是什么。** Spawn，一个面向 Roblox 创作者的桌面应用，以及把它连接到 Roblox Studio 的桥接。描述你想要的游戏，它就会在 Studio 里构建部件、Luau 脚本和界面。它通过来自 BuilderForce Inference 的共享客户端登录 Builderforce。

**它的价值。** 只需安装一样东西，而不是一个应用、一个插件、一个本地服务器和一个同步工具。并且因为它是开源的，想确切知道一个面向年轻创作者的构建工具到底在做什么的家长、学校和创作者，都可以去阅读它。

[阅读项目介绍页](/open-source/builderforce-spawn) · [GitHub](https://github.com/SeanHogg/builderforce-spawn)

## 单独使用，或在 Builderforce 上使用

```bf-figure
{
  "kind": "compare",
  "title": "同样的代码，两种用法",
  "columns": [
    { "title": "单独使用", "hue": "muted", "items": ["从 npm 或 cargo 安装，或从 GitHub 克隆", "MIT：复刻、发布、出售都可以", "阅读在你这一侧运行的每一行代码", "自己托管，成果归你所有"] },
    { "title": "在 Builderforce 上", "hue": "make", "items": ["已接入画布、Studio、Brain 和桌面应用", "其上还有智能体、看板、审批和市场", "记忆在你的 Web 应用、智能体和本机之间共享", "一步发布到你自己的地址"] }
  ],
  "caption": "在这里，开源不是试用版。GitHub 上的代码就是产品运行的代码。"
}
```

## 它在方法中的位置

在 Builderforce 上，工作遵循一条弧线：**Idea → Make → Run → Measure**，每一幕都经过同一个内循环：[Read、Prove、Build](/blog/read-prove-build-the-inner-loop)。每个项目承载着其中不同的部分。

- **Make** 运行在 BuilderForce WebContainers 上。想法在标签页里变成一个运行中的应用，而 **Prove** 保持免费，因为启动一个原型不花钱。
- **Run** 借助 BuilderForce Inference 来到你的机器上。本地运行的模型没有计费表，所以让一个智能体持续运行，是关于时间的选择，而不是关于钱的选择。
- **Measure** 为 BuilderForce Memory 提供养分。有效的做法会被记住，重复的问题由记忆来回答，下一个 **Idea** 从上一个想法教会的东西开始。
- 游戏的 **Make** 是 Spawn：同样的循环，发生在 Roblox Studio 里。

开源并不改变方法。它改变的是谁能检查这项工作：在你这一侧运行的每一幕，运行的都是你能阅读的代码。

## 如何开始

- 在 [builderforce.ai/open-source](/open-source) 浏览这四个项目。
- 嵌入运行时：`npm install @seanhogg/builderforce-webcontainers`。
- 给你的智能体加上记忆：`npm install @seanhogg/builderforce-memory`，或者把 MCP 服务器安装到你已经在用的工具里。
- 在本地运行模型：`cargo install --git https://github.com/SeanHogg/builderforce-inference bfi`。
- 提交 issue 或发送 Pull Request。每个仓库都维护着一份下一步计划的路线图。

---

**相关阅读：** [BuilderForce WebContainers 开源了](/blog/builderforce-webcontainers-open-source) · [Synapse 现在自己运行模型](/blog/synapse-runs-models-itself) · [Spawn——通过对话构建 Roblox 游戏](/blog/build-roblox-games-by-talking)

[打开一个画布](/create)，看看这个运行时如何工作。
