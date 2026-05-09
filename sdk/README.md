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

`usage` returns aggregate spend by model, day, and user; plus `mine` (the calling user's slice) and `totals`.

## Design — why no `useCase` parameter?

Earlier drafts of this SDK exposed a `useCase: AIUseCase` enum that mapped to model-chain presets (e.g. `'salary_estimate'` → `STRUCTURED_CHAIN`). That coupled the SDK's public surface to specific tenant taxonomies (`recruiter_outreach`, `pitch_deck.generate`) and made the gateway's routing logic depend on caller-supplied labels.

v0.3.0 inverts that. **Routing is request-shape-driven** on the gateway side:

| Request feature | Gateway prefers |
|---|---|
| `tools` set | Tool-capable models |
| `response_format: 'json_schema'` | Structured-output capable models with conformance retry |
| Image content blocks | Vision models |
| Long context (heuristic on token count) | Long-context chain |
| (otherwise) | Plan-tier default chain |

Tenants describe **what they're sending** (shape), not **what they're trying to do** (intent). For tenant-side analytics on intent, attach a `metadata.feature` string instead — it's persisted alongside usage rows but doesn't affect routing.

## License

MIT — see [LICENSE](./LICENSE).
