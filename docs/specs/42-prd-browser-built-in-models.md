# PRD 42 — The browser's own model, in every modality

| | |
|---|---|
| Status | In progress — WS1 core implemented (A1 identity, the probe `state`, the vendor-aware `browserEngine`, `promptApi` moved to `builtInAi/`); picker Download (A2) and WS2–WS6 not yet built. Review before each workstream ships. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Local-first. Builds on PRD 34 (local models everywhere: `bfi`, WebLLM and the `browser` page runtime), the inference modes (Local only · Hybrid · Specific) and the four routing packages (`model-catalog`, `workload`, `model-router`, `run-policy`). |
| Date | 2026-11-06 |

## 1. What and why

Browsers now ship a small language model. Chrome has Gemini Nano, and Edge has Phi-4-mini.
Both expose it through the same web APIs:

- the general **Prompt API** (`LanguageModel`);
- the **task APIs**:
  - `Summarizer`, `LanguageDetector` and `Translator`, stable in Chrome 138;
  - `Writer`, `Rewriter` and `Proofreader`, in origin or developer trials. Edge previews `Summarizer`, `Writer` and `Rewriter`.

A call these models can answer costs nothing, sends nothing off the device and works offline.

Today we use one of these APIs in one place. The `browser` page runtime answers tool-less
chat turns through the Prompt API on the web and in Rovr. Everything else that could run there
goes to a pinned model or to the server.

This PRD makes the browser's model, and on the editor its equivalent Synapse, the first
choice for every call it can answer, in every host. It delivers four things:

1. **The right model, named correctly.** The `browser` runtime knows which browser it is in.
   It names Gemini Nano or Phi-4-mini, uses that model's real window and can be downloaded
   on request.
2. **Background work on the device.** This covers compaction folds, hand-off packs, chat
   Consolidate/Fork, knowledge judgement, meeting and replay summaries, dashboard intent,
   and SOP and résumé rewrites. Each runs on-device first through ONE port, `OnDeviceTasks`,
   whatever model the conversation is pinned to.
3. **Client-first server routes.** A server route that summarizes or rewrites the user's own
   content accepts the client's on-device result. The server spends a model call only when
   the request arrives without one.
4. **Content translation (new feature).** A person reads another person's message, or an
   imported document, in their own language. The translation is detected and translated on
   the device. The original is never altered.

## 2. Principles

1. **On-device first for utility work, in every mode.** A model pin selects the model for the
   *conversation*, not for housekeeping. A `utility` call goes to the device whenever the
   device can take it, under Hybrid, Specific and Local only alike. The device is never less
   private than the pin. (Operator decision 1.)
2. **Never a surprise download.** Probing never starts a download (unchanged). A model arrives
   only when the person clicks Download in the "On this device" picker. (Operator decision 2.)
3. **Null means "not here".** Every on-device task returns its result or `null`. A `null` means
   the caller does what it does today. No caller branches on browser, vendor or API.
4. **Registry data, not branches.** Vendor identity, task-to-API mapping, window fallbacks
   and chunk limits are rows in a table. A new browser or a new API is a row plus an adapter.
5. **One detection per API.** Each built-in API is feature-detected in exactly one adapter file,
   the way `promptApi.ts` is today. Nothing else reads a global.
6. **The client may supply the user's own text, never a decision.** A server accepts
   client-computed summaries and rewrites of the caller's own content. It never accepts a
   client-computed value for billing, authorization, entitlement, or grading that crosses
   tenants. Structured outputs are validated on the server against the same schema or enum.
   (Operator decision 3.)
7. **Measured, not assumed.** Every on-device call writes the existing local usage row, so
   savings and quality appear in the existing telemetry. The local-success predictor learns
   where the device's answers are good enough.

## 3. What exists today

### 3.1 Already built

- **The engine.** `brain-embedded/src/promptApi.ts` detects the Prompt API (the current
  `LanguageModel` global and the legacy `self.ai.languageModel`). It also measures input and
  turns the output stream into deltas.
- **The page engine.** `brain-embedded/src/browserEngine.ts` (`promptApiEngine`) works as follows:
  - It is registered in `pageEngines/pageEngineSet.ts` beside bfi and WebLLM.
  - It is served through the ONE page fetch shim.
  - It refuses tools, oversized prompts and unavailable models before the first chunk, so the
    failover to the cloud is invisible.
- **The registry row.** `packages/local-inference/src/runtimes.ts:197` defines `browser` with
  `automaticRank: 40`, `reach: 'page'`, `catalog: 'declared'` and the label `'Gemini Nano'`.
- **The hosts.**
  - Web: `frontend/src/lib/brain/localFirst.ts` (`createHostModelStream`).
  - Rovr: `clients/chrome/src/host/panelServices.ts:194`. The side panel has the Prompt API
    and WebGPU.
- **The `utility` role.** `packages/agent-tools/src/modelRoles.ts:15` already defines
  `utility`. Nothing in the summarizer path stamps it.
- **The VS Code on-device path.** `clients/vscode/src/modelRouting.ts` provides
  `completeOnDevice` and `onDeviceModelAvailable`, which run Synapse. Knowledge judgement
  (`knowledge/knowledgeJudgement.ts:31`) and local research (`localResearch/editorResearchPort.ts`)
  already use them first.

### 3.2 Gaps found

| # | Gap | Where |
|---|---|---|
| G1 | The engine ignores which browser it is in. Edge's `LanguageModel` (Phi-4-mini) is reported as `gemini-nano`, labelled "Gemini Nano" and assumed to have Gemini's 4,096-token fallback window. | `browserEngine.ts:46,51`, `runtimes.ts:199` |
| G2 | The engine is never offered when the browser reports `downloadable`, and the person has no way to fetch the model. A fresh Chrome or Edge install never uses it. | `browserEngine.ts` `probeOnce` |
| G3 | Compaction folds and hand-off packs ride the run's pinned model. `localFirstApplies` is `!call.model && routingMode==='auto'`, so a picked model (often paid) also does every summary. The calls carry no `role`, so `localFirstWorkload` cannot tell they are utility work. | `localFirstTransport.ts:238,260`, `run/brainFold.ts:54`, `windowFit/packForModel.ts:135`, `transcriptSummarizer.ts:31` |
| G4 | A summary's input is a whole transcript middle, which is larger than the built-in model's window. Without chunking, the device can never take it. | `transcriptSummarizer.ts` |
| G5 | Knowledge judgement on web and Rovr always calls `POST /:projectId/knowledge/judge`, often dozens of short JSON calls per review. Only VS Code tries on-device. | `packages/knowledge-client/src/client.ts:311`, `packages/knowledge-browser/src/knowledgeSource.ts:152` |
| G6 | Server-side summaries and rewrites of the user's own content always spend a server model call. | see §6 Part D |
| G7 | No task API is used: Summarizer, LanguageDetector, Translator, Writer, Rewriter or Proofreader. | — |
| G8 | Nothing translates user content. i18n covers only our own UI strings. | — |
| G9 | The on-device path is VS Code-only. `completeOnDevice` is the editor's private seam, not a shared port, so web and Rovr would need a second copy. | `clients/vscode/src/modelRouting.ts` |

### 3.3 Calls that already need no model (no change)

These need no model and stay as they are: chat titles (`chatTitle.ts`), triage
(`brainTriage.ts`), affect (`limbicAffect.ts`), workload classification (`packages/workload`),
commit and PR messages (`specialists/registry.ts`), and the deck rewriters (`chartRewriter.ts`,
`inPlaceFiller.ts`).

## 4. Modality coverage

| Host | Chat turns | Utility tasks | Translation | On-device engine |
|---|---|---|---|---|
| Web (Chrome, Edge) | ✓ today; gets Part A | Parts B–D | Part E | built-in task APIs → Prompt API → bfi / WebLLM |
| Rovr (Chrome extension; the same build as an Edge add-on) | ✓ today; gets Part A | Parts B–D | Part E | the same as web; the Prompt API is stable for extensions |
| VS Code | n/a (Electron ships no built-in model) | Parts B–D, through the same port | Part E | Synapse (`bfi-node`), through `completeOnDevice` |
| Web on Firefox and Safari | no built-in model | the port returns `null` → today's path | cloud fallback | bfi / WebLLM when present |
| Cloud runs, on-prem | n/a | unchanged (`gatewaySummarizer` on the free Workers AI tier) | n/a | — |

## Part A — The right model, named correctly

### A1. Vendor identity as data

New file: `brain-embedded/src/builtInAi/identity.ts`.

```ts
export type BuiltInAiVendor = 'chrome' | 'edge' | 'unknown';
export interface BuiltInModelIdentity {
  vendor: BuiltInAiVendor;
  model: string;               // 'gemini-nano' | 'phi-4-mini' | 'built-in'
  label: string;               // brand token, not localized: 'Gemini Nano' | 'Phi-4-mini'
  fallbackContextTokens: number;
}
export const BUILT_IN_MODELS: Record<BuiltInAiVendor, BuiltInModelIdentity>;
export function builtInModelIdentity(nav?: NavigatorLike): BuiltInModelIdentity;
```

- **Vendor detection.** The vendor comes from `navigator.userAgentData.brands`
  (`"Microsoft Edge"` → `edge`, `"Google Chrome"` → `chrome`). When `userAgentData` is absent,
  it falls back to a single user-agent regex. Unknown Chromium builds that expose the API are
  `unknown`, labelled "Built-in model".
- **Model ids.** `browserEngine.ts` reads the id and the fallback window from here, instead of
  `BROWSER_ENGINE_MODEL` and `BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS`. Those two constants are
  deleted and every caller is migrated.
- **The registry label.** The `browser` row's `label` becomes the generic "Built-in model". The
  probe row carries the vendor's label, so the picker shows "Phi-4-mini (Edge)" or
  "Gemini Nano (Chrome)".
- **Refs.** Model refs become `local/browser/<model>`. A pinned `local/browser/gemini-nano`
  stays valid in Chrome. In another vendor, the pin resolves to that vendor's model, with a
  `PIN_REMAPPED` note through `onFallback`. It is never a silent swap.

### A2. Opt-in download

- **Probe.** The probe reports `downloadable` and `downloading` models as rows with a
  `state: 'downloadable' | 'downloading' | 'ready'` field. Routing considers only `ready` rows
  (unchanged behaviour).
- **Picker.** The "On this device" picker (PRD 34) shows a **Download** action for a
  `downloadable` built-in model. Clicking it calls `LanguageModel.create({ monitor })` inside
  that user activation, which the browser requires to start a download. The picker shows
  progress from `downloadprogress` events and lists the browser's stated hardware requirement.
- **No download from a turn.** A chat turn never calls `create()` on a model that is not
  `available`. This rule is unchanged, and it is now tested.
- **Downloading a task model.** The same Download action covers the task APIs whose
  `availability()` reports `downloadable`, such as the Summarizer and Translator language packs.
  It downloads them on the same click.
- **Localization.** All new strings are localized in the five catalogs, in the `localModels.*`
  namespace. The picker row uses theme tokens and fits a 360 px viewport.

## Part B — One `OnDeviceTasks` port

### B1. Contract

New file: `brain-embedded/src/onDevice/onDeviceTasks.ts`. It is exported, and its shape is
pure enough to live in `@builderforce/local-inference` if a second package needs the type.

```ts
export type OnDeviceTaskKind =
  | 'summarize' | 'rewrite' | 'proofread' | 'write'
  | 'detectLanguage' | 'translate' | 'json';

export interface OnDeviceTasks {
  /** Which task kinds can run right now (ready models only). Cheap; memoized like probes. */
  available(): Promise<ReadonlySet<OnDeviceTaskKind>>;
  summarize(text: string, o: { kind: 'tldr' | 'key-points' | 'transcript'; maxWords?: number; context?: string; signal?: AbortSignal }): Promise<string | null>;
  rewrite(text: string, o: { tone?: 'more-formal' | 'as-is' | 'more-casual'; length?: 'shorter' | 'as-is' | 'longer'; instruction?: string; signal?: AbortSignal }): Promise<string | null>;
  write(task: string, o?: { context?: string; length?: 'short' | 'medium' | 'long'; signal?: AbortSignal }): Promise<string | null>;
  proofread(text: string, o?: { signal?: AbortSignal }): Promise<string | null>;
  detectLanguage(text: string): Promise<{ lang: string; confidence: number } | null>;
  translate(text: string, o: { from?: string; to: string; signal?: AbortSignal }): Promise<string | null>;
  /** Structured output. The result is validated against `schema` before it is returned; invalid → null. */
  json<T>(o: { system: string; user: string; schema: JsonSchema; signal?: AbortSignal }): Promise<T | null>;
}
```

Every method behaves the same way:

- It returns `null` when the task cannot run here: the API is absent, the model is not ready,
  the input is over budget after chunking (B3), the model refused, or the output failed validation.
- It throws only `AbortError`.
- It never touches the network.
- It records one local usage row (§F).

### B2. Implementations

Each adapter owns one API and its detection. The task-to-adapter order is a registry row, not
a branch.

```
brain-embedded/src/builtInAi/
  identity.ts            A1
  promptApi.ts           moved from src/promptApi.ts (unchanged API; callers migrated)
  summarizerApi.ts       Summarizer
  writerApi.ts           Writer
  rewriterApi.ts         Rewriter
  proofreaderApi.ts      Proofreader
  languageDetectorApi.ts LanguageDetector
  translatorApi.ts       Translator
  structuredPrompt.ts    Prompt API + responseConstraint (json; and the generic fallback for summarize/rewrite/write)
brain-embedded/src/onDevice/
  onDeviceTasks.ts       the contract
  taskRoutes.ts          ON_DEVICE_TASK_ROUTES: kind → ordered adapter ids (data)
  pageOnDeviceTasks.ts   web/Rovr implementation: walks taskRoutes, then the page engines (bfi/WebLLM) via the fetch shim
  completionOnDeviceTasks.ts  implementation over any on-device chat completion (used by VS Code with Synapse; also the page engines' tail)
  chunkedSummary.ts      B3
```

The default routes:

| Task | Adapter order |
|---|---|
| `summarize` | Summarizer → Prompt API → page engine |
| `rewrite` | Rewriter → Prompt API → page engine |
| `write` | Writer → Prompt API → page engine |
| `proofread` | Proofreader → Prompt API → page engine |
| `detectLanguage` | LanguageDetector only |
| `translate` | Translator only |
| `json` | Prompt API (`responseConstraint`) → page engine with the schema in the prompt and validation |

`translate` and `detectLanguage` have no generic-model fallback. A small chat model's
translation is not good enough to show unlabelled.

- **VS Code** gets `completionOnDeviceTasks` bound to `completeOnDevice`. Its existing
  `completeOnDevice` callers in `knowledgeJudgement.ts` and `editorResearchPort.ts` move onto
  `OnDeviceTasks.json` / `.summarize`. That closes G9 with one seam and no second copy.
  `detectLanguage` and `translate` return `null` in the editor, and Part E uses the cloud path
  there.
- **Hosts** expose the port once:
  - web: `frontend/src/lib/brain/onDeviceTasks.ts` (`browserOnDeviceTasks()`, beside `browserPageEngines()`);
  - Rovr: `panelServices.ts`;
  - VS Code: the extension's service wiring.

  Consumers receive the port through their existing context or constructor. Nothing imports a host module.

### B3. Chunked summaries

`chunkedSummary.ts` lets a small window take a long transcript:

1. Measure the budget: `measureInputUsage`, or `Summarizer.measureInputUsage`, or ≈4 chars per
   token when the build cannot measure.
2. Split on message boundaries into chunks under 80% of the budget.
3. Summarize each chunk with the same instruction.
4. Summarize the concatenated summaries. Recurse when that is still over budget.
5. Stop and return `null` past `MAX_SUMMARY_CHUNKS = 8` leaf chunks. The caller's existing path
   (the cloud) takes it.

The limit is a constant in `taskRoutes.ts`, not a magic number at a call site.

## Part C — Utility calls go on-device first

### C1. Stamp the role

`transcriptSummarizer.ts` `streamSummaryCompletion` stamps `role: 'utility'` on its request.
That one change covers the compaction fold (`brainFold.ts`), the hand-off pack
(`packForModel.ts` via `runWindowFit.ts`), canvas compaction (`frontend/src/lib/canvasModelPort.ts`)
and local chat Consolidate/Fork (`localFirstPersistence.ts`, `clients/vscode/src/chatSummarizer.ts`).

### C2. Route utility before the pin

`localFirstApplies` becomes `role === 'utility' || (!call.model && routingMode === 'auto')`.
For a utility call, `createHostModelStream` (`hostModelStream.ts`) works as follows:

1. **Try the device first.** Call `OnDeviceTasks.summarize` (chunked, B3). This summarizes
   rather than streaming a chat completion, so the Summarizer API takes it when present.
2. **When the device declines**, behave exactly as today: the run's pin, then Auto under Hybrid.
3. **Under Local only**, step 2 is the other on-device engines only (unchanged).

The summary stays silent (`reasoning: off`, never a visible model turn). It is recorded in the
fold the same way whichever engine produced it, and the fold notes which engine that was.

### C3. Cloud runs are unchanged

`api/src/application/llm/gatewaySummarizer.ts` already uses the free Workers AI pool and stays
as it is. There is no browser on that path.

## Part D — Client-first server routes

### D1. The pattern

1. The client's typed API method tries `OnDeviceTasks` first.
2. When that returns a result, the request carries it in one field, `clientResult`, with a
   provenance stamp `{ engine: 'browser' | 'bfi' | 'webllm' | 'synapse', model: string }`.
3. The route's use case validates and stores it, and skips its model call.
4. Without `clientResult`, the route behaves exactly as today.

Shared server pieces:

- **Validation.** One helper, `api/src/application/llm/clientResult.ts`, parses and validates
  `clientResult`: a length cap, a schema or enum when the output is structured, and a
  provenance whitelist. No route parses it inline.
- **Telemetry.** A stored client result records `llm_usage_log` rows with `residency='local'`
  and zero cost through the existing local-usage writer. Savings ride the existing rows, with
  no new table (both migration tracks already carry the columns).

### D2. Routes in scope

| Route (client → server) | Task | Client-side call | Server-side validation |
|---|---|---|---|
| `POST /api/brain/chats/:id/summarize` (Consolidate/Fork) ← `brainRestPersistence.ts:127`, `useBrainConsolidateFork.ts`, VS Code `useSessionActions.ts` | summary | `summarize({kind:'transcript'})`, chunked | length cap |
| `POST /api/brain/agent-host-sessions/:id/summarize` | summary | the same | length cap |
| `POST /:projectId/knowledge/judge` ← `knowledge-client/src/client.ts:311` | judgement (JSON) | `json({schema: JUDGEMENT_SCHEMA})` per item; the shared prompts already exist | the same schema; enum fields checked |
| Meeting minutes (`meetingRoutes.ts:417` → `meetingIntelligence.ts:197`) | structured minutes | `summarize`, then `json` for action items | schema |
| Replay summaries (`replayAnalysisRoutes.ts:182,191`) | summary | `summarize`, chunked | length cap; the daily budget counts only server calls |
| Dashboard intent (`dashboardsRoutes.ts:140` → `gatewayIntentRefiner.ts`) | metric key | `json({schema: {enum: <tenant's metric keys>}})` | must be one of the tenant's keys, else ignored |
| SOP draft and rewrite (`knowledgeRoutes.ts:888`) | write / rewrite | `write` / `rewrite`; streamed in the UI from the device | length cap |
| Résumé bullet rewrite and merge (`careerAiRoutes.ts:78,94`) | rewrite | `rewrite` / `json` | schema |

**Excluded:**

- Résumé *grading* (`careerAiRoutes.ts:103`) stays server-side, under principle 6.
- Admin legal "enhance" stays server-side: it is low volume, admin-only and legally sensitive.
- `classifyTask` (ticket action type) stays server-side. It is lexical first, cached on
  `tasks.action_type`, and it drives dispatch.

## Part E — Content translation (new feature)

### E1. What a person can now do

A person reads a message, comment or imported document written in another language in their
own UI language:

- The text shows **"Translated from Spanish · Show original"**.
- **"Show original"** toggles back. The stored content is never altered.
- Translation is **viewer-side**: each reader sees their own locale.

### E2. Where it appears

These surfaces render one shared `TranslatableText` component:

- multiparty and staffed chat messages, on web and Rovr, and in the VS Code chat webview;
- canvas comments;
- imported documents on the canvas (`ImportCanvasFile`), offered at import as "Translate to <locale>".

`TranslatableText` takes `{ text, contentId }` and owns its own state:

- It detects the language and decides its own visibility. It renders the plain text when the
  language matches the viewer's locale or detection is unsure (confidence < 0.6).
- It translates lazily, when the text enters the viewport.
- It caches per `contentId + locale` in the existing local store (IndexedDB), so each message is
  translated once per device.

### E3. Engines by mode

| Mode | Behaviour |
|---|---|
| Local only | `OnDeviceTasks.translate` only. When that returns `null`, show the original and a muted "Translation needs this browser's built-in translator" hint, which links to the picker's Download. |
| Hybrid / Specific | on-device first. On `null`, call a new cloud fallback (E4). |
| Signed out (anonymous) | the same as Local only. No guest token is minted for translation. |

### E4. Cloud fallback

- **Route.** `POST /api/translate`, with body `{ texts: string[] ≤ 20, to, from? }`. It runs on
  the free Workers AI translation model through the existing free-pool client, never a paid model.
- **Cache.** Results go through `getOrSetCached`, keyed by `sha256(text) + from + to`. The
  keyspace is unbounded, so the entry uses a versioned prefix with a TTL. There is nothing to
  invalidate: a text's translation does not change.
- **Rate limit.** The existing per-tenant limiter applies. A `429` falls back to showing the original.
- **Layering.** The route takes an application port (`TranslateText`). The use case owns
  batching and the cache, and the Workers AI binding sits behind an infrastructure adapter.

### E5. Launch obligations

This is a new capability, so the same pass ships:

- a `release_notes` row (`category=new`) authored through the superadmin ReleaseNotesPanel;
- a blog post in five locales on the `run-your-app-on-the-canvas.md` template, with
  `bf-figure` visuals (a `screen` of a translated message and a `devices` figure across Web,
  Rovr and VS Code) and a "Where it sits in the method" section.

Parts A–D are improvements, and get at most a `category=improvement` release note.

## Part F — Measure

- **Usage rows.** Every on-device task writes the existing local usage row, with
  `residency='local'`, `role='utility'`, the task kind and the engine/model, through the host's
  existing local-usage sink.
- **Quality.** The local-success predictor gets one new signal per utility call:
  `accepted`, or `replaced` (the caller fell through to the cloud after the device answered,
  for example because validation failed).
- **Dashboard.** The existing savings view gains an "On-device utility" series, computed from
  existing rows with no new table: utility calls by engine, and the share served on-device.

## 4. Contracts summary (new or changed)

| Contract | Change |
|---|---|
| `BuiltInModelIdentity`, `BUILT_IN_MODELS` | new (A1) |
| `LocalRuntimeProbe` model row | gains `state: 'ready' \| 'downloadable' \| 'downloading'` |
| `browser` runtime row | label becomes "Built-in model"; the vendor label rides the probe |
| `OnDeviceTasks`, `ON_DEVICE_TASK_ROUTES` | new (B1, B2) |
| `localFirstApplies` | `role === 'utility'` applies regardless of the pin (C2) |
| summarizer request | stamps `role: 'utility'` (C1) |
| `clientResult` request field + `clientResult.ts` validator | new, on the D2 routes only |
| `POST /api/translate`, `TranslateText` port | new (E4) |
| `TranslatableText` component | new (E2) |
| deleted | `BROWSER_ENGINE_MODEL`, `BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS`; `src/promptApi.ts` moves to `builtInAi/promptApi.ts` |

## 5. Code map

| Area | Files |
|---|---|
| Identity and adapters | `brain-embedded/src/builtInAi/*` (new); `brain-embedded/src/browserEngine.ts` (reads identity) |
| Port | `brain-embedded/src/onDevice/*` (new); `brain-embedded/src/index.ts` (exports) |
| Registry | `packages/local-inference/src/runtimes.ts` (label); its probe row type (`state`) |
| Routing | `brain-embedded/src/localFirstTransport.ts`, `hostModelStream.ts`, `transcriptSummarizer.ts` |
| Web host | `frontend/src/lib/brain/onDeviceTasks.ts` (new), `frontend/src/lib/brain/localFirst.ts` |
| Rovr host | `clients/chrome/src/host/panelServices.ts` |
| VS Code host | `clients/vscode/src/modelRouting.ts` (binds `completionOnDeviceTasks`), `knowledge/knowledgeJudgement.ts`, `localResearch/editorResearchPort.ts` (migrated) |
| Picker | the PRD 34 "On this device" picker (Download, progress, state) |
| Knowledge | `packages/knowledge-client/src/client.ts`, `packages/knowledge-browser/src/knowledgeSource.ts` |
| Server | `api/src/application/llm/clientResult.ts` (new); the D2 route use cases; `api/src/application/translate/*` + `presentation/routes/translateRoutes.ts` (new) |
| UI | `TranslatableText` (new, shared by the web and VS Code webview chat); the chat, comment and import surfaces |
| i18n | `localModels.*`, `translation.*` in `frontend/src/i18n/messages/{en,zh,es,fr,de}.json` and the webview catalog |

## 6. Sequences

**A compaction fold in a run pinned to a paid model (Chrome, Hybrid):**
fold needed → `streamSummaryCompletion({role:'utility'})` →
`OnDeviceTasks.summarize` → Summarizer is ready →
`chunkedSummary`: 3 chunks plus a merge → summary recorded in the fold, engine `browser/gemini-nano` →
local usage row. No paid tokens are spent.

**The same fold in Firefox:** `summarize` → `null` (no API, no page model) →
the pinned model, as today.

**Knowledge review on web, 40 items:** each item → `OnDeviceTasks.json(JUDGEMENT_SCHEMA)` →
valid → `POST /knowledge/judge { clientResult }` → the server validates the schema and stores it.
For the 3 items that fail validation, the request is sent without `clientResult` and the server judges them.

**A Spanish message, viewed by an English reader in Edge:** `TranslatableText` enters the
viewport → `detectLanguage` → `es` (0.97) → `translate` returns `null` (Edge exposes no
Translator) → Hybrid → `POST /api/translate` (cached) → "Translated from Spanish · Show original".

## 7. Workstreams

| WS | Scope | Depends on | Review |
|---|---|---|---|
| WS1 | Part A: identity, the probe `state`, the label, Download in the picker | — | Sonnet |
| WS2 | Part B: the adapters, the port, `taskRoutes`, `chunkedSummary`; bound in all three hosts; VS Code `completeOnDevice` callers migrated | WS1 | Opus (cross-package architecture) |
| WS3 | Part C: the utility role and routing | WS2 | Sonnet |
| WS4 | Part D: `clientResult.ts` and the D2 routes; knowledge judge on web and Rovr first | WS2 | Opus (trust boundary: client-supplied results) |
| WS5 | Part E: `TranslatableText`, `/api/translate`, the surfaces, release note and blog | WS2 | Sonnet (Opus for the route's cache and rate limit) |
| WS6 | Part F: telemetry series | WS3–WS5 | Sonnet |

Each workstream follows the CLAUDE.md loop: Sonnet implements → Haiku verifies (targeted
typecheck, guards and named test files) → review → fixes.

## 8. Done-checks

1. In Edge with Phi-4-mini ready, the picker shows "Phi-4-mini (Edge)". A tool-less chat turn
   is answered on-device, and the run record names `local/browser/phi-4-mini`.
2. With the model `downloadable`, no chat turn starts a download (a unit test asserts that
   `create` is never called). Clicking Download shows progress, and the model becomes `ready`.
3. With a paid model pinned and the Summarizer ready, a compaction fold spends no paid tokens.
   Its fold record names the browser engine (a unit test with a fake Summarizer, plus a trace
   check).
4. A transcript 5× the device window summarizes through chunks. One past
   `MAX_SUMMARY_CHUNKS` falls through to the pin (a unit test).
5. Every `OnDeviceTasks` method returns `null` when its API is absent, and throws only on abort
   (an adapter conformance test runs against each adapter).
6. `completeOnDevice` has no direct callers outside `completionOnDeviceTasks` (a grep guard).
7. Knowledge judge from web with valid `clientResult` makes no server LLM call. An invalid one
   is rejected with `400`, and the client retries without it (route tests).
8. No D2 route accepts `clientResult` for grading or authorization. Résumé grade ignores the
   field (a route test).
9. `TranslatableText` renders the original under Local only when the device cannot translate.
   It never alters stored content. It works in both themes and at 360 px. All of its strings
   are in five catalogs.
10. `/api/translate` serves a repeat request from cache (a test), uses only the free tier, and
    rejects more than 20 texts.
11. The release note row and the five-locale blog post exist for Part E.
12. The savings view shows the on-device utility series from existing rows.

## 9. Non-goals

- Tool-calling agent turns on the built-in model. A many-tool turn does not fit its window,
  and small models are weak at tool calls. A later PRD may add structured-output emulation
  for turns with few tools, gated by the local-success predictor.
- Multimodal Prompt API input (images, audio).
- Built-in models inside the VS Code webview (Electron ships none). Synapse is the editor's
  equivalent.
- Translating our own UI strings. The catalogs remain the single source.
- Moving cloud-run compaction off `gatewaySummarizer`.

## 10. Measure

- **Primary:** the share of utility calls served on-device, per host and engine, and the
  server model calls avoided on the D2 routes. Both come from existing usage rows.
- **Guardrail:** the `replaced` rate (device answered, cloud redid it) stays under 10% per task
  kind. Above that, the task kind's route is demoted to cloud-first by a registry row.
- **Translation:** messages translated per locale pair, the cache hit rate on `/api/translate`,
  and the share served on-device.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A small model writes poor summaries | Utility work only. Chunked summarization keeps each call in-window. The `replaced` rate guardrail demotes a task kind. |
| The APIs change (Edge is experimental and behind flags; Writer, Rewriter and Proofreader are trials) | One adapter per API, feature detection, and `null` on any failure. Nothing depends on a trial API being present. |
| Hardware limits (Chrome needs about 22 GB of free disk and a capable GPU or 16 GB of RAM) | The picker states the requirement. `downloadable` is never forced. |
| A client supplies a forged result | Only the caller's own content. Validated with a schema or enum. Never used for billing, authorization or cross-tenant grading. |
| The first session is slow, or battery drain | Sessions are created lazily. A summary stays off the critical path of a turn, as today. |
| Pin semantics surprise someone | `PIN_REMAPPED` and the fold's engine note make the engine visible. Utility work is off the conversation's visible path. |

## 12. Operator decisions (taken 2026-11-06)

1. **Utility calls go on-device even when a model is pinned.** Yes.
2. **The picker offers an opt-in model download.** Yes; never automatic.
3. **Server routes accept client-produced summaries and rewrites of the user's own content.**
   Yes, with validation and the exclusions in D2.
4. **Content translation is in scope.** Yes (Part E).

## 13. References

- Chrome built-in AI APIs: https://developer.chrome.com/docs/ai/built-in-apis
- Edge Prompt and Writing Assistance APIs: https://blogs.windows.com/msedgedev/2025/05/19/introducing-the-prompt-and-writing-assistance-apis/
- Edge Writing Assistance APIs: https://learn.microsoft.com/microsoft-edge/web-platform/writing-assistance-apis
- Edge Prompt API: https://learn.microsoft.com/microsoft-edge/web-platform/prompt-api
