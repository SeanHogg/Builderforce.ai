---
summary: "Use MiniMax M3 and MiniMax-M3.1-Flash-Preview in BuilderForce Agents"
read_when:
  - You want MiniMax models in BuilderForce Agents
  - You need MiniMax setup guidance
title: "MiniMax"
---

# MiniMax

MiniMax is an AI company that builds the **M2/M3** model family. The current
coding-focused releases are **MiniMax-M3.1-Flash-Preview** (agentic reasoning,
tool use, coding, and structured task execution; 1M context, tunable thinking
depth) and **MiniMax-M3** (frontier multimodal coding, ~100+ tps, 1M context).

## Model overview

| Model | Context | Notes |
| --- | --- | --- |
| **MiniMax-M3.1-Flash-Preview** | 1,000,000 | Agentic reasoning, tool use, coding, structured task execution; tunable thinking depth. Default agentic flagship. |
| **MiniMax-M3** | 1,000,000 | Frontier multimodal coding (~100+ tps). Default chat / API-key model. |
| **MiniMax-M2.7** | 204,800 | Recursive self-improvement (~60 tps). |
| **MiniMax-M2.7-highspeed** | 204,800 | Same quality as M2.7, faster (~100 tps). |
| **MiniMax-M2.5** | 204,800 | Previous generation; still live on the API. |

## MiniMax-M2.7 vs MiniMax-M2.7-highspeed

- **Speed:** highspeed is the faster M2.7 variant (~100 tps vs ~60 tps).
- **Quality:** MiniMax documents the same performance, with highspeed being more agile.

## Choose a setup

### MiniMax OAuth (Coding Plan) — recommended

**Best for:** quick setup with MiniMax Coding Plan via OAuth, no API key required.

Enable the bundled OAuth plugin and authenticate:

```bash
builderforce plugins enable minimax-portal-auth  # skip if already loaded.
builderforce gateway restart  # restart if gateway is already running
builderforce onboard --auth-choice minimax-portal
```

You will be prompted to select an endpoint:

- **Global** - International users (`api.minimax.io`)
- **CN** - Users in China (`api.minimaxi.com`)

See [MiniMax OAuth plugin README](https://github.com/SeanHogg/Builderforce.ai/tree/main/extensions/minimax-portal-auth) for details.

### MiniMax M3 (API key)

**Best for:** hosted MiniMax with Anthropic-compatible API.

Configure via CLI:

- Run `builderforce configure`
- Select **Model/auth**
- Choose **MiniMax M3**

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

### MiniMax M3 as fallback (Opus primary)

**Best for:** keep Opus 4.6 as primary, fail over to MiniMax M3.

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

### Optional: Local via LM Studio (manual)

**Best for:** local inference with LM Studio.
We have seen strong results with MiniMax M2.1 on powerful hardware (e.g. a
desktop/server) using LM Studio's local server.

Configure manually via `builderforce.json`:

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

## Configure via `builderforce configure`

Use the interactive config wizard to set MiniMax without editing JSON:

1. Run `builderforce configure`.
2. Select **Model/auth**.
3. Choose **MiniMax M3**.
4. Pick your default model when prompted.

## Configuration options

- `models.providers.minimax.baseUrl`: prefer `https://api.minimax.io/anthropic` (Anthropic-compatible); `https://api.minimax.io/v1` is optional for OpenAI-compatible payloads.
- `models.providers.minimax.api`: prefer `anthropic-messages`; `openai-completions` is optional for OpenAI-compatible payloads.
- `models.providers.minimax.apiKey`: MiniMax API key (`MINIMAX_API_KEY`).
- `models.providers.minimax.models`: define `id`, `name`, `reasoning`, `contextWindow`, `maxTokens`, `cost`.
- `agents.defaults.models`: alias models you want in the allowlist.
- `models.mode`: keep `merge` if you want to add MiniMax alongside built-ins.

## Notes

- Model refs are `minimax/<model>`.
- Coding Plan usage API: `https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` (requires a coding plan key).
- Update pricing values in `models.json` if you need exact cost tracking.
- Referral link for MiniMax Coding Plan (10% off): [https://platform.minimax.io/subscribe/coding-plan?code=DbXJTRClnb&source=link](https://platform.minimax.io/subscribe/coding-plan?code=DbXJTRClnb&source=link)
- See [/concepts/model-providers](/concepts/model-providers) for provider rules.
- Use `builderforce models list` and `builderforce models set minimax/MiniMax-M3` to switch.

## Troubleshooting

### “Unknown model: minimax/MiniMax-M3”

This usually means the **MiniMax provider isn’t configured** (no provider entry
and no MiniMax auth profile/env key found). A fix for this detection is in
**2026.1.12** (unreleased at the time of writing). Fix by:

- Upgrading to **2026.1.12** (or run from source `main`), then restarting the gateway.
- Running `builderforce configure` and selecting **MiniMax M3**, or
- Adding the `models.providers.minimax` block manually, or
- Setting `MINIMAX_API_KEY` (or a MiniMax auth profile) so the provider can be injected.

Make sure the model id is **case‑sensitive**:

- `minimax/MiniMax-M3.1-Flash-Preview`
- `minimax/MiniMax-M3`
- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.7-highspeed`
- `minimax/MiniMax-M2.5`

Then recheck with:

```bash
builderforce models list
```
