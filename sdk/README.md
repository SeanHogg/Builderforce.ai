# @seanhogg/builderforce-sdk

Typed TypeScript SDK for the [Builderforce.ai](https://builderforce.ai) LLM gateway. OpenAI-compatible chat completions with tool calling and structured output, embeddings, model registry, and usage analytics — all behind a single tenant API key. Vendor failover (OpenRouter / Cerebras / Ollama / Claude / GPT / Gemini / Grok) is handled server-side so your code only knows about Builderforce.

- **Vanilla `fetch` / `AbortController` / `ReadableStream` / `TextDecoder`** — runs on Node 18+, Cloudflare Workers, browsers, edge runtimes.
- **Zero runtime dependencies.** ~12 kB compressed, ~63 kB unpacked.
- **Dual ESM + CJS + `.d.ts`** out of the box.

## Install

```bash
npm install @seanhogg/builderforce-sdk
```

## Quick start

```ts
import { BuilderforceClient } from '@seanhogg/builderforce-sdk';

const client = new BuilderforceClient({
  apiKey: process.env.BUILDERFORCE_API_KEY!,
  // Optional:
  // baseUrl: 'https://api.builderforce.ai',
  // timeoutMs: 60_000,
});

const res = await client.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarize this PRD in three bullets.' }],
});

console.log(res.choices?.[0]?.message?.content);
```

The gateway routes by **request shape** — presence of `tools`, `response_format`, image content blocks, plan tier — so callers don't pass routing intents. For typical request shapes per scenario (recruiter outreach, salary estimate, auto-apply orchestration, etc.) see [docs/SCENARIOS.md](./docs/SCENARIOS.md).

## Auth

The SDK sends `Authorization: Bearer <apiKey>` automatically. The gateway accepts three credential types:

| Prefix | Issued by | Best for |
|---|---|---|
| `bfk_*` | `POST /api/tenants/:tenantId/api-keys` (owner-only) | Tenant apps (server-to-server). Long-lived, tenant-scoped, revocable. |
| `clk_*` | `POST /api/claws` (CoderClaw registration) | Self-hosted CoderClaw instances; carries optional per-claw daily token cap. |
| Tenant JWT | `POST /api/auth/web/login` → `POST /api/auth/tenant-token` | Browser-side calls from a logged-in user. Short-lived. |

## Streaming chat

```ts
const stream = await client.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Outline a 3-act story.' }],
});

for await (const chunk of stream) {
  const delta = chunk.choices?.[0]?.delta?.content ?? '';
  process.stdout.write(delta);
}

// Or buffer to a single string:
const text = await stream.toText();
```

## Tool calling

Full OpenAI-compatible tool / function calling round-trip — assistant requests a tool, you execute it, you feed the result back, the assistant continues:

```ts
import type { ToolSpec, ChatMessage } from '@seanhogg/builderforce-sdk';

const tools: ToolSpec[] = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Look up current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
}];

const messages: ChatMessage[] = [
  { role: 'user', content: "What's the weather in Tokyo?" },
];

// Turn 1 — model decides to call the tool.
const turn1 = await client.chat.completions.create({
  tools,
  tool_choice: 'auto',
  messages,
});

const assistantMsg = turn1.choices?.[0]?.message;
const toolCall = assistantMsg?.tool_calls?.[0];

if (toolCall) {
  const args = JSON.parse(toolCall.function.arguments) as { city: string };
  const weather = await fetchWeather(args.city);

  // Turn 2 — feed the tool result back.
  messages.push(
    { role: 'assistant', content: null, tool_calls: [toolCall] },
    { role: 'tool', content: JSON.stringify(weather), tool_call_id: toolCall.id },
  );

  const turn2 = await client.chat.completions.create({ tools, messages });
  console.log(turn2.choices?.[0]?.message?.content);
}
```

`tool_choice` accepts `'auto' | 'none' | 'required' | { type: 'function', function: { name } }`. Presence of `tools` causes the gateway to prefer tool-capable models in the failover chain.

## Structured output (JSON mode)

Two flavours. **`json_object`** asks the model to emit valid JSON; **`json_schema`** asks the gateway to validate against a schema and retry across the failover chain when the model produces non-conforming output.

```ts
// Loose JSON mode
const loose = await client.chat.completions.create({
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: 'Parse this job posting: …' }],
});
const data = JSON.parse(loose.choices?.[0]?.message?.content ?? '{}');

// Strict schema mode (gateway-side conformance retry)
const strict = await client.chat.completions.create({
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'SalaryEstimate',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          low:        { type: 'number' },
          median:     { type: 'number' },
          high:       { type: 'number' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['low', 'median', 'high', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  messages: [{ role: 'user', content: 'Estimate Senior SRE salary in NYC.' }],
});
const retries = strict._builderforce?.schemaRetries ?? 0;
```

## Vision — image + text in one message

```ts
const desc = await client.chat.completions.create({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: "What's in this image?" },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg', detail: 'high' } },
      ],
    },
  ],
});
```

`content` can be a plain `string` (most cases), an `Array<TextContentPart | ImageUrlContentPart>` for vision, or `null` on assistant turns that only carry `tool_calls`.

## Embeddings

```ts
const res = await client.embeddings.create({
  input: ['First sentence.', 'Second sentence.'],
});

for (const obj of res.data) {
  console.log(obj.index, obj.embedding.length);
}
```

> **Note (v0.3.0):** the `/llm/v1/embeddings` route currently 503s with `code: 'embeddings_not_wired'` — vendor wiring is in flight. The SDK shape is final.

## Per-call options

Override defaults for individual calls:

```ts
// Tight timeout for fast use cases
await client.chat.completions.create({
  timeoutMs: 5_000,
  messages: [...],
});

// Long-form analysis
await client.chat.completions.create({
  timeoutMs: 90_000,
  messages: [...],
});

// User-cancellable streaming
const ctl = new AbortController();
cancelButton.addEventListener('click', () => ctl.abort());
const stream = await client.chat.completions.create({
  stream: true,
  signal: ctl.signal,
  messages: [...],
});

// Idempotent retries (gateway-side dedupe within TTL — coming soon)
await client.chat.completions.create({
  idempotencyKey: 'tool-run-42',
  messages: [...],
});
```

| Option | Meaning |
|---|---|
| `timeoutMs` | Override client-level timeout for this call. Combined with `signal` (below) — whichever fires first wins. |
| `signal` | Caller's `AbortSignal` for user-cancellable generation. |
| `idempotencyKey` | Sent as `Idempotency-Key` header. Gateway dedupes within TTL (planned). |

## Metadata for billing trace-back

Attach `{ toolRunId, sessionId, userId, ... }` to any call — the gateway persists it on the same row as token counts in `llm_usage_log.metadata`, so you can join `tool_runs` ↔ `llm_usage_log` directly without round-tripping `requestId`.

```ts
await client.chat.completions.create({
  metadata: {
    toolRunId: 'tr_abc',
    sessionId: 'sess_xyz',
    userId: 'user_42',
    feature: 'cold-outreach-v3',
  },
  messages: [...],
});
```

`metadata` is gateway-side only — never forwarded to upstream vendors.

## Errors

```ts
import { BuilderforceApiError } from '@seanhogg/builderforce-sdk';

try {
  await client.chat.completions.create({ ... });
} catch (error) {
  if (error instanceof BuilderforceApiError) {
    console.error(error.status, error.code, error.requestId, error.message);
  }
}
```

| `status` | `code` | When |
|---|---|---|
| 408 | `timeout` | SDK-side timeout fired |
| 499 | `aborted` | Caller's `AbortSignal` aborted |
| 429 | `plan_token_limit_exceeded` | Tenant hit daily plan budget |
| 429 | `claw_token_limit_exceeded` | Per-claw daily cap exceeded (clk_* keys only) |
| 503 | `embeddings_not_wired` | Embeddings vendor wiring not yet shipped |
| 401 | `missing_api_key` | Auth issues |

`error.requestId` comes from the gateway's `x-request-id` header — quote it in support tickets.

## Models and usage

```ts
const models = await client.models.list();
const usage  = await client.usage.get({ days: 30 });
```

`usage` returns aggregate spend by model, day, and user; plus `mine` (the calling user's slice) and `totals`. Pass `?detail=true&page=1&limit=100` for row-level pagination — every recorded call with its `useCase`, `metadata`, `idempotencyKey`, and token counts. Use this to reconcile your own usage table against the gateway's ledger.

## Routing — caller picks the model, gateway forwards

The gateway is a transport. It does **not** make policy decisions about which model to use. Two modes:

**1. Caller-pinned (`model` set).** The gateway forwards verbatim — no substitution, no auto-failover, no silent retry. On vendor error you get the upstream status + body in a `BuilderforceApiError` so your code can decide whether to advance your own fallback chain.

```ts
// Route to a specific vendor + model
client.chat.completions.create({
  model: 'openrouter/anthropic/claude-3-haiku',
  messages: [...],
});

client.chat.completions.create({
  model: 'cerebras/llama3.1-8b',
  messages: [...],
});

client.chat.completions.create({
  model: 'ollama/gpt-oss:120b',
  messages: [...],
});
```

Vendor prefixes (`openrouter/`, `cerebras/`, `ollama/`) explicitly route to that vendor. Bare ids fall back to a catalog lookup.

**2. Pool mode (`model` unset).** The gateway picks from the tenant-plan model pool with shape-based reordering — `tools` present → tool-capable models try first, `response_format: 'json_schema'` → structured-output models, image content blocks → vision models. This is for callers who don't run their own model policy.

## `useCase` — opaque telemetry slug

Pass any string. The gateway never reads it for routing; it's persisted to `llm_usage_log.use_case` and echoed back in `_builderforce.useCase` for confirmation. Useful for per-feature spend dashboards and reconciliation.

```ts
client.chat.completions.create({
  useCase: 'studio_storyboard',  // your taxonomy, free-form
  metadata: { featureKey: 'storyboard_generate', toolRunId },
  messages: [...],
});

// Response carries the echo:
// { ..., _builderforce: { useCase: 'studio_storyboard', metadata: {...}, requestId: 'req_...' } }
```

## License

MIT — see [LICENSE](./LICENSE).
