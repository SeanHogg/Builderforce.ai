# Scenarios — typical request shapes

Reference catalog showing how callers shape requests for common scenarios. The gateway routes primarily by request **shape** (presence of `tools`, `response_format`, image content blocks, plan tier) and the optional `model` hint. Use these as starter shapes, then customize `temperature` / `max_tokens` / `model` / `metadata` as needed.

Two complementary attribution fields:

- **`useCase`** — opaque telemetry slug, free-form. Persisted to `llm_usage_log.use_case`, echoed back in `_builderforce.useCase`. Use for per-feature spend dashboards.
- **`metadata`** — free-form key/value pairs for richer trace-back (`{ accountId, userId, sessionId, runner, ... }`). Persisted to `llm_usage_log.metadata` JSONB, echoed back in `_builderforce.metadata`.

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

The gateway treats `model` as a hint and may substitute on cooldown / vendor failure. When you need *strict* pinning (e.g. running an evaluation against one specific model), detect substitution and reject:

```ts
async function strictPin(params: ChatCompletionCreateParams) {
  const res = await client.chat.completions.create(params);
  if (params.model && res._builderforce?.resolvedModel !== params.model) {
    throw new Error(
      `Strict pin failed: requested ${params.model}, gateway resolved ${res._builderforce?.resolvedModel}`,
    );
  }
  return res;
}

// Use in eval runs where reproducibility trumps availability.
const baseline = await strictPin({
  model: 'openrouter/anthropic/claude-3-haiku',
  messages: evalPrompt,
});
```

This is a thin client-side gate. A gateway-side `strict: true` flag (on the request) would let the gateway 503 instead of substituting; logged as a follow-up in the project Gap Register.

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
