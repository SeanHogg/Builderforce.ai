# PRD 36 — VS Code chat identity, local spend, and sync on sign-in

Status: design, awaiting operator review (2026-10-24). No code until it is approved.
Part of the local-first program in [docs/design/vsix-offline-first-architecture-review.md](../design/vsix-offline-first-architecture-review.md).
It delivers that program's G04 (stable client identity) for chats, adds per-run spend
that works offline, and wires the chat slice of G15/G24 (batch sync, one coordinator).
It is a prerequisite for PRD 35's telemetry gate (§8): VS Code carries ~99% of agent
runs, and today its per-chat usage can land on the wrong chat.

## 1. The rule

A VS Code chat is local first. Its **local number is a view key and never leaves the
machine**. A chat reaches the server only through a **binding** to a server chat. Every
server-addressed call uses the bound server id, or is not made. Spend is priced locally,
per call, from token usage and a price list shipped in the npm package. It syncs to the
account when, and only if, the person signs in and enables sync.

## 2. What is wrong today (evidence)

| # | Defect | Where |
|---|---|---|
| D1 | Panel chats get local ids `max+1` (1, 2, 3…), and the server numbers chats separately. | `brain-embedded/src/localFirstPersistence.ts:73-80` |
| D2 | Every gateway call sends the local id as `metadata.chatId`. The server writes it to `llm_usage_log.chat_id` without checking that the chat exists or that the caller owns it, and logs "agent.replied in chat #N". | `runStore/runPreamble.ts:101-107` → `streamChatCompletion.ts:511-515` → `api/.../usageLedger.ts:262-278`, `gatewayChatSupport.ts:162-175` |
| D3 | The ticket rail calls `/api/brain/chats/{localId}/tickets\|runs\|agents\|members`. Local chat 5 reads and edits server chat 5 whenever the user can access it. | `webview/src/chat/useTicketRail.ts:28-31` → `brain-ui/src/chatTickets/restAdapter.ts:89-145` |
| D4 | The model is told the local id as "your chatId" and passes it to platform tools (ticket links, backstops). | `runStore/runPreamble.ts:145-167` |
| D5 | Run context and Evermind scope on `chat:{localId}`. | `clients/vscode/src/brainRunHostPorts.ts:279,284` |
| D6 | The native chat participant creates its chats in the same local store and uses those ids for the same server calls. | `clients/vscode/src/chatParticipant.ts:178-216` |
| D7 | The spend pill reads `chat.spend`, which only server rows carry. A VS Code chat never shows spend or savings. | `webview/src/chat/VsCodeChatSurface.tsx:253` |
| D8 | The mapping store (`putMapping` / `mapping`) and the sync coordinator exist and are never called. Chats have no destination. | `packages/local-first/src/store.ts:191-196`, `clients/vscode/src/installSyncCoordinator.ts:4`, `localFirstStore.ts:58-62` |

## 3. End state

```
VS Code panel / native chat
        │ local chat (clientId uuid, local view key)
        ▼
  ChatIdentity (host, ONE module) ── binding: mapping('chat', clientId, destination) → serverChatId
        │                                   (created by bind-on-sign-in or by a sync receipt)
        ├── bound   → serverChatId on every server call: gateway metadata, ticket rail,
        │             run context / Evermind scope, the model's chatId, backstops
        └── unbound → those calls are not made (no rail; the metadata omits chatId)

  Every model call ──► RunUsageLedger (local store, one row per call: model, tokens,
        │               cache tokens, route = gateway | local | byo-direct, savings fields,
        │               clientEventId)
        ▼
  foldSpendSavings (ONE pure fold, in @builderforce/spend-contract)
        × PriceBook (bundled snapshot in @builderforce/model-catalog)
        ▼
  SpendPill (the shared brain-ui pill, unchanged) — per chat, per run, offline

  Sign in + enable sync ──► SyncCoordinator (G24, one per device store)
        ├── unbound chats → server creates them, receipts write the mappings
        ├── messages → imported as history
        └── ledger rows with route ≠ gateway → imported as usage rows (deduped by clientEventId)
            (gateway calls are already on the server; they are never sent twice)
```

### 3.1 Contracts

- **`BrainChat.serverId?: number`.** A projection from the mapping, filled by the local
  persistence's `getChat` / `listChats`. It is never stored on the chat row: the mapping
  is the one fact.
- **`ChatIdentity` (host).**
  - `serverIdFor(localId): number | undefined` reads the mapping.
  - `bind(localId): Promise<number | undefined>` runs when signed in and the platform
    policy allows it: `createBrainChat` (existing `POST /api/brain/chats`), then
    `putMapping`.
  - It is idempotent: an existing mapping wins.
  - The panel's run host, the native participant and the webview bridge all use it.
- **Gateway metadata.** `chatId` is the server id or absent. A new
  `clientChatId` (uuid) rides for diagnostics only. The server never resolves it to a chat.
- **`RunUsageLedger` row:**
  `{ clientEventId, clientChatId, runKey, model, route, promptTokens, completionTokens,
  cacheReadTokens, cacheCreationTokens, savingsSource?, savedPrompt?, savedCompletion?,
  recallPrompt?, at }`.
  It is written in the same transaction as the turn's messages.
- **`foldSpendSavings(slices, book)`.** It moves from `api/.../spendSavingsSummary.ts` into
  `@builderforce/spend-contract`, together with `UsageSlice` and the cache multipliers.
  The api re-exports it, so its tests run unchanged (PRD 35 §5.1). The VS Code side maps
  ledger rows to slices and calls the same fold.
- **Price snapshot.** `@builderforce/model-catalog/src/generated/priceSnapshot.ts` is
  generated from the same OpenRouter catalog the api prices from, with `withPriceTiers`
  applied. It is regenerated by `scripts/gen-price-snapshot.mjs` on every release. It is
  read through the existing `PriceBook` interface, so the fold does not know where its
  prices came from.

### 3.2 Which figure the pill shows

| Chat state | Spend shown |
|---|---|
| Unbound (signed out, or sync off) | Local fold over every ledger row. Gateway calls are priced from the snapshot and marked ≈ (estimate). |
| Bound | Server `chat.spend` for gateway calls (authoritative), plus the local fold over rows the server cannot see (route `local` / `byo-direct`). One pill, no double counting. |
| Local models only | $0 spent; "saved" is what the same tokens would have cost on the chat's paid route (estimated). |

## 4. Workstreams

| WS | Scope | Accept |
|---|---|---|
| **36.1 Stop the leak** | Close D2–D6: no local id in any server call or in the model's prompt; the rail renders only for a bound chat. | No server call or prompt carries a local id (a test asserts the request bodies and the prompt). Existing rail / run-host / participant tests pass unchanged. |
| **36.2 Bind on sign-in** | `ChatIdentity` + the `serverId` projection. Bind on the first run when signed in and the platform policy allows it. The native participant uses the same module (D6). | A signed-in chat's tickets, usage and Evermind all land on its own server chat. Signed out, nothing is sent. |
| **36.3 Local spend** | Move the fold into `spend-contract`; add the price snapshot + generator; add the ledger write in the run host; the pill reads the ledger fold (§3.2). | The pill shows per-chat spend and savings offline. Server fold tests pass unchanged. A bound chat's figure equals the server figure for gateway-only calls. |
| **36.4 Sync on enable** (local-first program G15/G24, chat slice) | Server `POST /api/sync/v1/push` / pull for chats, messages and usage rows; the coordinator constructed by the host when sync is granted; receipts write the mappings. | Long-offline chat → sign in → enable sync → the chat, its transcript and its local-model usage appear on the web once, with the right server id, and are not duplicated on retry. |

36.1 ships first and alone: it is a correctness fix on live data. 36.2 and 36.3 can run in
parallel after it. 36.4 depends on 36.2's mapping and is the largest.

## 5. Rules

PRD 35 §5 and §5.1 apply in full: tests run unchanged, port and then delete, no god
classes, the model roles, and one branch per workstream.

## 6. Open questions for the operator

1. **Bind automatically when signed in, or only after "Enable sync"?** The local-first
   design says signing in alone must not start sync (§Recommendation). Binding sends only
   a title and project, not the transcript. The recommendation is to bind on sign-in
   (36.2) and keep transcript upload behind "Enable sync" (36.4).
2. **Existing data.** Some usage rows and ticket links already point at server chats that
   happened to share a local number. Leave them, or run a one-off read-only report
   (by VS Code key and time window) to find them first?
