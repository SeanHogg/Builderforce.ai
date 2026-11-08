Synapse 现在自己运行模型。不再需要 Ollama。

在这次切换之前，Synapse 中的本地模型意味着安装别人的运行时、祈祷它在 PATH 里，并忍受那个运行时碰巧接受的任何 GGUF 类型。那是一个我们无法掌控的产品，却处在我们自己产品的关键路径上。

```bf-figure
{
  "kind": "flow",
  "title": "从安装到编辑器里出现一个模型",
  "steps": [
    { "label": "Synapse", "note": "桌面应用启动并监管 bfi serve。无需安装 Ollama。", "hue": "idea" },
    { "label": "bfi", "note": "原生引擎加载 GGUF——包括 PrismML 的 PQ2_0 和 PTQ1_0。", "hue": "make" },
    { "label": "desktop.json", "note": "Synapse 写入 ~/.builderforce/desktop.json，其中包含模型端点。", "hue": "run" },
    { "label": "VS Code", "note": "BuilderForce 扩展发现提供方 id synapse，并列出这些模型。", "hue": "run" }
  ],
  "caption": "机器上只有一个运行时。编辑器能找到它。路径中没有 Ollama。"
}
```

## 为什么我们替换了 Ollama

三项成本，全都由想在自己机器上运行模型的人来承担。

**一个我们无法控制的安装步骤。**如果缺少 Ollama，Models 视图会把你指向别人的下载页面。在那个产品存在并运行正常之前，Synapse 无法启动本地推理。

**我们最想要的格式在它上面跑不了。**PrismML 的 Ternary Bonsai 2 27B 以 `PQ2_0` / `PTQ1_0` GGUF 发布——2 比特和约 1.75 比特的三值块。Ollama 内嵌的原版 llama.cpp 两种类型都会拒绝。只有一个分支版本能运行它们。一个无法加载我们所关心权重的本地模型产品，算不上本地模型产品。

**容量估算靠猜。**内存估算来自一张固定的每权重比特数表。它对三值格式、混合注意力的 KV 开销以及运行时的真实额外开销一无所知。`bfi fit` 则根据我们实际加载的 GGUF 来估算。

## 2 比特的故事

`bfi` 是 [builderforce-inference](https://github.com/SeanHogg/builderforce-inference) 中的纯 Rust 引擎。它读取 GGUF v2/v3，包括 PrismML 的 `PQ2_0`（类型 142）和 `PTQ1_0`（类型 143）。它们正是 Bonsai 2 27B 实际发布所用的 2 比特 / 三值布局——而不是 Q2_0 或 TQ1_0，后两者无法无损地表示 group-128 检查点。

Synapse 把 `bfi serve` 作为子进程来监管：健康检查、退避、重启。如果引擎挂了，Synapse 仍会继续运行。CPU sidecar 随应用一同发布。你也可以自己安装 CLI：

```sh
cargo install --git https://github.com/SeanHogg/builderforce-inference bfi
```

已签名的 GitHub Release 二进制文件尚未发布。这取决于所有者的签名密钥，而不取决于这次切换。

## VS Code 在本机上找到它

BuilderForce VS Code 扩展不会去猜端口。它读取 `~/.builderforce/desktop.json`（Windows：`%USERPROFILE%\.builderforce\desktop.json`；可通过 `BUILDERFORCE_DESKTOP_DISCOVERY` 覆盖）：

```json
{
  "models": {
    "endpoint": "http://127.0.0.1:…",
    "provider": "synapse"
  }
}
```

本地提供方 id 是 `synapse`，绝不是 `bfi`。目录和安装都通过 Synapse 进行（`GET /v1/synapse/catalog`、`POST /api/pull`）。如果 Synapse 没有运行，该分组就不会渲染。已有的 Ollama 提供方仍可对任何兼容 Ollama 的服务器工作，包括独立运行的 `bfi serve`。

## 我们没有声称的内容

CPU sidecar 已发布。这就是这次切换。

我们**没有**声称在 Metal 或 NVIDIA 上达到 llama-bench tok/s 的 GPU 70%。CubeCL 内核可以编译；但尚未进行“是否继续”的判定性测量。

我们**没有**声称 Bonsai 27B 与 PrismML llama.cpp 分支在线上贪心解码结果完全一致。32K / 36 GiB 的容量测试在 CPU 上通过；线上对比需要我们在 CI 中不运行的权重。

这些仍留在 ROADMAP 上。这篇文章讲的是切换，而不是终点线。
