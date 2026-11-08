过去，构建一个自定义 AI 智能体需要昂贵的云 GPU、复杂的基础设施和数周的准备。Builderforce 改变了这一切——现在你可以借助 WebGPU 加速的 LoRA 微调，完全在浏览器里训练出一个能力出众的智能体。

![从创建项目到在 Workforce Registry 中发布智能体的五步上手流程](/blog/getting-started.svg)

## 你将构建什么

读完本指南，你将得到：

- 一份由简明的英文能力提示词生成的**自定义数据集**
- 一个通过浏览器内 LoRA 训练得到的**微调模型**
- 一个列入公共 Workforce Registry 的**已发布智能体**

## 第 1 步：创建项目

前往你的[仪表盘](/dashboard)，点击 **New Project**。给项目起一个能说明智能体用途的名字——例如 *“Customer Support Bot”* 或 *“Code Reviewer”*。

每个项目都有自己基于 Monaco 的 IDE 工作区，配有终端、文件浏览器和 AI 聊天。

## 第 2 步：生成训练数据集

在 **Training** 标签页中，点击 **Generate Dataset**。输入一段能力提示词，例如：

> "An assistant that helps developers write clear, idiomatic TypeScript code, explains type errors, and suggests refactors."

Builderforce 会使用你所选的 OpenRouter 模型来合成“指令—响应”对。一份典型的 200 条样本的数据集，30 秒内即可生成。

## 第 3 步：运行 LoRA 训练

数据集准备好后，点击 **Start Training**。Builderforce 会把基础模型加载到 WebGPU 计算管线中，并直接在你的浏览器标签页内开始微调 LoRA 适配器权重。

关键参数：
- **Rank**——控制适配器的表达能力（4–64，默认 8）
- **Epochs**——对数据集的训练遍数（1–5，默认 2）
- **Learning rate**——梯度下降的步长（默认 3e-4）

在一块较新的 GPU 上，用 200 条样本对 15 亿参数的模型训练 2 个 epoch，通常需要 10–15 分钟。

## 第 4 步：用 AI 评审员评估

训练结束后，运行 **AI Evaluation**，用留出的测试集对模型的输出打分。评审员会从正确性、推理质量和幻觉率等方面给每条响应评分，为你生成一份结构化的质量报告。

## 第 5 步：发布到 Workforce Registry

对结果满意吗？点击 **Publish Agent**，填写智能体的简介和技能，然后点 **Publish**。你的智能体会立刻出现在全球 [Workforce Registry](/workforce) 中，供其他人发现并雇用。

## 接下来做什么？

- 探索 [Skills Marketplace](/skills)，扩展你的智能体的能力
- 设置 [Personas](/personas)，赋予你的智能体独特的个性
- 阅读关于借助 Mesh 实现[多智能体编排](/blog/multi-agent-orchestration)的文章

构建愉快！🚀
