# @seanhogg/builderforce-sdk

Typed TypeScript SDK for the [Builderforce.ai](https://builderforce.ai) LLM gateway. OpenAI-compatible chat completions with tool calling and structured output, embeddings, model registry, and usage analytics — all behind a single tenant API key. Vendor failover (OpenRouter / Cerebras / Ollama / Claude / GPT / Gemini / Grok) is handled server-side so your code only knows about Builderforce.

- **Vanilla `fetch` / `AbortController` / `ReadableStream` / `TextDecoder`** — runs on Node 18+, Cloudflare Workers, browsers, edge runtimes.
- **Zero runtime dependencies.** ~23 kB compressed, ~102 kB unpacked.
- **Dual ESM + CJS + `.d.ts`** out of the box.

## Install

```bash
npm install @seanhogg/builderforce-sdk
```

## Quick start

```ts
import { BuilderforceClient } from '@seanhogg/builderforce-sdk';

const client = new BuilderforceClient({
  apiKey:  process.env.BUILDERFORCE_API_KEY!,
  baseUrl: process.env.BUILDERFORCE_BASE_URL ?? 'https://api.builderforce.ai',
  // Optional:
  // timeoutMs: 60_000,
});

const res = await client.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarize this PRD in three bullets.' }],
});

console.log(res.choices?.[0]?.message?.content);
```

**Env-var convention:**

| Var | Required | Value |
|---|---|---|
| `BUILDERFORCE_API_KEY` | yes | Your `bfk_*` / `clk_*` / tenant-JWT (mint at `/settings/api-keys`) |
| `BUILDERFORCE_BASE_URL` | no | `https://api.builderforce.ai` (production). Override for staging or self-hosted gateways. |

When you don't pass a `model`, the gateway picks one from your plan's pool and reorders by **request shape** — presence of `tools`, `response_format`, image content blocks. When you do pass a `model`, the gateway treats it as a hint (it tries that model first, may substitute on cooldown / failure — read `_builderforce.resolvedModel` to detect substitution). See [docs/SCENARIOS.md](./docs/SCENARIOS.md) for typical request shapes per scenario.

## Auth

The SDK sends `Authorization: Bearer <apiKey>` automatically. The gateway accepts three credential types:

| Prefix | Issued by | Best for |
|---|---|---|
| `bfk_*` | `POST /api/tenants/:tenantId/api-keys` (owner-only) | Tenant apps (server-to-server). Long-lived, tenant-scoped, revocable, optional origin allowlist. |
| `clk_*` | `POST /api/claws` (CoderClaw registration) | Self-hosted CoderClaw instances; carries optional per-claw daily token cap. |
| Tenant JWT | `POST /api/auth/web/login` → `POST /api/auth/tenant-token` | Browser-side calls from a logged-in user. Short-lived. |

### Browser use & origin allowlist

By default, every `bfk_*` is a **server-only** key — any request that arrives with an `Origin` header (i.e. came from a browser) is rejected with `403`. This protects against the common failure mode of leaking a long-lived secret through devtools.

To use a key from a browser, register the allowed origins when minting it (in the portal at `/settings/api-keys`, or via the SDK):

| Allowlist | Browser behaviour |
|---|---|
| `null` (default) | Server-only. Browser requests rejected. |
| `['https://app.example.com']` | Browser calls allowed only from `https://app.example.com`. Exact match — no port/subdomain wildcards. |
| `['*']` | Any origin allowed. Escape hatch — equivalent to shipping a long-lived secret to the world. Don't. |

When you change a key's allowlist later, in-flight calls are unaffected; new calls take the new policy on the next request.

The SDK preflight headers (`Authorization`, `Idempotency-Key`, `Content-Type`) and exposed response headers (`x-builderforce-daily-tokens-*`, `x-request-id`) are all configured on the gateway's CORS policy — your origin only needs to be in your key's allowlist.

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

**Dotted tool names work transparently.** Names like `governance.snapshot` or `agile.kanban.list` are accepted by the SDK and the gateway sanitizes them on the way to vendors that reject dots (e.g. Anthropic's `^[a-zA-Z0-9_-]{1,64}$` rule), then restores them on the response. Your tool registry's namespacing is preserved end-to-end.

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

Wired to OpenRouter; default model `nvidia/llama-nemotron-embed-vl-1b-v2:free` (free-tier, competitive with `text-embedding-3-small` for English). Override via `model`.

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

// Idempotent retries — gateway returns 409 idempotent_replay if the same
// (tenant, key) pair was used in the last 10 min, so cron retries don't double-charge.
try {
  await client.chat.completions.create({
    idempotencyKey: `nightly-summary:${date}:${accountId}`,
    messages: [...],
  });
} catch (err) {
  if (err instanceof BuilderforceApiError && err.code === 'idempotent_replay') {
    return null; // first attempt already ran — no-op the retry
  }
  throw err;
}
```

| Option | Meaning |
|---|---|
| `timeoutMs` | Override client-level timeout for this call. Combined with `signal` (below) — whichever fires first wins. **This is the *whole-request* budget**; the gateway enforces a separate ~25s per-vendor-call timeout so a single slow vendor doesn't eat the whole budget. With the default 60s `timeoutMs`, the gateway can typically try 2 candidate models before the SDK aborts. |
| `signal` | Caller's `AbortSignal` for user-cancellable generation. |
| `idempotencyKey` | Sent as `Idempotency-Key` header. Gateway 409s on replay within 10 min so retries can no-op safely. (Response-body cache replay is planned.) |

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

## Pre-emptive throttling

Every successful chat-completion response carries the tenant's daily-budget snapshot — both as headers and inside `_builderforce.dailyTokens`. Read either to throttle before you hit the 429 gate.

```ts
const res = await client.chat.completions.create({ messages: [...] });
const { used, limit, remaining } = res._builderforce?.dailyTokens ?? {};
if (remaining != null && remaining < 50_000) {
  // Switch to cheaper models, queue background work, page on-call, etc.
}

// Same numbers are also on the response headers:
//   x-builderforce-daily-tokens-used
//   x-builderforce-daily-tokens-limit
//   x-builderforce-daily-tokens-remaining
```

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
| 409 | `idempotent_replay` | `Idempotency-Key` was used within the last 10 min — treat as no-op |
| 429 | `plan_token_limit_exceeded` | Tenant hit daily plan budget. **`error.terminal === true`** — don't retry on a different model. |
| 429 | `claw_token_limit_exceeded` | Per-claw daily cap exceeded (`clk_*` keys only). **`error.terminal === true`** — same caveat. |
| 403 | `origin_not_authorized` | Browser request from an origin not in the key's allowlist (or key has no allowlist — server-only) |
| 503 | (no code) | Vendor key not configured for the active plan tier |
| 401 | `missing_api_key` | Auth issues |
| 403 | (varied) | Wrong scope / wrong tenant for the URL |

`error.requestId` comes from the gateway's `x-request-id` header — quote it in support tickets. Map gateway 429s to your own 503 + alerting (it's an ops issue, not a user issue).

### Don't retry terminal errors

Some failures will not resolve by retrying on a different model — most notably daily token-cap exhaustion, which is per-tenant. The gateway sets `error.terminal === true` on those responses; well-behaved fallback chains should short-circuit:

```ts
async function callWithFallback(profile: Array<{ model: string; ... }>) {
  for (const attempt of profile) {
    try {
      return await client.chat.completions.create({ model: attempt.model, ... });
    } catch (err) {
      if (err instanceof BuilderforceApiError) {
        if (err.terminal) throw err;       // cap exhausted — different model won't help
        if (err.code === 'aborted') throw err;
        // else: retry on next model in profile
      }
    }
  }
}
```

`error.retryAfter` (seconds) accompanies cap-exhaustion errors so you can sleep precisely until the next UTC midnight reset rather than polling. The same value is on the `Retry-After` response header.

## Models and usage

```ts
const models = await client.models.list();
const usage  = await client.usage.get({ days: 30 });
```

`usage` returns aggregate spend by model, day, and user; plus `mine` (the calling user's slice) and `totals`. Pass `?detail=true&page=1&limit=100` for row-level pagination — every recorded call with its `useCase`, `metadata`, `idempotencyKey`, and token counts. Use this to reconcile your own usage table against the gateway's ledger.

## Routing — `model` is a hint, gateway has final say

The gateway owns model selection. When you pass a `model`, the gateway treats it as a **hint** — it puts that id at the head of its candidate chain so it's tried first, but it retains the right to substitute on cooldown, vendor outage, or plan-tier mismatch. **Always read `_builderforce.resolvedModel` if you need to know what actually ran.**

```ts
const res = await client.chat.completions.create({
  model: 'openrouter/anthropic/claude-3-haiku',
  messages: [...],
});

console.log(res._builderforce?.resolvedModel);
// → 'openrouter/anthropic/claude-3-haiku' on the happy path
// → some other model in the pool if Claude was on cooldown / failed
```

Vendor prefixes (`openrouter/`, `cerebras/`, `ollama/`) explicitly route to that vendor when that model is selected. Bare ids fall back to a catalog lookup.

When `model` is unset the gateway picks from the tenant-plan pool with shape-based reordering — `tools` present → tool-capable models try first, `response_format: 'json_schema'` → structured-output models, image content blocks → vision models. Useful for callers that don't run their own model policy.

If you need *strict* control (no substitution under any condition) — e.g. for evaluations or reproducibility — see the [strict-pin pattern in SCENARIOS.md](./docs/SCENARIOS.md#strict-model-pinning-eval--reproducibility). It's a thin client-side helper that throws when `_builderforce.resolvedModel` differs from the request. The gateway's job is availability; yours is policy.

## Multi-tenancy — one Builderforce key, many of *your* tenants

The gateway's auth model is **one `bfk_*` key per Builderforce tenant** (i.e. per app integrating with the gateway). If your app itself runs multi-tenant (you serve N customers under a single deployment), use a single `bfk_*` and identify your end-tenants via `metadata`:

```ts
client.chat.completions.create({
  metadata: {
    accountId: customer.accountId,   // your end-tenant
    userId:    activeUser.id,
    viewerId:  viewer?.id ?? '',
    runner:    'cron|user-action|scheduled',
  },
  messages: [...],
});
```

Each call's metadata persists to `llm_usage_log.metadata` JSONB — pageable via `GET /llm/v1/usage?detail=true&page=N`. You query rows by your own `accountId` to compute per-customer spend without provisioning per-customer keys.

**You do not need to mint per-end-tenant `bfk_*` keys.** The gateway bills your Builderforce tenant in aggregate; per-customer accounting lives in your usage queries.

If you need genuine isolation (separate token budgets per end-tenant, separate revocation), provision multiple `bfk_*` keys via `POST /api/tenants/:tenantId/api-keys` and route per-customer in your code. Most apps don't need this.

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
