---
read_when:
  - 你想在 BuilderForce Agents 中使用 MiniMax 模型
  - 你需要 MiniMax 设置指南
summary: 在 BuilderForce Agents 中使用 MiniMax M3 与 MiniMax-M3.1-Flash-Preview
title: MiniMax
x-i18n:
  generated_at: "2026-02-03T10:08:52Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 861e1ddc3c24be88f716bfb72d6015d62875a9087f8e89ea4ba3a35f548c7fae
  source_path: providers/minimax.md
  workflow: 15
---

# MiniMax

MiniMax 是一家构建 **M2/M3** 模型系列的 AI 公司。当前面向编程的版本是 **MiniMax-M3.1-Flash-Preview**（智能体推理、工具调用、编程与结构化任务执行；100 万上下文、可调思考深度）以及 **MiniMax-M3**（前沿多模态编程，约 100+ tps，100 万上下文）。

## 模型概述

| 模型 | 上下文 | 说明 |
| --- | --- | --- |
| **MiniMax-M3.1-Flash-Preview** | 1,000,000 | 智能体推理、工具调用、编程、结构化任务执行；可调思考深度。默认智能体旗舰。 |
| **MiniMax-M3** | 1,000,000 | 前沿多模态编程（约 100+ tps）。默认对话 / API Key 模型。 |
| **MiniMax-M2.7** | 204,800 | 递归自我改进（约 60 tps）。 |
| **MiniMax-M2.7-highspeed** | 204,800 | 与 M2.7 同等质量，更快（约 100 tps）。 |
| **MiniMax-M2.5** | 204,800 | 上一代；API 上仍可用。 |

## MiniMax-M2.7 vs MiniMax-M2.7-highspeed

- **速度：** highspeed 是更快的 M2.7 变体（约 100 tps vs 约 60 tps）。
- **质量：** MiniMax 文档称性能相同，highspeed 更敏捷。

## 选择设置方式

### MiniMax OAuth（编程计划）— 推荐

**适用于：** 通过 OAuth 快速设置 MiniMax 编程计划，无需 API 密钥。

启用内置 OAuth 插件并进行认证：

```bash
builderforce plugins enable minimax-portal-auth  # 如果已加载则跳过
builderforce gateway restart  # 如果 Gateway 网关已在运行则重启
builderforce onboard --auth-choice minimax-portal
```

系统会提示你选择端点：

- **Global** - 国际用户（`api.minimax.io`）
- **CN** - 中国用户（`api.minimaxi.com`）

详情参见 [MiniMax OAuth 插件 README](https://github.com/SeanHogg/Builderforce.ai/tree/main/extensions/minimax-portal-auth)。

### MiniMax M3（API 密钥）

**适用于：** 使用 Anthropic 兼容 API 的托管 MiniMax。

通过 CLI 配置：

- 运行 `builderforce configure`
- 选择 **Model/auth**
- 选择 **MiniMax M3**

```json5
{
  env: { MINIMAX_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "minimax/MiniMax-M3" } } },
  models: {
    mode: "merge",
    providers: {
      minimax: {
        baseUrl: "https://api.minimax.io/anthropic",
        apiKey: "${MINIMAX_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "MiniMax-M3.1-Flash-Preview",
            name: "MiniMax M3.1 Flash Preview",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
            contextWindow: 1000000,
            maxTokens: 8192,
          },
          {
            id: "MiniMax-M3",
            name: "MiniMax M3",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
            contextWindow: 1000000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

### MiniMax M3 作为备用（Opus 为主）

**适用于：** 保持 Opus 4.6 为主模型，故障时切换到 MiniMax M3。

```json5
{
  env: { MINIMAX_API_KEY: "sk-..." },
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": { alias: "opus" },
        "minimax/MiniMax-M3": { alias: "minimax" },
      },
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["minimax/MiniMax-M3"],
      },
    },
  },
}
```

### 可选：通过 LM Studio 本地运行（手动）

**适用于：** 使用 LM Studio 进行本地推理。
我们在强大硬件（例如台式机/服务器）上使用 LM Studio 的本地服务器运行 MiniMax M2.1 时看到了出色的效果。

通过 `builderforce.json` 手动配置：

```json5
{
  agents: {
    defaults: {
      model: { primary: "lmstudio/minimax-m2.1-gs32" },
      models: { "lmstudio/minimax-m2.1-gs32": { alias: "Minimax" } },
    },
  },
  models: {
    mode: "merge",
    providers: {
      lmstudio: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
        api: "openai-responses",
        models: [
          {
            id: "minimax-m2.1-gs32",
            name: "MiniMax M2.1 GS32",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 196608,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

## 通过 `builderforce configure` 配置

使用交互式配置向导设置 MiniMax，无需编辑 JSON：

1. 运行 `builderforce configure`。
2. 选择 **Model/auth**。
3. 选择 **MiniMax M3**。
4. 在提示时选择你的默认模型。

## 配置选项

- `models.providers.minimax.baseUrl`：推荐使用 `https://api.minimax.io/anthropic`（Anthropic 兼容）；`https://api.minimax.io/v1` 可选用于 OpenAI 兼容的负载。
- `models.providers.minimax.api`：推荐使用 `anthropic-messages`；`openai-completions` 可选用于 OpenAI 兼容的负载。
- `models.providers.minimax.apiKey`：MiniMax API 密钥（`MINIMAX_API_KEY`）。
- `models.providers.minimax.models`：定义 `id`、`name`、`reasoning`、`contextWindow`、`maxTokens`、`cost`。
- `agents.defaults.models`：为你想要在允许列表中的模型设置别名。
- `models.mode`：如果你想将 MiniMax 与内置模型一起添加，保持 `merge`。

## 注意事项

- 模型引用格式为 `minimax/<model>`。
- 编程计划使用量 API：`https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`（需要编程计划密钥）。
- 如果需要精确的成本跟踪，请更新 `models.json` 中的定价值。
- MiniMax 编程计划推荐链接（9 折优惠）：https://platform.minimax.io/subscribe/coding-plan?code=DbXJTRClnb&source=link
- 参见 [/concepts/model-providers](/concepts/model-providers) 了解提供商规则。
- 使用 `builderforce models list` 和 `builderforce models set minimax/MiniMax-M3` 切换模型。

## 故障排除

### "Unknown model: minimax/MiniMax-M3"

这通常意味着 **MiniMax 提供商未配置**（没有提供商条目，也没有找到 MiniMax 认证配置文件/环境变量密钥）。此检测的修复在 **2026.1.12** 中（撰写本文时尚未发布）。修复方法：

- 升级到 **2026.1.12**（或从源码 `main` 分支运行），然后重启 Gateway 网关。
- 运行 `builderforce configure` 并选择 **MiniMax M3**，或
- 手动添加 `models.providers.minimax` 块，或
- 设置 `MINIMAX_API_KEY`（或 MiniMax 认证配置文件）以便注入提供商。

确保模型 id **区分大小写**：

- `minimax/MiniMax-M3.1-Flash-Preview`
- `minimax/MiniMax-M3`
- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.7-highspeed`
- `minimax/MiniMax-M2.5`

然后重新检查：

```bash
builderforce models list
```
