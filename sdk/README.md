# @seanhogg/builderforce-sdk

Typed TypeScript SDK for the [Builderforce.ai](https://builderforce.ai) LLM gateway. OpenAI-compatible chat completions with tool calling and structured output, embeddings, image generation (Together → FluxAPI cascade), model registry, and usage analytics — all behind a single tenant API key. Vendor failover (OpenRouter / Cerebras / Ollama / Claude / GPT / Gemini / Grok / Flux) is handled server-side so your code only knows about Builderforce. Every call returns a **trace ID** for one-step server-side diagnostics — see [Diagnostics — trace IDs](#diagnostics--trace-ids).

- **Vanilla `fetch` / `AbortController` / `ReadableStream` / `TextDecoder`** — runs on Node 18+, Cloudflare Workers, browsers, edge runtimes.
- **Zero runtime dependencies.** ~34 kB compressed, ~154 kB unpacked.
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

### Avoiding `schema_too_complex` — `deriveResponseFormat`

A strict `json_schema` gives the best conformance, but some vendors' constrained-decoding engines reject a schema that's too complex (Gemini's *"too many states for serving"*). When **every** candidate model rejects it, the gateway returns a terminal `422 schema_too_complex` (see [Errors](#errors)) rather than burning the whole cascade and mislabelling it `429`. The cleaner fix is to not send a strict schema a vendor can't honour — `deriveResponseFormat` is the pre-flight guard: it emits strict `json_schema` when the schema is within a complexity ceiling, and falls back to loose `json_object` when it isn't.

```ts
import { deriveResponseFormat } from '@seanhogg/builderforce-sdk';

// `schema` is a plain JSON-Schema object. Using Zod? Convert first:
//   import { zodToJsonSchema } from 'zod-to-json-schema';
//   const schema = zodToJsonSchema(MyZodSchema);
const response_format = deriveResponseFormat(schema, { name: 'JobExtract' });
// → { type: 'json_schema', json_schema: { name, schema, strict: true } }  when simple enough
// → { type: 'json_object' }                                                when too complex

const res = await client.chat.completions.create({ response_format, messages });
```

Routing is gateway-owned, so omit `vendor` and the conservative cross-vendor ceiling applies (the schema is accepted whichever vendor serves it). Pass `{ vendor: 'googleai' }` to check against that vendor's specific ceiling when you've pinned a `model`, or `{ maxComplexity }` to override. `canUseStrictSchema(schema, opts)` and `estimateSchemaComplexity(schema)` are exported too if you want to branch or log the downgrade yourself.

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

## Image generation

```ts
const res = await client.images.generate({
  prompt: 'A studio photo of a corgi astronaut, soft rim light',
  size:   '1024x1024',
  n:      1,
});

for (const img of res.data) {
  console.log(img.url);          // hosted URL (default)
  // img.b64_json                 // when `response_format: 'b64_json'`
  // img.revised_prompt           // vendor-side prompt rewrite, if any
}

console.log(res._builderforce?.resolvedModel);  // which model actually served
console.log(res._builderforce?.resolvedVendor); // 'together' | 'fluxapi' | …
```

OpenAI-compatible surface — same `prompt` / `size` / `n` / `response_format: 'url' | 'b64_json'` shape. Behind the scenes the gateway cascades free Together vendors → premium FluxAPI fallback, so a saturated free pool falls through instead of returning a 429. Vendor-prefix the `model` (`together/<id>`, `fluxapi/flux-kontext-pro`) to pin; bare ids resolve via catalog lookup. Same `useCase` / `metadata` / `idempotencyKey` / `timeoutMs` / `signal` options as chat, with the same billing trace-back semantics.

Each generated image is billed against the tenant's daily token budget at a flat ~1000-token rate, so `plan_token_limit_exceeded` 429s + the `Don't retry terminal errors` pattern below apply identically to images.

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
    // `vendor` + `model` identify the upstream the gateway dispatched against
    // — set on every error where an upstream was selected (single-attempt
    // 429s, timeouts, `model_unavailable`, …). Unset only for pre-dispatch
    // errors (auth failures, validation, tenant-cap 429s) — distinguish by
    // checking presence of `error.vendor`, not by parsing model-id prefixes.
    if (error.vendor) {
      console.error(`upstream: ${error.vendor}/${error.model}`);
    }
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
| 422 | `schema_too_complex` | Every candidate model rejected `response_format.json_schema` as too complex for its constrained-decoding engine. **`error.terminal === true`** — a different model won't help; simplify the schema or use `json_object` (see [`deriveResponseFormat`](#avoiding-schema_too_complex--deriveresponseformat)). |
| 403 | `origin_not_authorized` | Browser request from an origin not in the key's allowlist (or key has no allowlist — server-only) |
| 403 | `strict_pin_not_allowed` | `modelStrict: true` requested on a free tenant without a superadmin daily-limit override — upgrade or drop `modelStrict`. |
| 503 | `model_unavailable` | `modelStrict: true` and the requested model is on cooldown / unconfigured. `error.details = { requestedModel, reason }`. |
| 503 | (no code) | Vendor key not configured for the active plan tier |
| 401 | `missing_api_key` | Auth issues |
| 403 | (varied) | Wrong scope / wrong tenant for the URL |

`error.requestId` comes from the gateway's `x-request-id` header — quote it in support tickets. For a **full server-side diagnostic** of a failed call (every model attempt, every upstream exception, the candidate chain, timings), quote the **trace ID** instead — see [Diagnostics — trace IDs](#diagnostics--trace-ids) below. Map gateway 429s to your own 503 + alerting (it's an ops issue, not a user issue).

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

## Diagnostics — trace IDs

Every call through the gateway is recorded server-side with a full diagnostic trace: who made it, how long it ran, every model the cascade attempted, every upstream exception, status codes, and the request/response bodies. **That detail never crosses the wire** — the SDK only ever receives a short **trace ID** (`llm-…`). Hand that ID to Builderforce support (or paste it into the superadmin console) to pull up the complete picture of what happened.

The trace ID surfaces in three places, so you can capture it on both the success and failure paths:

```ts
// 1. Success path — on the response envelope:
const res = await client.chat.completions.create({ messages: [...] });
console.log(res._builderforce?.traceId);   // 'llm-7a1c2422-4e06-4d62-bc90-1c4171e53acc'

// 2. Failure path — on the error's details (also surfaced as `correlationId`):
try {
  await client.chat.completions.create({ messages: [...] });
} catch (err) {
  if (err instanceof BuilderforceApiError) {
    const details = err.details as { correlationId?: string; traceId?: string } | undefined;
    const traceId = details?.correlationId ?? details?.traceId;
    console.error(`AI call failed — trace ${traceId}`);  // log it, show it to the user, page on-call
  }
}

// 3. Response header (works even when you only have the raw Response, e.g. streaming):
//    x-builderforce-trace-id: llm-7a1c2422-…
```

`error.details.correlationId` and `_builderforce.traceId` are the **same value** — `correlationId` is just the name it carries inside the OpenAI-style error envelope. Capturing it on every failed call (in your logs, your error tracker, or the message you show the user) means a customer report becomes a one-step lookup instead of a guessing game.

### Coarser per-attempt timing (no support round-trip needed)

For lighter triage you don't need to quote the trace ID at all — the failover breakdown the gateway returns inline now carries per-attempt **timing** and a coarse **failure class**:

```ts
for (const f of res._builderforce?.failovers ?? []) {
  console.log(f.vendor, f.model, f.code, f.kind, f.reason, f.upstreamStatus, `${f.durationMs}ms`);
  // e.g.  openrouter  qwen/qwen3-coder:free  429  rate_limit  -  -  1034ms
  // e.g.  googleai    gemini-2.5-flash       422  schema      schema_too_complex  400  210ms
}
```

| Field | Meaning |
|---|---|
| `durationMs` | Wall-clock time the gateway spent on that attempt. A `25000`-ish value with `kind: 'timeout'` means the vendor hung. |
| `kind` | `'rate_limit' \| 'timeout' \| 'auth' \| 'server_error' \| 'client_error' \| 'schema' \| 'content_filter' \| 'network' \| 'skipped'`. Roll these up to spot single-vendor saturation vs a broad outage. Open union — newer gateways may add classes. |
| `reason` | Stable machine-readable cause slug when one applies (e.g. `'schema_too_complex'`). **Branch on this, not on the message string.** |
| `upstreamStatus` | The REAL upstream HTTP status before the gateway normalized it into `code` — e.g. a Gemini schema 400 surfaces as `code: 422` with `upstreamStatus: 400`. |

The **full upstream error text** for each attempt is deliberately *not* included in `failovers` — it can contain raw provider payloads. It's recorded against the trace and is only visible server-side; quote the trace ID to see it.

### `classifyError` — one authoritative classifier

Rather than each consumer hand-rolling a `429/408/401/5xx → kind` switch (which drifts), the SDK ships a first-party classifier keyed off the gateway's **own** failure taxonomy (`error.code` + `error.terminal` + the failover breakdown):

```ts
import { classifyError } from '@seanhogg/builderforce-sdk';

try {
  return await client.chat.completions.create({ model: attempt.model, messages });
} catch (err) {
  const c = classifyError(err);          // works on ANY caught value (incl. network / AbortError)
  if (c.terminal) throw err;             // schema_too_complex, token_cap, auth, invalid_request → stop the chain
  if (c.retryable) {                     // rate_limit, timeout, service_unavailable, network → safe to retry
    if (c.retryAfter) await sleep(c.retryAfter * 1000);
    continue;                            // try the next model in your profile
  }
  throw err;
}
```

`classifyError(err)` returns `{ kind, terminal, retryable, retryAfter?, status?, code?, message }`. `kind` is one of `rate_limit | token_cap | schema_too_complex | invalid_request | auth | model_unavailable | timeout | service_unavailable | content_filter | network | aborted | unknown`. It subsumes the *Don't retry terminal errors* pattern above — `terminal` already folds in token-cap exhaustion, schema rejections, auth, and malformed requests.

## Billing & retry semantics

So you can reconcile your own tenant-key spend against a user-side ledger without ambiguity:

- **You are billed for the *winning* attempt only.** A successful response's `usage` (and the metered `llm_usage_log` row) reflects the tokens of the single model that actually returned the answer — **not** the sum of the cascade. The model is `_builderforce.resolvedModel`.
- **Failed-but-retried upstream attempts are *not* billed.** Every model the gateway tried and that failed over (each entry in `_builderforce.failovers`) cost you nothing — a 429/timeout/`schema` attempt produces no usage row. `retries` / `failovers.length` are diagnostic, not billable.
- **No hidden gateway-internal retry tokens.** `json_schema` conformance retries (`_builderforce.schemaRetries`) move to a *different* model on the chain; you're still billed only for the one whose output was accepted, not for each rejected draft.
- **Reliability-floor / overflow calls are flagged.** When a saturated pool falls through to a model Builderforce funds on its own keys, the row is marked `paid_overflow` (and counts against your daily overflow cap) — it's still one winning attempt, just metered against a different budget line. A call served by a tenant-connected Claude subscription is **not** metered as overflow ($0 to us).
- **Streaming:** the usage row is written from the final SSE chunk's `usage` once the stream completes; same "winning attempt only" rule.

Reconcile with `client.usage.get({ days, detail: true })` (row-level) — each row carries `useCase`, `metadata`, `idempotencyKey`, the resolved model, and token counts, so a join against your own table is exact.

## Models and usage

```ts
const models = await client.models.list();
const usage  = await client.usage.get({ days: 30 });
```

`usage` returns aggregate spend by model, day, and user; plus `mine` (the calling user's slice) and `totals`. Pass `?detail=true&page=1&limit=100` for row-level pagination — every recorded call with its `useCase`, `metadata`, `idempotencyKey`, and token counts. Use this to reconcile your own usage table against the gateway's ledger.

### Capability discovery — which models read images / PDFs

Each entry in `models.list().data` carries a `capabilities` array — `vision` (accepts `image_url` content blocks; reads images and page-rasterized PDFs), `ocr` (tuned for text extraction), `tools` (tool-calling), and `structured_output` (`json_schema`). Convenience helpers filter the pool so you never hard-code model ids:

```ts
// Models that can read images and PDFs (vision OR ocr) — the set to pick from
// when a user uploads a screenshot, scan, or document.
const imageModels = await client.models.listImageCapable();
//  → [{ model: 'google/gemini-2.5-pro', capabilities: ['tools','structured_output','vision'], available: true, ... }, ...]

const ocrModels    = await client.models.listOcr();      // ocr capability only
const visionModels = await client.models.listVision();   // vision capability only
const toolModels   = await client.models.listByCapability('tools');

// Send an image to the first available image-capable model:
const res = await client.chat.completions.create({
  model: imageModels[0]?.model,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Extract the invoice total from this image.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
    ],
  }],
  useCase: 'invoice_ocr', // a useCase containing "ocr" also nudges the gateway's own routing toward OCR models
});
```

All capability helpers return only currently-servable models by default (`available: true`); pass `{ includeUnavailable: true }` to include cooled / key-unbound ones. They return `[]` when the gateway is unconfigured for the tenant (nothing servable). You don't strictly need to pre-select — when `model` is unset, the gateway already promotes vision/ocr models to the front of the chain for requests that carry image content (or an `ocr` `useCase`) — but listing them lets you show the user a picker or pin a specific one.

## Routing — `model` is a hint, gateway has final say

The gateway owns model selection. When you pass a `model`, the gateway treats it as a **hint** — it puts that id at the head of its candidate chain so it's tried first, but it retains the right to substitute on cooldown, vendor outage, or plan-tier mismatch. **Always read `_builderforce.resolvedModel` if you need to know what actually ran.** Pair it with `_builderforce.resolvedVendor` (the upstream that owns the resolved model — `'openrouter'`, `'cerebras'`, `'nvidia'`, `'ollama'`, `'googleai'`, …) for per-vendor cost / latency aggregation without parsing the model-id prefix.

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

If you need *strict* control (no substitution under any condition) — e.g. for evaluations or reproducibility — pass `modelStrict: true` alongside `model`. The gateway runs on that model exactly and returns `503 model_unavailable` (with `details: { requestedModel, reason }`) instead of falling through to another model on cooldown / outage / plan-tier mismatch.

```ts
const res = await client.chat.completions.create({
  model: 'openrouter/anthropic/claude-3-haiku',
  modelStrict: true,
  messages: [...],
});
```

**Entitlement:** strict-pin is paid-plan only (Pro / Teams) — or a free tenant with a superadmin-issued daily-limit override. Free-tier requests with `modelStrict: true` get `403 strict_pin_not_allowed` so a single misbehaving model can't drain the daily budget. For a client-side equivalent that works on every plan, see the [strict-pin pattern in SCENARIOS.md](./docs/SCENARIOS.md#strict-model-pinning-eval--reproducibility).

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
// { ..., _builderforce: { traceId: 'llm-...', useCase: 'studio_storyboard', metadata: {...}, requestId: 'req_...' } }
```

## License

MIT — see [LICENSE](./LICENSE).
