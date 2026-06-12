# Scenarios — typical request shapes

Reference catalog showing how callers shape requests for common scenarios. The gateway routes primarily by request **shape** (presence of `tools`, `response_format`, image content blocks, plan tier) and the optional `model` hint. Use these as starter shapes, then customize `temperature` / `max_tokens` / `model` / `metadata` as needed.

Two complementary attribution fields:

- **`useCase`** — opaque telemetry slug, free-form. Persisted to `llm_usage_log.use_case`, echoed back in `_builderforce.useCase`. Use for per-feature spend dashboards.
- **`metadata`** — free-form key/value pairs for richer trace-back (`{ accountId, userId, sessionId, runner, ... }`). Persisted to `llm_usage_log.metadata` JSONB, echoed back in `_builderforce.metadata`.
- **`traceId`** — returned on every response (`_builderforce.traceId`) and on failures (`error.details.correlationId`). Hand it to Builderforce support for a full server-side diagnostic of the call. See [Diagnosing a failed call](#diagnosing-a-failed-call-trace-ids).

Neither affects routing. The examples below show both in context.

---

## Conversation

### Open-ended chat

```ts
client.chat.completions.create({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain transformers in one paragraph.' },
  ],
  metadata: { feature: 'general-chat' },
});
```

### Coaching response (longer, warmer)

```ts
client.chat.completions.create({
  temperature: 0.7,
  max_tokens: 1500,
  messages: [
    { role: 'system', content: 'You are a career coach. Be specific and warm.' },
    { role: 'user', content: 'I got passed over for the lead role. What now?' },
  ],
  metadata: { feature: 'career-coach' },
});
```

---

## Classification (sub-200ms TTFT)

For tight latency budgets — short input, short output, low temperature.

```ts
client.chat.completions.create({
  temperature: 0,
  max_tokens: 50,
  timeoutMs: 3_000,
  messages: [
    { role: 'system', content: 'Classify this email. Output one word: lead | support | vendor | other.' },
    { role: 'user', content: emailBody },
  ],
  metadata: { feature: 'email-classify' },
});
```

---

## Strict structured output

Use `json_schema` with `strict: true` for vendor-side conformance retry.

### Salary estimate

```ts
client.chat.completions.create({
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
  messages: [{ role: 'user', content: `Estimate Senior SRE in NYC. Inputs: ${ctx}` }],
  metadata: { feature: 'salary-estimate' },
});
```

### Job posting parser

```ts
client.chat.completions.create({
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'JobPosting',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          title:    { type: 'string' },
          company:  { type: 'string' },
          location: { type: 'string' },
          remote:   { type: 'boolean' },
          skills:   { type: 'array', items: { type: 'string' } },
          salary:   { type: ['object', 'null'], properties: { min: { type: 'number' }, max: { type: 'number' } } },
        },
        required: ['title', 'company'],
      },
    },
  },
  messages: [{ role: 'user', content: postingText }],
  metadata: { feature: 'job-parser' },
});
```

### Skill extraction from a resume

```ts
client.chat.completions.create({
  response_format: { type: 'json_schema', json_schema: skillsSchema },
  messages: [{ role: 'user', content: resumeText }],
  metadata: { feature: 'skill-extract' },
});
```

---

## Long-form creative

Bigger `max_tokens`, slightly higher `temperature`.

### Article writer

```ts
client.chat.completions.create({
  temperature: 0.85,
  max_tokens: 4096,
  timeoutMs: 90_000,
  messages: [
    { role: 'system', content: 'Write in a confident, plain-English style.' },
    { role: 'user', content: 'Draft a 1200-word article on Mamba vs Transformer trade-offs.' },
  ],
  metadata: { feature: 'article-writer' },
});
```

### Recruiter outreach

```ts
client.chat.completions.create({
  temperature: 0.7,
  max_tokens: 1500,
  messages: [
    { role: 'system', content: 'Write a personalised cold-outreach LinkedIn message. <300 words.' },
    { role: 'user', content: `Candidate: ${profile}\nJob: ${role}` },
  ],
  metadata: { feature: 'recruiter-outreach' },
});
```

### Studio script

```ts
client.chat.completions.create({
  temperature: 0.8,
  max_tokens: 4096,
  timeoutMs: 60_000,
  messages: [{ role: 'user', content: 'Write a 3-act story outline for a 5-minute YouTube short.' }],
  metadata: { feature: 'studio-script' },
});
```

---

## Long-context analysis

Big input, structured output. The gateway prefers a long-context model when input tokens are high.

### Contract analysis

```ts
client.chat.completions.create({
  max_tokens: 2048,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: 'Extract risk clauses, payment terms, and termination conditions as JSON.' },
    { role: 'user', content: contractFullText },
  ],
  metadata: { feature: 'contract-analyze' },
});
```

### Reviews summarization

```ts
client.chat.completions.create({
  max_tokens: 1024,
  messages: [{ role: 'user', content: `Summarize themes in these 200 reviews:\n${reviewsText}` }],
  metadata: { feature: 'reviews-summary' },
});
```

---

## Tool calling — agentic orchestration

When you need the model to call functions you provide.

### Auto-apply orchestrator

```ts
const tools = [
  { type: 'function', function: { name: 'fill_field',     parameters: fillFieldSchema } },
  { type: 'function', function: { name: 'submit_form',    parameters: submitFormSchema } },
  { type: 'function', function: { name: 'capture_screenshot', parameters: screenshotSchema } },
];

const messages = [
  { role: 'system', content: 'Apply to this job. Use tools to fill the form, screenshot, and submit.' },
  { role: 'user',   content: jobUrl },
];

while (true) {
  const turn = await client.chat.completions.create({
    tools,
    tool_choice: 'auto',
    messages,
    metadata: { feature: 'auto-apply', toolRunId },
  });
  const msg = turn.choices?.[0]?.message;
  if (!msg?.tool_calls?.length) { messages.push(msg!); break; }

  messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
  for (const call of msg.tool_calls) {
    const result = await runTool(call.function.name, JSON.parse(call.function.arguments));
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  }
}
```

### Customer-support agent with `get_order` / `refund` tools

```ts
client.chat.completions.create({
  tools: supportTools,
  tool_choice: 'auto',
  messages: [
    { role: 'system', content: 'Help the customer. Call get_order before any refund.' },
    { role: 'user', content: complaint },
  ],
  metadata: { feature: 'support-agent', sessionId },
});
```

---

## Vision

```ts
client.chat.completions.create({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this in three bullet points.' },
        { type: 'image_url', image_url: { url: imgUrl, detail: 'high' } },
      ],
    },
  ],
  metadata: { feature: 'image-describe' },
});
```

### OCR receipt extraction

```ts
client.chat.completions.create({
  response_format: { type: 'json_schema', json_schema: receiptSchema },
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract merchant, date, line items, total.' },
        { type: 'image_url', image_url: { url: receiptUrl, detail: 'high' } },
      ],
    },
  ],
  metadata: { feature: 'ocr-receipt' },
});
```

---

## Embeddings

Wired to OpenRouter; default model `nvidia/llama-nemotron-embed-vl-1b-v2:free`. Override via `model`.

```ts
client.embeddings.create({
  input: docs.map((d) => d.text),
  // model: 'openai/text-embedding-3-small',  // optional override
  metadata: { feature: 'doc-index', batchId },
});
```

---

## User-cancellable streaming

Pair `stream: true` with an `AbortController` your UI controls.

```ts
const ctl = new AbortController();
cancelButton.onclick = () => ctl.abort();

const stream = await client.chat.completions.create({
  stream: true,
  signal: ctl.signal,
  messages: [...],
  metadata: { feature: 'studio-storyboard' },
});

for await (const chunk of stream) {
  // render chunk.choices?.[0]?.delta?.content
}
```

---

## Strict model pinning (eval / reproducibility)

By default the gateway treats `model` as a hint and may substitute on cooldown / vendor failure (the actual model is echoed back as `_builderforce.resolvedModel`). When you need *strict* pinning (e.g. running an evaluation against one specific model), set **`strict: true`** on the request — or pass **`?strict=true`** as a query param. The gateway then dispatches **only** the named model: **no cascade, no failover, no paid backstop substitution.** If that model is on cooldown or its vendor key isn't configured, the call returns **`503 model_unavailable`** instead of silently swapping to another model.

```ts
// Reproducible eval run — pin one model, reject (503) rather than substitute.
const baseline = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4.6',
  strict: true,
  messages: evalPrompt,
  metadata: { feature: 'model-eval', runId },
});
// `baseline._builderforce.resolvedModel` is guaranteed === the requested model.
```

On an unavailable model the error envelope carries the reason so you can branch:

```ts
try {
  await client.chat.completions.create({ model, strict: true, messages });
} catch (err) {
  if (err instanceof BuilderforceApiError && err.code === 'model_unavailable') {
    // err.details.reason ∈ { 'cooldown' | 'vendor_key_unconfigured' }
    // The pinned model is temporarily unavailable — retry later or pick another.
  }
  throw err;
}
```

**Entitlement:** strict pinning requires a paid plan (Pro/Teams) or a superadmin-issued daily-limit override — a free tenant gets `403 strict_pin_not_allowed`, since one misbehaving pinned model could drain a free daily budget on retries. The gateway-internal `modelStrict` flag (set by cloud coding agents) is the same mechanism; `strict` is the public alias.

## Idempotent cron jobs

For scheduled enrichment / batch jobs that retry, set an `Idempotency-Key`. The gateway tracks `(tenant_id, key)` for **10 minutes** and refuses to re-dispatch — a retry within the window returns `409 idempotent_replay` instead of 200, so cron retries can't double-charge.

```ts
try {
  const res = await client.chat.completions.create({
    idempotencyKey: `nightly-summary:${date}:${tenantId}`,
    messages: [...],
    metadata: { feature: 'nightly-summary', cronJobId: '#15' },
  });
  return res;
} catch (err) {
  if (err instanceof BuilderforceApiError && err.code === 'idempotent_replay') {
    // The first attempt already ran. Treat this retry as a no-op.
    // err.details.previousRequest carries { id, createdAt } if you need to find it.
    return null;
  }
  throw err;
}
```

Today the gateway returns 409 on replay but does **not** cache and replay the original response body — true response-cache replay requires a Cloudflare KV namespace and is logged as a follow-up in the project Gap Register.

---

## Diagnosing a failed call (trace IDs)

Every call is recorded server-side with the full picture — who called, how long it ran, every model the cascade attempted, every upstream exception, the candidate chain, and the request/response bodies. The SDK only receives a short **trace ID** (`llm-…`); the detail stays builder-side and is pulled up by support / superadmin from that ID. Capture it on both paths so any user-reported failure becomes a one-step lookup.

```ts
async function tracedCall(params: ChatCompletionCreateParams) {
  try {
    const res = await client.chat.completions.create(params);
    // Stash on success too — useful when the *output* was wrong, not the call.
    logger.info('ai_ok', {
      traceId: res._builderforce?.traceId,
      model:   res._builderforce?.resolvedModel,
    });
    return res;
  } catch (err) {
    if (err instanceof BuilderforceApiError) {
      // Same value carried as `correlationId` inside the error envelope.
      const d = err.details as { correlationId?: string; traceId?: string } | undefined;
      const traceId = d?.correlationId ?? d?.traceId;
      logger.error('ai_call_failed', { code: err.code, status: err.status, traceId });
      // Show it to the user so they can quote it in a support ticket:
      throw new Error(`AI is temporarily unavailable. Reference: ${traceId ?? 'n/a'}`);
    }
    throw err;
  }
}
```

For lighter, no-support-needed triage, the inline failover breakdown carries per-attempt timing + a coarse class — no trace lookup required:

```ts
for (const f of res._builderforce?.failovers ?? []) {
  metrics.timing(`llm.attempt.${f.vendor}`, f.durationMs ?? 0, { kind: f.kind, code: f.code });
  // e.g.  openrouter/qwen3-coder:free  429  rate_limit  1034ms
}
```

`f.kind` is one of `rate_limit | timeout | auth | server_error | client_error | network | skipped`. The **raw per-attempt error text is not in `failovers`** (it can contain raw provider payloads) — it lives only on the server-side trace. Quote the trace ID to see it.

---

## Picking timeouts

Latency varies by scenario. Use per-call `timeoutMs` rather than one client-level worst-case:

| Scenario shape | Suggested `timeoutMs` |
|---|---|
| Classification / autofill | 3 000 – 5 000 |
| Short structured extract | 10 000 |
| Long-form creative / structured | 60 000 |
| 360° analysis (deep, multi-pass) | 90 000 |
| Tool-calling agent loops | per-turn cap × max iterations |

The SDK timeout aborts the underlying fetch. Caller `signal` and SDK `timeoutMs` compose — whichever fires first wins.
