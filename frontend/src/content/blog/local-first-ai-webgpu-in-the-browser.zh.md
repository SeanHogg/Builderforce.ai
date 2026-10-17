SitePoint 最近发布了一份出色的蓝图，讲解如何完全在浏览器内运行大语言模型：[*Local-First AI With WebGPU: A Practical Guide for Chrome*](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/)。这是我们见过的最清晰的一篇文章，讲清了端侧推理*为什么*终于可行，以及一个生产级实现*需要*做对哪些事。

我们读它的方式，就像对照一份清单检查一件早已交付的东西。Builderforce 在浏览器标签页中运行 WebGPU 推理——以及训练——已经超过一年。所以这篇文章做两件事：先梳理这篇文章推荐的架构，然后逐项展示我们的平台如何实现清单上的每一条，以及指南没有涉及的部分。

## 一段话讲清这份蓝图

指南认为，三项进展让本地优先的 AI 成为现实：**4 位量化的小模型**、**Chrome 113 中稳定发布的 WebGPU**，以及通过 Prompt API 开放的 Chrome **内置 Gemini Nano**。它推荐的架构按硬件所长分工——WebGPU 计算着色器（WGSL）负责矩阵乘法密集的前向传播，WebAssembly 负责分词和采样——并置于一个**渐进增强级联**之后：Prompt API（第 1 层）→ Web-LLM 这类 WebGPU 框架（第 2 层）→ 云端回退（第 3 层），全部统一在一个接口之下。随后它列出了运维上的必备项：在 **Web Worker** 中运行推理、预热以缩短首 token 时间、在本地**缓存权重**、从 **`GPUDevice.lost`** 中恢复，以及对一切做特性检测。

这是一份很棒的清单。下面是我们对每一项的做法。

## 1. 计算层：我们自带 WGSL 内核

指南建议借助框架（Web-LLM、Transformers.js）把 Transformer 的数学运算映射到 GPU 工作组上。我们则往下多走了一层。Builderforce 的引擎为 Mamba **状态空间模型**配备了**手写的 WGSL 内核**——其选择性扫描（S6）核心以 Kogge-Stone 并行前缀扫描实现，在 GPU 上以 O(log N) 运行，并采用数值稳定的 softplus 和零阶保持离散化。

关键在于，我们的内核实现了**反向传播**，而不仅仅是前向传播。这意味着我们不只是在端侧*运行*模型——我们还在端侧**训练**模型，基于你自己的代码执行真正的 AdamW 梯度更新，全部在标签页内完成。SitePoint 的指南止步于推理；而正是这项能力，让[“记忆优先”的学习](/blog/evermind-self-updating-model)和[浏览器内 LoRA 微调](/blog/webgpu-lora-explained)成为可能。

## 2. 设备选择：WebNN → WebGPU → CPU

文章把 WebGPU 当作*唯一*的计算路径，我们则把它当作三条路径中的中间一条。我们的设备路由器按优先级依次探测：

1. **WebNN**——神经网络 API，可以在动用 GPU 之前优先调用专用 **NPU**（Snapdragon X、Apple Neural Engine、Intel AI Boost）。
2. **WebGPU**——指南重点讨论的高性能 GPU 路径。
3. **CPU（WASM SIMD）**——实打实的兜底方案。

一次探测，一个决定，所有使用方共享——没有哪个组件会自己再算一遍“这个浏览器能不能跑”。而且我们刻意**不虚构显存数值**：WebGPU 并不暴露真实内存，所以我们报告 `null`，而不是把 2 GB 的规格上限误当成一块 2 GB 的显卡，从而错误地把一块 16 GB 的 GPU 拒之门外。

## 3. 第 1 层：Chrome 内置的 Gemini Nano

这是该指南的核心功能，也是 Builderforce 中的一等引擎。Prompt API 引擎封装了 Chrome 的 `LanguageModel` API：应用**零下载**（模型随浏览器提供），无需管理显存预算，开箱即有**真正的逐 token 流式输出**。它与另外两个在 WebGPU 上运行已下载模型的引擎并列——我们自研的 1 比特 **Bonsai** 引擎和 **WebLLM**——共用同一个 `PageEngine` 契约：

```ts
import { createPageEngineSet } from '@seanhogg/builderforce-brain-embedded';

// Bonsai, WebLLM and the Prompt API — one set per page, one fetch shim, one model store.
const engines = createPageEngineSet({ loadBfi });
```

该引擎会检测 API 是否可用，处理浏览器报告的 `downloadable`/`downloading`/`available` 状态，而且每个引擎都会报告真实的上下文窗口，因此对话会在到达较小的本地模型*之前*被裁剪到合适大小。

## 4. 渐进增强级联

该指南最重要的思想是架构层面的：**一个接口、多个后端、优雅降级**。在 Builderforce 中，这是唯一的路由步骤 `createHostModelStream`——Web 应用、VS Code 扩展和 Chrome 侧边栏运行的是同一个函数：

```ts
import { createHostModelStream } from '@seanhogg/builderforce-brain-embedded';

const stream = createHostModelStream({
  probes: () => engines.probe(),  // what this page can run right now
  fetch: engines.fetch(),         // the engines' one transport
  cloud: () => gatewayStream,     // the terminal tier
});
```

每次调用的顺序为：

1. **你固定的模型**（来自“在此设备上”选择器）——就在这里运行
2. **本地优先**——只要有就绪的引擎能处理请求，就在设备上作答
3. **云端 LLM**——始终可用，也是本地尝试失败时的**无感回退**

“用哪个后端？”的决定只存在于一个地方。你的界面只管流式输出，从不自己按可用性分支。

## 5. Web Worker 隔离

指南说得对：繁重的工作绝不能阻塞主线程——*每个 token* 都在 15 万项的 logit 向量上采样会让界面卡顿。当宿主提供 Worker 时，WebLLM 在 Web Worker 中运行；而我们的本地 **Mamba** 引擎——也就是你训练的那个——完全运行在 Worker 内。由于 `GPUDevice` 无法跨越 Worker 边界传递，Worker 承载整个引擎，主线程通过一个小型 RPC 协议与之通信：

```ts
import { initMambaProvider } from '@/lib/mamba-worker-client';

// Off the main thread when the runtime allows it; in-page otherwise.
const mamba = await initMambaProvider({ dModel: 512, numLayers: 8 });
await mamba.train(code, { epochs: 3, onEpochEnd: (epoch, loss) => plot(epoch, loss) });
```

token 与每个 epoch 的进度事件以消息形式传回；训练好的检查点以**转移**（而非复制）的方式送回。如果运行环境无法创建 Worker，就回退到页面内引擎——一切照常工作。

## 6. `GPUDevice.lost` 恢复

标签页被切到后台、驱动重置，或者笔记本切换 GPU，都会悄无声息地让你持有的每个缓冲区和管线失效。指南指出了这个问题，而大多数浏览器内演示都忽略了它。Builderforce 在唯一的设备获取点订阅了设备丢失的 promise。真正的丢失会拆除模型，并把 provider 切回*未就绪*状态，于是下一次调用会干净地重新初始化——而主动调用的 `destroy()` 会被过滤掉，永远不会被误判为故障。

## 7. 权重缓存、流式下载与隐私

模型权重在首次下载后缓存在 **IndexedDB** 中，下载来自一条多源链路（我们的 R2 代理 → Hugging Face CDN），并带有流式进度——因此一个数 GB 的检查点只需下载一次，而不是每次加载页面都下载。指南所说的那条“架构层面的事实”，也正是我们构建这一切的原因：采用本地推理，**你的提示和代码永远不会离开这台机器**。这不是一句政策承诺；网络请求根本就不会发生。

## 对照表：指南清单 vs. Builderforce

| 指南中的最佳实践 | Builderforce |
| --- | --- |
| WebGPU 计算着色器 | ✅ 手写的 WGSL Mamba SSM 内核 |
| WASM 分词/采样 | ✅ BPE 分词器，基于你自己的语料训练 |
| Chrome Prompt API（第 1 层） | ✅ Prompt API 引擎，真正的流式输出 |
| Web-LLM / WebGPU（第 2 层） | ✅ WebLLM 与我们的 1 比特 Bonsai 引擎，运行于 WebGPU |
| 云端回退（第 3 层） | ✅ 级联中的最终层 |
| 统一接口 + 回退 | ✅ `createHostModelStream`，每个界面同一步骤 |
| Web Worker 隔离 | ✅ WebLLM 与 Mamba 引擎运行在 Worker 中 |
| `GPUDevice.lost` 恢复 | ✅ 单一来源的设备丢失处理 |
| 本地权重缓存 | ✅ IndexedDB、流式、多源 |
| 对一切做特性检测 | ✅ WebNN → WebGPU → CPU 探测 |
| **端侧*训练*** | ✅ **超越指南**——真正的反向传播 + AdamW |
| **通过 WebNN 调用 NPU** | ✅ **超越指南** |
| **设备端答案记忆** | ✅ **超越指南**——设备端 SSM 嵌入 |

## 如何使用

以上每一部分今天都已可用：

- **聊天与助手界面**免费获得本地优先的级联——浏览器能运行时使用 Gemini Nano 或你在“在此设备上”选择器中下载的模型，否则使用云端；Web、VS Code 和 Chrome 侧边栏的路由完全相同。
- **注重隐私的工作**固定一个设备端模型，请求永远不会离开本机。
- **微调**在 [AI 训练面板](/training)中完成：把它指向你的代码，真正的 WebGPU 梯度下降就会产出一个从不触碰服务器的检查点。

SitePoint 的指南是一张正确的地图。而 Builderforce 是一个早已走遍这片疆域的平台——并且还在继续前行，走进了端侧训练这片直到最近还被认为浏览器根本无法涉足的领域。

*想看更深入的技术版本？请阅读[深入 Evermind 架构](/blog/inside-evermind-architecture)和 [WebGPU LoRA 微调详解](/blog/webgpu-lora-explained)。*
