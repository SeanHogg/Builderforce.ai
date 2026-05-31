# @seanhogg/builderforce-brain-embedded

Embeddable AI assistant — **"Brain"** — for React. A headless, tool-capable
streaming chat core with an **MCP-style action registry**. The same core powers
[builderforce.ai](https://builderforce.ai) and external embeds; everything
app-specific (auth, persistence, system prompts) is **injected**, so the package
itself ships no app coupling.

```bash
npm install @seanhogg/builderforce-brain-embedded
```

Peer deps: `react >=18`, `react-dom >=18`.

## Quick start

Mount one `<BrainProvider config={...}>` high in your tree, wrap pages in the
action + context providers, then drive the conversation with the hooks.

```tsx
import {
  BrainProvider, BrainActionsProvider, BrainContextProvider,
  useBrainChats, useBrainConversation, useBrainActions,
  type BrainConfig,
} from '@seanhogg/builderforce-brain-embedded';

const config: BrainConfig = {
  transport: {
    baseUrl: 'https://api.builderforce.ai',
    // Return the current bearer token. For browser embeds this is a SHORT-LIVED
    // relay token fetched from YOUR backend — never your bfk_* secret. See below.
    getToken: () => sessionStore.token,
    onUnauthorized: () => refreshToken(),
  },
  persistence: myBrainApiClient,            // conforms to BrainPersistenceAdapter
  resolveSystemPrompt: () => 'You are a helpful build assistant.',
};

function App() {
  return (
    <BrainProvider config={config}>
      <BrainActionsProvider>
        <BrainContextProvider>
          <YourBrainUI />
        </BrainContextProvider>
      </BrainActionsProvider>
    </BrainProvider>
  );
}
```

The package is **headless** — you render the UI. `useBrainChats` gives you the
chat list + CRUD; `useBrainConversation` gives you messages, `send()`, streaming
text, attachments, and the agentic tool-call loop.

## MCP-style extension contract (client tools)

A "Brain extension" is a tool the assistant can call. Declare it with
`useRegisterBrainActions` while your component is mounted — the Brain advertises
it to the model and runs your `run(args)` handler when the model calls it, then
feeds the result back into the conversation. **Your code never touches the LLM.**

```tsx
import { useRegisterBrainActions, type BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { useMemo } from 'react';

function CheckoutTools() {
  const actions = useMemo<BrainAction[]>(() => [{
    // Flat snake_case names round-trip cleanly through the gateway.
    name: 'apply_discount',
    description: 'Apply a discount code to the current cart.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    run: async ({ code }: { code: string }) => cart.applyDiscount(code),
  }], []);

  useRegisterBrainActions(actions);  // no-op if no provider is mounted
  return null;
}
```

`BrainAction` is the contract: `{ name, description, parameters (JSON Schema), run }`.
Registrations are last-writer-wins by `name` and auto-unregister on unmount.

## Server-to-server auth (don't leak your API key)

Builderforce `bfk_*` keys are **server-only by default** (the gateway rejects a
browser `Origin` unless you explicitly allowlist it). So for browser embeds, keep
the secret on **your** backend and hand the browser a short-lived relay token:

```
Browser  ──►  Your backend (holds bfk_*)  ──►  api.builderforce.ai/llm/v1/embed-session
   ▲                                                          │
   └──────────────── short-lived embed token ◄────────────────┘
Browser then calls the gateway directly with the short-lived token (getToken()).
```

Minimal relay (Node/Express) — the secret never reaches the client:

```ts
app.post('/brain/token', async (req, res) => {
  const r = await fetch('https://api.builderforce.ai/llm/v1/embed-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUILDERFORCE_API_KEY}` }, // bfk_*
    // No browser Origin header here — this is a server-to-server call.
  });
  res.status(r.status).json(await r.json()); // { token, expiresAt }
});
```

Wire `config.transport.getToken` to fetch/refresh from `/brain/token`.

## Persistence adapter

`config.persistence` must implement `BrainPersistenceAdapter`
(`listChats`, `getChat`, `createChat`, `updateChat`, `deleteChat`,
`summarizeChat`, `getMessages`, `sendMessages`, `setMessageFeedback`, `upload`,
`uploadUrl`). The Builderforce `/api/brain` client matches it as-is; bring your
own backend by conforming to the same signatures.

## License

MIT
