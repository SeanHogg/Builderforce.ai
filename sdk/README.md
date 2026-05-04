# @builderforce/sdk

Typed SDK for Builderforce LLM gateway APIs.

## Install

```bash
npm install @builderforce/sdk
```

## Quick start

```ts
import { BuilderforceClient } from '@builderforce/sdk';

const client = new BuilderforceClient({
  apiKey: process.env.BUILDERFORCE_API_KEY!,
  // Optional:
  // baseUrl: 'https://api.builderforce.ai',
  // timeoutMs: 60_000,
});
```

## Non-streaming chat

```ts
const res = await client.chat.completions.create({
  useCase: 'ide.chat',
  stream: false,
  messages: [{ role: 'user', content: 'Summarize this PRD.' }],
});

console.log(res.choices?.[0]?.message?.content);
```

## Streaming chat

```ts
const stream = await client.chat.completions.create({
  useCase: 'coach.chat',
  stream: true,
  messages: [{ role: 'user', content: 'Give me a weekly plan.' }],
});

for await (const chunk of stream) {
  const delta = chunk.choices?.[0]?.delta?.content ?? '';
  process.stdout.write(delta);
}
```

Or collect all streaming text:

```ts
const text = await stream.toText();
```

## Models and usage

```ts
const models = await client.models.list();
const usage = await client.usage.get({ days: 30 });
```

## Errors

SDK requests throw `BuilderforceApiError` on non-2xx responses:

```ts
import { BuilderforceApiError } from '@builderforce/sdk';

try {
  await client.models.list();
} catch (error) {
  if (error instanceof BuilderforceApiError) {
    console.error(error.status, error.code, error.requestId, error.message);
  }
}
```

## Auth conventions

- Use `Authorization: Bearer <apiKey>` automatically.
- API keys can be `clk_*` or tenant-scoped JWTs issued by Builderforce.
- Workforce model routing is server-side: pass `model: 'builderforce/workforce-<agentId>'` when needed.

## Use-case safety

`AIUseCase` is exported for compile-time checks:

```ts
import type { AIUseCase } from '@builderforce/sdk';
```
