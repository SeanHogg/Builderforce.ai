                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              # PRD — Builderforce.ai B2B LLM Gateway

**Status:** Step 1 complete. **Step 2 fully closed** (SDK + C1 + all H/M follow-ups + reviewer-found C1.fix.1). **Step 3 fully closed** (`LocalAgentTransport`, `CompositeAgentTransport`, single-path orchestrator dispatch, 23 transport tests). Remaining long-tail: optional SDK `connectTimeoutMs` / `streamTimeoutMs` split, legacy workforce-prefix deprecation date, embeddings/vision wiring.
**Owner:** Sean
**Last updated:** 2026-05-04

---

## 1. Goal

Make Builderforce.ai the shared, billed, white-label LLM gateway behind every product in the portfolio. Tenant apps (hired.video, burnrateos.com, the IDE itself, CoderClaw) consume a thin SDK with **only an API key**; Builderforce handles vendor selection, free-vs-paid pool composition, failover, metering, and per-tenant daily limits.

### Constraints

| Decision | Value |
|---|---|
| Auth | **API key only** — no SSO/OAuth on the gateway |
| Billing party | **B2B tenant** — Builderforce bills the tenant; tenants run their own end-user billing (white-label) |
| Free plan | Wraps free LLMs (OpenRouter `:free`, Cerebras free, Ollama Cloud free) |
| Pro plan | Wraps free + paid LLMs (Claude / GPT-4.1 / Gemini 2.5 / Grok) |
| Vendor cascade | OpenRouter → Cerebras → Ollama, both within and across vendors |
| Naming | All public surfaces are `builderforce*` (was `coderClaw*` historically) |

---

## 2. Architecture

```
┌──────────────────────────────────┐       ┌──────────────────────────┐
│  hired.video / burnrateos.com    │       │   CoderClaw agents       │
│  (uses @builderforce/sdk)        │       │   (uses @builderforce/sdk│
│   only needs BUILDERFORCE_API_KEY│       │    with claw API key)    │
└────────────────┬─────────────────┘       └────────────┬─────────────┘
                 │                                       │
                 ▼                                       ▼
       ┌────────────────────────────────────────────────────┐
       │   api.builderforce.ai/llm/v1/chat/completions      │
       │   (OpenAI-compatible)                              │
       │     ┌─────────────────────────────────────┐       │
       │     │ LlmProxyService (refactored)        │       │
       │     │  ↓ buildCandidateChain              │       │
       │     │  ↓ dispatchVendor / dispatchStream  │       │
       │     │  ↓ cooldown + round-robin           │       │
       │     └─────────────────────────────────────┘       │
       │     vendors/registry.ts                           │
       │     ├─ vendors/openrouter.ts                      │
       │     ├─ vendors/cerebras.ts                        │
       │     └─ vendors/ollama.ts                          │
       └────────────────────────────────────────────────────┘
                 │
                 ▼
        ┌─────────────────────────────┐
        │ llm_usage_log (Neon)        │
        │ tenant + claw daily caps    │
        │ failover_log + telemetry    │
        └─────────────────────────────┘
```

---

## 3. Status — what's done

### Step 1 — Multi-vendor refactor in `Builderforce.ai/api/src/`

| Sub-step | Files | Status |
|---|---|---|
| **1a** Vendor type system | `application/llm/vendors/types.ts` | ✅ |
| **1b** OpenRouter vendor module | `application/llm/vendors/openrouter.ts` | ✅ |
| **1c** Cerebras + Ollama vendor modules | `application/llm/vendors/{cerebras,ollama}.ts` | ✅ |
| **1d** Vendor registry + dispatch | `application/llm/vendors/registry.ts` + `index.ts` | ✅ |
| **1e** Use-case registry (50 use cases — Builderforce + burnrateos + hired.video) | `application/llm/aiUseCases.ts` | ✅ |
| **1f** `LlmProxyService` refactor + rename | `application/llm/LlmProxyService.ts` | ✅ |
| **1g** New env vars `CEREBRAS_API_KEY`, `OLLAMA_API_KEY` | `env.ts` | ✅ |
| **1i** Caller updates (productName, headers, envelope) | `llmRoutes.ts`, `ideAiRoutes.ts`, `ideRoutes.ts`, `adminRoutes.ts`, `BrainService.ts`, `schema.ts`, `index.ts` | ✅ |

### Renames completed (api side)

- `coderClawLLM` / `coderClawLLMPro` / `coderClawLLMTeams` → `builderforceLLM` / `builderforceLLMPro` / `builderforceLLMTeams`
- `x-coderclaw-{model,retries,product,effective-plan}` → `x-builderforce-*`
- `_coderclaw` JSON envelope → `_builderforce`
- `'coderclawllm/workforce-<id>'` (model prefix) → accept `'builderforce/workforce-<id>'` AND legacy form (BC)
- `llm_product` schema default `'coderClawLLM'` → `'builderforceLLM'`

### DRY consolidations made along the way

- `llmProxyForPlan(env, effectivePlan)` — eliminates duplicated `isPro/apiKey/productName/service` wiring across `/v1/chat/completions` and `/v1/models`. Also fixes a Teams-plan bug (the `/v1/models` route had `isPro = effectivePlan === 'pro'` while chat had `=== 'pro' || === 'teams'`).
- `productNameForPlan(plan)` and `modelPoolForPlan(plan)` — single source of truth used in both routes.
- `ideProxy(env)` — replaces 4 near-identical `new LlmProxyService(apiKey, { modelPool: FREE_MODEL_POOL, preferredPoolSize: 2, productName: 'coderClawLLM' })` sites in `BrainService`, `ideAiRoutes`, and three locations in `ideRoutes`.
- `adminPoolProxy(env, pool, productName)` + `poolStatus(env, hasKey, pool, productName)` — collapses the duplicated free/pro admin-status construction.
- `FREE_MODEL_POOL` and `PRO_PAID_MODEL_POOL` are now **derived** from `openRouterModule.catalog` (single source of truth), not hand-maintained.

---

## 4. Remaining work

### Step 1h — Eliminate the worker's duplicate AI proxy

✅ **Redo passes review (2026-05-04).** All 10 punch-list items in §10 addressed; architecture is materially simpler than the previous attempt.

What landed:
- `worker/src/services/llmVendors.ts` actually deleted (with `streamCloudflareAI`, `streamOpenRouter`, `FREE_MODELS`, `getNextModelIndex` along with it).
- `worker/src/services/gateway.ts` is the single shared helper (`requestGatewayCompletion` non-streaming, `requireGatewayAuthToken` inbound-auth gate).
- `worker/src/services/dataset.ts:generateDatasetWithAI` and `worker/src/services/training.ts:evaluateModelOutputs` both route through `requestGatewayCompletion` — full migration, no half-bypass.
- Worker `/api/datasets/generate` and `/api/training/:id/evaluate` now require `Authorization: Bearer <jwt|clk_*>`; the token is forwarded to `api.builderforce.ai/llm/v1/chat/completions` so the api's `requireTenantAccess` does the real validation. **No god key.**
- Internal-key lane (`BUILDERFORCE_INTERNAL_API_KEY`, `x-builderforce-internal-tenant-id`) **deleted entirely** from `api/src/presentation/routes/llmRoutes.ts`, `api/src/env.ts`, and `api/scripts/set-secrets-from-env.mjs`. Auth-passthrough replaces it — neutralizes punch-list items #3, #4, #5 by removing the surface.
- `stream: false` in the worker→api call eliminates the SSE buffering bug (item #6) by removing the SSE step entirely.
- `useCase: 'train.evaluate'` field removed from the gateway request (item #7).
- `BUILDERFORCE_API_BASE_URL` in `worker/wrangler.toml [vars]`; legacy `AI`, `AI_PROVIDER`, `OPENROUTER_API_KEY` removed from worker `Env` (items #8, #9).
- `console.error` before fallback in both eval call sites (item #10).

#### Smaller findings (follow-ups, not blockers)

| # | Severity | Finding |
|---|---|---|
| N1 | 🟡 Medium | **Duplicate dataset/training stack persists across api and worker** (pre-existing). `api/src/presentation/routes/ideRoutes.ts:141-341` has `/datasets/generate`, `/training`, `/training/:id/logs`, `/training/:id/artifact`, `/training/:id/evaluate`. `worker/src/routes/datasets.ts` and `worker/src/routes/training.ts` mirror them. Frontend (`apiRequestStream`) routes via `getApiBaseUrl()` = `AUTH_API_URL`, not the worker URL — so the worker versions have no frontend callers. Per the dead-code rule, either delete the worker versions or document the intended consumer (direct API users? coderClaw? specify and gate). |
| N2 | 🟢 Low | `gateway.ts:looksLikeJwt` is a loose shape check (any `x.y.z` passes). Fine as a fast-path filter — the api does the real validation — but don't grow it into security surface. |
| N3 | 🟢 Low | `routes/training.ts:405` and `routes/datasets.ts:176` classify 401 by error-message string match (`msg.includes('Authorization')`). Fragile if the auth helper's wording ever changes. Use a typed error class on `requireGatewayAuthToken` and `instanceof`-check instead. |
| N4 | 🟠 High (carry-over) | **Horizontal authorization not enforced in worker.** The auth gate proves the caller has *some* valid token; it does NOT verify the caller's tenant owns the `jobId` in `POST /api/training/:id/evaluate`. So tenant A can trigger evaluate against tenant B's job — billed to A, but writes to `training_logs`/`model_artifacts` for B's project. The api version (`ideRoutes.ts:341+`) has the same shape. Add a `tenantId === project.tenant_id` check before processing. |
| N5 | 🟢 Low | CORS is still `origin: '*'` on the worker. Fine for token-scoped APIs, but worth a deliberate allowlist if the worker isn't supposed to be browser-callable from arbitrary origins. |

Step 1h is unblocked. The follow-ups above are tracked separately and do not block Step 2.

### Step 2 — `@builderforce/sdk` npm package

✅ **Reviewed and accepted (2026-05-04) after C1 fix.**

Lives at `Builderforce.ai/sdk/`. Layered DDD-ish: `domain/`, `application/`, `infrastructure/`. Single `BuilderforceClient` composing three sub-APIs (`chat.completions`, `models`, `usage`). Build: `tsup` dual ESM + CJS + `.d.ts`. Tests: `vitest` with mocked `fetch`.

#### What's right

- ✅ API-key only entry shape (`new BuilderforceClient({ apiKey, baseUrl?, fetch? })`) — matches the PRD constraint exactly. Injectable `fetch` for testability.
- ✅ `parseSseJson` correctly **buffers across chunks** (`buffer = lines.pop() ?? ''`) — the same bug class the worker review caught is avoided here from day one.
- ✅ `AIUseCase` is derived as `(typeof AI_USE_CASES)[number]` from a single `as const` array — runtime list and compile-time union come from one source. Good DRY pattern within the SDK.
- ✅ Async iterator (`Symbol.asyncIterator`) + `toText()` helper covers both per-chunk and buffered consumers.
- ✅ `BuilderforceApiError` class carries `status`, `code`, `details` from server JSON; thrown on non-2xx. Tested.
- ✅ Streaming overload typing on `ChatCompletionsApi.create` distinguishes return shape by literal `stream: true` vs omitted/`false`.
- ✅ Tests cover all three APIs, both streaming code paths, the error class, and the AIUseCase guard. No integration tests (acceptable for v0.1).
- ✅ Workforce routing left to server — caller passes `model: 'builderforce/workforce-<id>'`, no SDK-side branching.

#### 🔴 Critical (blocks burnrateos / hired.video migration)

| # | Finding |
|---|---|
| **C1** | **`useCase` is dead on arrival end-to-end.** SDK accepts and serializes `useCase: AIUseCase`. Test `index.test.ts:45` even verifies `body.useCase === 'ide.chat'` is sent over the wire. **But `api/src/presentation/routes/llmRoutes.ts:305-334` never reads `useCase` from the request body** — it does `service.complete(body)` which ignores the field. `LlmProxyService.completeForUseCase` exists but is never called by `/v1/chat/completions`. So the entire use-case-routing feature (the whole point of step 1e — the registry of 50 use cases with preferred chains, max_tokens, temperatures) is unreachable from SDK callers. Migrating burnrateos with `useCase: 'coach.chat'` or hired.video with `useCase: 'match'` would silently fall through to the default Free pool with default temperature/max_tokens — defeating the cascade. **Fix:** in `/v1/chat/completions`, branch on `body.useCase`: if present and `isAIUseCase(body.useCase)`, call `service.completeForUseCase(body.useCase, body)`; otherwise call `service.complete(body)`. The SDK side already does the right thing. |

#### 🟠 High

| # | Finding |
|---|---|
| **H1** | **`AI_USE_CASES` array is duplicated** between `sdk/src/domain/aiUseCases.ts` and `api/src/application/llm/aiUseCases.ts`. Comment line 1 of the SDK file admits it: `// Keep this list aligned with api/src/application/llm/aiUseCases.ts.` Manual sync = guaranteed drift. Either set up a pnpm/npm workspace and have api import the array from `@builderforce/sdk`, OR generate one from the other on build. Until then, add a CI check that asserts the two arrays match. |
| **H2** | **No request timeout.** `HttpClient.fetch` has no `AbortSignal`. A hung connection blocks the caller indefinitely. Add an `AbortController` with a configurable default (~60s), exposed via `BuilderforceClientOptions.timeoutMs`. |
| **H3** | **`sdk/dist/` is committed to the repo.** Built artifacts in version control — `dist/index.cjs`, `dist/index.mjs`, source maps, `.d.ts`, `.d.cts` all live in git. `prepublishOnly` already builds; npm publishes from `files: ["dist"]`. Add `dist/` to `.gitignore` and remove from history. (Side effect: shrinks PR diffs significantly.) |

#### 🟡 Medium

| # | Finding |
|---|---|
| **M1** | **No `README.md` in `sdk/`.** Required for npm publish (it's what shows on npmjs.com). At minimum: install, quickstart, streaming example, error handling, env var conventions. |
| **M2** | **`BuilderforceApiError` doesn't expose `requestId`.** The api emits `x-request-id`; the frontend already plumbs this into its own error events. SDK callers should be able to surface it for support. Add `requestId?: string` from `res.headers.get('x-request-id')`. |
| **M3** | **Empty `apiKey` accepted at construction.** `new BuilderforceClient({ apiKey: '' })` succeeds; failure happens at first request. Throw at construction time with a clear message. |
| **M4** | **`stream` overload is a literal-type discriminator.** `client.chat.completions.create({ stream: someBool, ... })` collapses to the non-stream return type because `someBool: boolean` doesn't match the literal `true` overload. Either document that callers must pass `stream` as a literal, or restructure into two methods (`create(...)` and `createStream(...)`). |
| **M5** | **No retry/backoff helper.** Server-side cascade absorbs most transient failures, but raw network errors and post-cascade 429s bubble up to the caller. Document the expectation, or add an opt-in `maxRetries` config. |

#### 🟢 Low / notes

| # | Finding |
|---|---|
| **L1** | `parseSseJson` only handles `data:` lines; ignores `event:`, `id:`, `retry:`, comments. Today the api emits only `data:` so this works — flag if a typed-event SSE channel is added later. |
| **L2** | No integration tests against a real local api server. Mocked-fetch only. Acceptable for v0.1; track for v0.2. |
| **L3** | `index.test.ts:45` asserts `useCase` is wire-sent — a green light that **masks** C1. Once C1 is fixed, also assert against a fixture response that the resolved model matched the use-case's preferred chain (or remove the standalone "useCase is sent" assertion since C1's fix makes it semantic, not just structural). |
| **L4** | `tsconfig.json` includes `types: ["node", "vitest/globals"]`. Verify the published `.d.ts` doesn't leak `Buffer`/`process` symbols into consumer surfaces. Quick check: `tsc --noEmit` against a strict consumer project. |

#### Action items before tenant migrations begin

1. **(C1)** Wire `useCase` reading on `/v1/chat/completions` so `service.completeForUseCase(body.useCase, body)` is invoked when the caller specifies a use case. Add an api-side test that verifies the resolved model matches the use-case's preferred chain.
2. **(H1)** Decide on workspace-vs-codegen for sharing `AI_USE_CASES`. Add CI sync check until then.
3. **(H2, H3, M3)** Quick wins: add timeout, `.gitignore dist/`, throw on empty apiKey.
4. **(M1)** README before publish.

Verdict: foundation is solid; ship the C1 fix and this SDK is ready for hired.video / burnrateos to consume.

#### C1 fix review (2026-05-04)

**Fix landed** in `api/src/presentation/routes/llmRoutes.ts` + new `api/src/presentation/routes/llmRoutes.test.ts`.

What's right:
- ✅ Pure dispatcher `completeChatRequest(service, body)` named-exported for testability — no Hono dependency, single decision point. Won't be duplicated elsewhere (DRY).
- ✅ Uses canonical `isAIUseCase` guard from `application/llm/aiUseCases.ts` — no string-literal contamination.
- ✅ Both branches tested (registered useCase routes through `completeForUseCase`; unknown/missing falls back to `complete`).
- ✅ `LlmProxyService` import added cleanly to the existing import block; no transitive bloat.
- ✅ Forward-compatible: callers on older SDK versions won't break if the registry grows server-side.

Residual issues:

| # | Severity | Finding |
|---|---|---|
| **C1.fix.1** | ✅ Fixed | `LlmProxyService.STANDARD_BODY_FIELDS` now includes `'useCase'`, so `stripStandardFields` no longer forwards it to vendor payloads. |
| **C1.fix.2** | 🟢 Low (policy decision) | **Silent fallback on unknown useCase.** A typo like `useCase: 'coach.chat.v2'` quietly routes through default `complete()` instead of `completeForUseCase`. Test on line 41-60 codifies this. Pro: forward-compat. Con: a tenant migrating with a typo gets the wrong chain forever and never finds out. Choice: keep silent OR log a `console.warn` OR return 400 with a list of valid use cases. **Pick a policy and document.** |
| **C1.fix.3** | 🟢 Low | The new test mocks `completeForUseCase` / `complete` and only asserts which one was called. It does NOT verify that the resolved model actually came from the use-case spec's `preferredChain`. The dispatcher itself is well-tested; an end-to-end "useCase X resolves to model Y from spec.preferredChain[0]" assertion would catch regressions if `completeForUseCase` ever drifts. Optional. |

#### SDK follow-up status (H1–H3, M1–M3)

| Item | Status |
|---|---|
| H1 — `AI_USE_CASES` workspace-share / codegen | ✅ Addressed via CI guard: `sdk/scripts/check-usecases-sync.mjs` + `npm run check:usecases` + CI workflow step |
| H2 — Fetch timeout / `AbortController` | ✅ Addressed: `timeoutMs` option on `BuilderforceClient`/`HttpClient` (default 60s), timeout abort + typed timeout error |
| H3 — `sdk/dist/` committed; need `.gitignore` | ✅ Addressed: `sdk/dist/` ignored; committed dist artifacts removed from working tree |
| M1 — `sdk/README.md` | ✅ Addressed (`sdk/README.md` added with install/usage/streaming/errors) |
| M2 — `requestId` on `BuilderforceApiError` | ✅ Addressed (`requestId` captured from `x-request-id`) |
| M3 — Throw on empty `apiKey` at construction | ✅ Addressed (`BuilderforceClient` validates non-empty key) |

#### Net assessment

C1 is fully fixed (`useCase` routes + no vendor payload leak). C1.fix.2 policy choice (silent fallback vs warn/400 on unknown useCase) remains optional and does not block tenant migrations.

#### Step 2 cleanup review (2026-05-04, second pass)

| Item | Verdict | Notes |
|---|---|---|
| C1.fix.1 — `useCase` in `STANDARD_BODY_FIELDS` | ✅ Pass | One-line addition at `LlmProxyService.ts:434`. `useCase` no longer leaks into `extraBody` and onto vendor payloads. |
| H1 — AI_USE_CASES sync guard | ✅ Pass with caveat | `sdk/scripts/check-usecases-sync.mjs` regex-extracts both lists and exit-codes on mismatch; wired into `npm test` and a dedicated CI job. **Caveat:** the api-side regex (`/export type AIUseCase\s*=\s*([\s\S]*?);/`) extracts from the union literal — if the api ever refactors to mirror the SDK's `(typeof AI_USE_CASES)[number]` pattern, the regex finds nothing. Fragile by intent but acceptable as a transitional check. Real fix is shared workspace package (still tracked). |
| H2 — Fetch timeout | ✅ Pass with one stream caveat | `fetchWithTimeout` wraps every request with `AbortController`; 60s default; configurable via `timeoutMs`; throws `BuilderforceApiError(408, 'timeout')`. Test added. **Caveat:** the timeout bounds **total** request duration, including streaming bodies. A 60s+ generation will be aborted mid-stream. For streams the timeout should bound time-to-first-byte, not total. Document or split into `connectTimeoutMs` vs `streamTimeoutMs`. |
| H3 — `sdk/dist/` ignored | ✅ Pass | Root `.gitignore` includes `sdk/dist/`; prior committed artifacts removed in commit `28dc200`. |
| M1 — README | ✅ Pass | Covers install, quickstart, non-stream/stream chat, models, usage, errors (with `error.requestId`), auth, AIUseCase guard. |
| M2 — `requestId` on errors | ✅ Pass | `BuilderforceApiError.requestId` populated from `x-request-id`; test asserts. |
| M3 — Empty `apiKey` throws at construction | ✅ Pass | `apiKey?.trim()` rejects empty/whitespace and now throws **`BuilderforceApiError(400, 'missing_api_key')`** for typed-error consistency with the rest of the SDK surface. Test rewritten to `instanceof`-assert and check `status` + `code`. |

### Step 3 — `AgentTransport` in coderClaw

Per the architecture: claws coordinate **both** local (peer on one machine) **and** remote (through builderforce orchestrator).

| Item | Notes |
|---|---|
| Interface | `AgentTransport.dispatch(taskId, payload) → result`, `register(claw)`, `discover()` |
| Local impl | In-process / IPC for two claws on the same box |
| Remote impl | WS/HTTP through `api.builderforce.ai` (uses `BUILDERFORCE_API_KEY`) |
| Existing files to consolidate (DRY) | `src/coderclaw/orchestrator.ts`, `src/infra/remote-subagent.ts`, `src/coderclaw/tools/claw-fleet-tool.ts` should all become callers of one `AgentTransport` |
| Naming nit | `remote:<id>` prefix should keep its meaning (cross-network); add `local:<id>` for in-machine — flagged in chat earlier |

#### Step 3 progress update (current chat)

- Added `IAgentTransport` domain port with `discover` + `dispatch` contract in `coderClaw`.
- Added `BuilderforceAgentTransport` infra implementation that centralizes remote fleet discovery (`/api/claws/fleet`) and remote task dispatch (`/api/claws/:id/forward`), including `remote:auto[...]` capability routing.
- Refactored orchestrator remote execution to use `agentTransport` (with backward-compatible fallback to `remoteDispatcher`).
- Refactored `claw_fleet` tool to use the same transport abstraction instead of duplicating direct fleet HTTP calls.
- Exported/shared fleet fetch logic in `remote-subagent.ts` (`fetchFleetEntries`) so transport + adapters reuse one path.

#### Step 3 code review (2026-05-04)

✅ **Cleanup landed (2026-05-04).** All Step 3 review findings addressed in this chat — see "Step 3 cleanup results" below. Original review left in place for audit history.

🟡 **Original verdict (superseded):** The transport abstraction is correct; the migration is half-done and visibly violates the DRY rule the project pins on every prompt — two near-identical remote-dispatch blocks now coexist in `orchestrator.ts`, and capability-routing logic is duplicated across `BuilderforceAgentTransport.dispatch` and the orchestrator's legacy block.

Files reviewed (all in `c:/code/agentic/coderClaw/product/src/`):

- `coderclaw/ports.ts` — new `IAgentTransport`, `AgentTransportEntry`, `AgentTransportDispatchPayload`, `AgentTransportDispatchResult`, `AgentTransportKind`
- `infra/agent-transport.ts` — new `BuilderforceAgentTransport` (83 LOC)
- `infra/remote-subagent.ts` — extracted `fetchFleetEntries` from `selectClawByCapability`
- `coderclaw/orchestrator.ts` — added `agentTransport` field, configure key, deprecated shim, dual-mode dispatch block
- `coderclaw/tools/claw-fleet-tool.ts` — replaced direct `fetch` with `BuilderforceAgentTransport.discover()`
- `gateway/server-startup.ts` — wires both `agentTransport` and `remoteDispatcher` at startup

##### What's right

- ✅ `IAgentTransport` is correctly typed: discriminated-union `accepted | failed` result, `kind: "local" | "remote"` on entries, optional `register` for discovery-only transports.
- ✅ `BuilderforceAgentTransport.discover` filters self (`String(entry.id) !== String(myClawId)`) and applies capability filtering in one place.
- ✅ `fetchFleetEntries` extraction in `remote-subagent.ts` is the right move — single HTTP source for fleet data.
- ✅ Backward compat preserved: orchestrator falls through to `remoteDispatcher` when `agentTransport` is unset.
- ✅ Failure path symmetric: both transport and legacy paths set `task.status = "failed"`, emit telemetry, persist workflow, throw.

##### 🟠 High — DRY violations the project's own rule blocks

| # | Finding |
|---|---|
| **O1** | **Two near-identical remote-dispatch blocks** in `orchestrator.ts:521-540` (transport path) and `542-559` (legacy path). Both: dispatch → check `status !== "accepted"` → fail-and-throw OR mark completed → set `taskResults` → emit telemetry → persist → return output. The DRY rule pinned on every prompt says: *"If the same logic shows up in 2+ places, extract a shared component / function."* This is exactly that. Recommendation: wrap `RemoteAgentDispatcherAdapter` to implement `IAgentTransport` (one extra adapter file), then the orchestrator has **one** dispatch block and the legacy branch is deleted. Removes ~25 LOC and the duplication. |
| **O2** | **Capability-routing logic exists in two files.** `BuilderforceAgentTransport.dispatch:39-60` parses `auto[caps]` and selects an online peer. `orchestrator.ts:481-501` parses the same string format and calls `remoteDispatcher.selectByCapability`. When `agentTransport` is wired (production path) only the first runs, but both code paths exist. Same DRY violation — closing O1 closes this too. Worst case: the parsing format drifts between the two locations. |
| **F1** | **`claw-fleet-tool.ts` does a lossy shape round-trip.** Lines 90-98 take the `discover()` result and rebuild it as a `FleetEntry`-shaped object, filling `slug: ""`, `connectedAt: null`, `lastSeenAt: null` as placeholders. Those fields existed on the original API response (`FleetEntry`) but `AgentTransportEntry` dropped them, so the tool now reports nulls where it used to report real data. **Fix:** add `slug?, connectedAt?, lastSeenAt?` as optional fields on `AgentTransportEntry` and populate them in `discover()`. No more lossy round-trip. |

##### 🟡 Medium

| # | Finding |
|---|---|
| **F2** | **`claw-fleet-tool` `total` and `online` counts changed semantics.** Previously: `total = data.fleet.length`, `online = data.fleet.filter(c => c.online).length` over the **un-filtered** fleet. Now: both computed on `discovered` which has self **excluded** and capability-filtered. So a tenant with 3 claws (1 self + 2 peers, both with `lint` capability) calling `claw_fleet { requireCapabilities: ["python"] }` previously saw `total: 3, online: N, filtered: 0`; now sees `total: 0, online: 0, filtered: 0`. Subtle behavior regression — affects diagnostics. **Fix:** either keep the historical semantics by querying `fetchFleetEntries` directly in the tool for the totals, or document the new semantics in the tool's description. |
| **S1** | **Dead-code-rule violation in waiting in `server-startup.ts`.** Both `agentTransport` AND `remoteDispatcher` are configured every startup. Once O1 is fixed, `remoteDispatcher` becomes pure dead weight. The cleanup rule pinned at the top of every prompt says delete code with no callers. Recommend: track O1 with a removal date; once shipped, delete `RemoteAgentDispatcherAdapter`, `setRemoteDispatcher`, the `remoteDispatcher` config key, and `IRemoteAgentDispatcher`. |

##### 🟢 Low

| # | Finding |
|---|---|
| **C2.3** | `BuilderforceAgentTransport.dispatch` only handles `remote:` prefix. The `IAgentTransport` interface implies both `local` and `remote` kinds, but the only implementation is remote-only. Acceptable for now (a `LocalAgentTransport` is a separate task), but worth a class-level comment so the next implementer knows. |
| **C2.4** | `dispatch(_taskId, payload)` — `taskId` is unused (prefixed). Either remove from the interface or wire it for telemetry/audit. Lean toward removing unless there's a near-term plan to use it. |
| **C2.6** | `agent-transport.ts:78-80` swallows `awaitRemoteResult` failures silently (`catch {}`) and returns `{ status: "accepted", targetId }` with no `output`. The orchestrator falls back to a placeholder string. Caller can't distinguish "task running" from "result fetch timed out" in the result envelope. Add `logDebug` on the catch for parity with the legacy path's behavior. |
| **R1** | `fetchFleetEntries` returns `[]` on error; `selectClawByCapability` continues to return `null`. Two error sentinels in two layers (empty array → null). Acceptable; document. |

##### Step 3 follow-up checklist

1. **(O1, O2, S1)** Wrap `RemoteAgentDispatcherAdapter` to implement `IAgentTransport`. Delete the dual-mode dispatch in orchestrator. Delete `remoteDispatcher` port/config/setter. **This is the big DRY win and unblocks dead-code removal.**
2. **(F1)** Add optional `slug`, `connectedAt`, `lastSeenAt` to `AgentTransportEntry`; populate in `BuilderforceAgentTransport.discover`.
3. **(F2)** Decide: keep historical `total`/`online` semantics in `claw_fleet` tool (query raw fleet), OR update the tool's description to reflect new post-filter semantics.
4. **(C2.4)** Remove `taskId` from `IAgentTransport.dispatch` if no near-term use.
5. **(C2.6)** Add `logDebug` on the swallowed `awaitRemoteResult` error.
6. **(Stream timeout)** SDK side: either document the total-stream-timeout behavior or split `connectTimeoutMs`/`streamTimeoutMs`.

Net assessment: **functionally correct, but the DRY rule the project enforces is currently being violated by the dual-path orchestrator.** The follow-up that closes O1 is small (one adapter file + ~25 LOC removal) and would bring this section into full compliance.

#### Step 3 cleanup results (2026-05-04, this chat)

All findings from the review above are closed. Verified by `npx tsc --noEmit` clean across api / sdk / coderClaw, and `npm test` green on api (5/5) and sdk (9/9 + use-case sync check).

| # | Status | What was done |
|---|---|---|
| O1, O2, S1 | ✅ Closed | Collapsed the dual-mode orchestrator. Single dispatch block. The legacy `IRemoteAgentDispatcher` port was deleted from `ports.ts` along with its `RemoteDispatchResult` type; `RemoteAgentDispatcherAdapter` deleted from `orchestrator-ports-adapter.ts`; `setRemoteDispatcher` shim and `remoteDispatcher` field/config key deleted from orchestrator; `server-startup.ts` no longer imports/configures the legacy adapter. Capability-routing now lives only in `BuilderforceAgentTransport.dispatch` (with `parseAutoTarget` extracted as a single shared helper for the auto-target syntax). Net deletion: ~80 LOC across 4 files. |
| F1, F2 | ✅ Closed (different fix than proposed) | The proposed fix was to add `slug?, connectedAt?, lastSeenAt?` to `AgentTransportEntry`. Better: the `claw_fleet` tool is a **diagnostic** that wants the un-filtered fleet (including self) for `total`/`online` accuracy. Moved it back to call `fetchFleetEntries` directly — fleet data flows un-mangled through `FleetEntry` (slug/connectedAt/lastSeenAt preserved), `total`/`online` count over the full tenant view (historical semantics restored), `filtered` reflects post-filter count. Transport abstraction is left for *dispatch*, not diagnostics. |
| C2.4 | ✅ Closed | `IAgentTransport.dispatch(payload)` — `taskId` parameter removed from interface, transport, and orchestrator call site. |
| C2.6 | ✅ Closed | `agent-transport.ts:awaitRemoteResult` catch now `logDebug`s the correlation id + error before falling back to "result pending" envelope. |
| C2.3 | ✅ Closed (subsequent chat) | `LocalAgentTransport` shipped in `product/src/infra/local-agent-transport.ts`; routes `local:<role>`, `local:auto`, `local:auto[caps]`, and bare role names through `spawnSubagentDirect` + `localResultBroker`. `discover()` enumerates built-in roles + persona registry. |
| Dead-code sweep | ✅ Closed | `selectClawByCapability` (zero callers after adapter deletion) deleted from `remote-subagent.ts`; file-level docstring updated to describe its actual responsibilities. |

**SDK side cleanup landed in the same chat:**

| # | Status | What was done |
|---|---|---|
| M3 nit | ✅ Closed | `BuilderforceClient` now throws `BuilderforceApiError(400, 'missing_api_key')` (was plain `Error`). Test rewritten to assert `instanceof` + `status` + `code`. |
| C1.fix.2 (unknown useCase policy) | ✅ Closed | Picked **silent + warn**: `completeChatRequest` now `console.warn`s with the offending value and a remediation hint when `useCase` is set but unregistered, then falls back to default pool dispatch. Forward-compatible (older servers don't reject newer use cases) AND visible in logs (typos surface). |

**Verification:**
```
api/    npm run type-check  ✓   npm test  ✓ (5/5)
sdk/    npm run type-check  ✓   npm test  ✓ (9/9 incl. usecases-sync)
coderClaw/product  npx tsc --noEmit  ✓ (no diagnostics)
```

Step 3 now complies with the DRY + dead-code rules. **Net diff: ~80 LOC removed, 0 LOC duplicated.**

#### Step 3 completion: local transport + tests (2026-05-04, this chat)

A subsequent reviewer flagged that `local:<id>` was still unimplemented — the `IAgentTransport` interface modeled `local + remote` but only the remote impl shipped, so a `local:<role>` agentRole fell through to `findAgentRole` and failed. **All three findings closed:**

| Finding | Status | Resolution |
|---|---|---|
| **High** — `local:<id>` not implemented; orchestrator has no transport handling for it | ✅ Closed | New `LocalAgentTransport` (`product/src/infra/local-agent-transport.ts`) wraps `spawnSubagentDirect` + `localResultBroker.awaitResult` behind `IAgentTransport`. Orchestrator's dispatch is now **single-path**: pre-dispatch relay-context fetch (remote-only, non-auto) followed by one `agentTransport.dispatch(...)` for local + remote + unprefixed (defaulted to local). |
| **Medium** — interface modeled local+remote but impl was remote-only | ✅ Closed | `LocalAgentTransport` ships alongside `BuilderforceAgentTransport`. New `CompositeAgentTransport` (`product/src/infra/composite-agent-transport.ts`) routes by prefix: `remote:` → remote, `local:` or bare → local. `transportKindForTarget` is the single source for prefix→kind resolution (DRY). |
| **Medium** — no transport-specific tests | ✅ Closed | `product/src/infra/agent-transport.test.ts` — 23 tests across `parseAutoTarget`, `transportKindForTarget`, `BuilderforceAgentTransport` (auto-routing, no-peer-failure, pending-fallback w/ logDebug, rejection propagation), `LocalAgentTransport` (discover/built-ins/capability-filter/dispatch-success/auto/unknown-role/spawn-fail), `CompositeAgentTransport` (remote routing / local routing / bare-role-as-local / missing-kind error / merged discover). |

**DRY + dead-code follow-through:**

- `OrchestratorConfig` lost the now-unused `localResultBroker` key (the broker is construction-injected into `LocalAgentTransport` instead of stashed on the orchestrator). Field, deprecated `setLocalResultBroker` shim, and `ILocalResultBroker` import all swept from `orchestrator.ts`. Server-startup wires the broker straight to the transport.
- New `currentSpawnContext()` getter on `AgentOrchestrator` exposes the active per-task spawn context to the local transport via a closure (no circular construction; serialized by the orchestrator's serial executeTask loop).
- `AgentTransportDispatchResult` now carries an optional `childSessionKey` so the orchestrator can preserve subagent-session tracking through the unified path.

**Wiring (server-startup.ts):**
- `startOrchestrator` always wires a `LocalAgentTransport` inside a `CompositeAgentTransport({ local })`. Local dispatch works without any credentials.
- `startBuilderforceServices` upgrades the composite to `{ local, remote }` once `BUILDERFORCE_API_KEY` + `clawId` are loaded.

**Verification (post-completion):**
```
coderClaw/product  npx tsc --noEmit  ✓
coderClaw/product  npx vitest run     ✓  919 files / 8000 tests passed / 25 skipped / 0 failed
api/, sdk/         re-verified clean  ✓
```

Net Step 3 diff (vs. pre-cleanup baseline): ~110 LOC removed, ~280 LOC added (LocalAgentTransport + CompositeAgentTransport + tests), zero duplicated logic.

#### Pre-existing flake fixed alongside (2026-05-04)

Full-sweep `vitest run` surfaced a **pre-existing race** in `infra/remote-result-broker.test.ts` (3 failures across 2 tests). Diagnosis: `awaitRemoteResult` did `await acquireSlot()` even on the fast path — the `await` introduced a microtask boundary, so `pending.set(...)` ran *after* the function returned. Tests that called `resolveRemoteResult(...)` or `pendingRemoteCount()` synchronously after `awaitRemoteResult(...)` saw the entry not-yet-registered.

Unrelated to Step 3 work, but blocking the green-build claim, so fixed in the same chat:

- `awaitRemoteResult` now registers `pending` **synchronously** on the fast path. Slow-path (queue-when-full) registration runs on slot release.
- Extracted `registerPending(...)` as the single source of timeout + entry registration (DRY — was previously inlined in the slow path implicitly via the await chain).
- Deleted `acquireSlot()` — no callers after the inlining (dead-code rule).

Result: `remote-result-broker.test.ts` 4/4 green, deterministic.

---

## 5. Migration plan — burnrateos.com and hired.video

Once Step 2 is published:

1. **Add the SDK as a dependency.** `pnpm add @builderforce/sdk`
2. **Add `BUILDERFORCE_API_KEY` env var.** No other config required.
3. **Replace local LLM modules with SDK calls:**
   - **burnrateos:** delete `product/api/src/worker/services/aiVendors/` (port already absorbed into Builderforce). Replace `dispatchVendor()` calls with `client.chat.completions.create({ useCase, messages })`. Use-case strings already match (e.g. `coach.chat`, `studio.compose`).
   - **hired.video:** delete `api/src/services/adapters/llm-client.ts`, `ai.ts`, `providers.ts`, `openai-compat.ts`. Replace `aiCall()` orchestrator with the SDK. Use-case strings already supported (`match`, `match_tailor`, `resume_roast`, etc.).
4. **Verify usage tracking lands in Builderforce's `llm_usage_log`** instead of the apps' own tables.
5. **Decommission per-tenant `OPENROUTER_API_KEY` secrets** in burnrateos / hired.video — the gateway has them now.

---

## 6. Open issues / decisions

1. **Worker `/api/ai/chat` callers** — verified: frontend IDE AI traffic goes to `api.builderforce.ai`; worker `/api/ai/chat` removed.
2. **Backwards-compat horizon for `coderclawllm/workforce-<id>`** — keeping both prefixes works today; should set a deprecation date and remove the legacy regex branch.
3. **Old `llm_product='coderClawLLM'` rows** — leave as-is (data integrity) or run a one-shot UPDATE migration to rename. `/v1/usage` will show two product names side-by-side until aged out.
4. **Frontend consumption of headers/envelope** — need to grep for `x-coderclaw-` / `_coderclaw` in any UI that displays model attribution. Likely lives in `TokenUsageCard.tsx` or the admin LLM panel.
5. **`wrangler.toml` secrets list** — confirm `CEREBRAS_API_KEY` and `OLLAMA_API_KEY` are added to the production secret set (`api/scripts/set-secrets-from-env.mjs` updated).
6. **Service-internal auth lane** for worker→api calls — currently avoided by forwarding caller JWT/`clk_*` to the gateway; revisit only if a non-user-triggered backend flow is introduced.
7. **Embeddings endpoint** — `embed.text` use case is registered but `preferredChain` is empty; no vendor wired yet. Decide whether to add an `/v1/embeddings` route + a separate `VendorModule.embed()` method, or punt to a later phase.
8. **Vision capability** — registered (`vision.describe`, `ocr.extract`) but no payload helper for image inputs; current `messages` shape is text-only. Add multimodal support before customers consume.

---

## 7. Files created (Step 1)

```
api/src/application/llm/
├── vendors/
│   ├── types.ts          # NEW — VendorModule, error classes, executeChatCompletion(+Stream)
│   ├── openrouter.ts     # NEW
│   ├── cerebras.ts       # NEW
│   ├── ollama.ts         # NEW
│   ├── registry.ts       # NEW — dispatchVendor + dispatchVendorStream
│   └── index.ts          # NEW — barrel
├── aiUseCases.ts         # NEW — AIUseCase + AI_USE_CASES (50 use cases)
└── LlmProxyService.ts    # REWRITTEN — multi-vendor, ideProxy/adminPoolProxy/llmProxyForPlan factories
```

## 8. Files edited (Step 1)

```
api/src/env.ts                                    # +CEREBRAS_API_KEY, +OLLAMA_API_KEY, comment refresh
api/src/index.ts                                  # comment rename
api/src/infrastructure/database/schema.ts         # default 'coderClawLLM' → 'builderforceLLM'
api/src/application/brain/BrainService.ts         # uses ideProxy()
api/src/presentation/routes/llmRoutes.ts          # llmProxyForPlan, header/envelope rename, DRY
api/src/presentation/routes/ideAiRoutes.ts        # ideProxy(), accepts both workforce prefixes
api/src/presentation/routes/ideRoutes.ts          # 3 sites → ideProxy(), workforce model_ref rename
api/src/presentation/routes/adminRoutes.ts        # poolStatus() helper, productName rename
```

## 9. Memory updates (already applied)

- `MEMORY.md` no longer references `coderClawLink`
- Stale `src/infra/clawlink-relay.ts` reference removed
- Builderforce architecture clarified: agent builder + orchestration + LLM gateway
- Claw-to-claw mesh model: **both** local (peer on one box) **and** remote (through builderforce)
- Auth: API-key only, no SSO
- Billing: B2B tenant

---

## 10. Code Review — Step 1h (rejected)

**Verdict:** ⛔ Reject — implementation does not meet the goal.

### 10a. Closure update (post-rejection redo)

✅ Redo implemented on 2026-05-04. The rejected implementation remains documented below for audit history, but its blocking items have been addressed in code:

- duplicate proxy removed (`worker/src/services/llmVendors.ts` deleted)
- dataset + training judge migrated to gateway
- inbound auth required on worker LLM-triggering routes
- internal tenant-header lane removed from API `/llm` auth
- non-stream gateway calls used for eval generation/judge paths
- dead worker AI-provider env removed; `BUILDERFORCE_API_BASE_URL` added to worker `[vars]`

The stated objective of Step 1h was *"Eliminate the worker's duplicate AI proxy."* Instead, the duplicate proxy was **renamed** (`worker/src/services/ai.ts` → `worker/src/services/llmVendors.ts`) and **kept**, with two callers (`services/dataset.ts`, `services/training.ts`) still calling its outdated round-robin OpenRouter logic. The file rename gives the appearance of consolidation while preserving the duplication this step was meant to remove. The partial migration that did happen introduces a publicly callable spend endpoint and a fragile auth lane.

### 🔴 CRITICAL

#### C1. Duplicate AI proxy still exists — just renamed
`worker/src/services/llmVendors.ts` is `services/ai.ts` with a new filename. Same `FREE_MODELS` list (lines 7–14) — and notably the **stale** model list (`llama-3.1-8b-instruct:free`, `llama-3.2-3b-instruct:free`, `gemma-3-4b-it:free`, etc.) that diverges from the canonical `openRouterModule.catalog` we just established as the single source of truth. Same `getNextModelIndex` round-robin (lines 28–32). Same `streamOpenRouter` failover that only checks status 429 and lacks the embedded-error-in-200 detection that `LlmProxyService` has.

Live callers that bypass the gateway:
- `worker/src/services/dataset.ts:1` imports `OPENROUTER_ENDPOINT, FREE_MODELS, getNextModelIndex` and rolls its own loop (line 74-).
- `worker/src/services/training.ts:1` imports `streamOpenRouter, streamCloudflareAI` and calls them at line 98 / 100 inside `evaluateModelOutputs` — the **judge** half of the evaluation pipeline.

**Fix:** Delete `llmVendors.ts` outright. Migrate `dataset.ts:generateDatasetWithAI` and `services/training.ts:evaluateModelOutputs` to call the gateway via the same `streamThroughGateway` helper that `routes/training.ts` uses (or extract that helper to a shared `services/gateway.ts`). After migration, `AI`, `OPENROUTER_API_KEY`, and `AI_PROVIDER` env entries in `worker/src/index.ts:16-26` become dead code and should be deleted along with `streamCloudflareAI`/`streamOpenRouter`.

#### C2. Worker `/api/training/:id/evaluate` is a publicly callable spend endpoint
`worker/src/index.ts:32-36` sets `cors origin: '*'`. `routes/training.ts` has **no auth middleware** on any route. Anyone on the internet can `POST /api/training/<any-id>/evaluate`, which now triggers `streamThroughGateway` calls authenticated by `BUILDERFORCE_INTERNAL_API_KEY` and billed to `BUILDERFORCE_INTERNAL_TENANT_ID`. There is no upper bound on spend.

Pre-Step-1h, the worker's AI calls were also unauthed but used the worker's own OpenRouter key — same risk class but at least the bypass-billing wasn't pretending to be a tenant. Now it bills the configured tenant.

**Fix:** Add tenant auth (JWT or `clk_*` claw key) on `routes/training.ts` BEFORE calling `streamThroughGateway`. The internal-key + default-tenant pattern is acceptable only for trusted backend-to-backend calls — never for endpoints reachable from the public CORS surface.

#### C3. Internal auth lane trusts a header-claimed tenant id with no validation
`api/src/presentation/routes/llmRoutes.ts:106-142` accepts the internal key and reads tenant id from `x-builderforce-internal-tenant-id`. Whoever holds the key can claim any tenant. Combined with C2, this means a leaked internal key allows arbitrary cross-tenant impersonation with full plan privileges.

Even if the worker is locked down, this is a god key — there should be at least a defense-in-depth allowlist of which tenants the internal lane is allowed to claim, or pin the lane to one tenant via env and reject the header entirely.

**Fix:** Drop the `x-builderforce-internal-tenant-id` header path. Use only `BUILDERFORCE_INTERNAL_TENANT_ID` from env (one internal caller, one tenant). If you eventually need multi-tenant internal calls, gate via a tenant-allowlist or migrate to per-tenant `clk_*` keys minted for service callers.

### 🟠 HIGH

#### H1. String-equality token comparison on the internal key
`llmRoutes.ts:110`: `if (internalKey && token === internalKey)`. Not constant-time.

**Fix:** Hash the configured key (e.g. SHA-256) and compare hashes; or use `crypto.subtle.timingSafeEqual` with both values run through a TextEncoder. Same approach the existing `clk_*` path uses (`hashSecret(token)` + DB lookup).

#### H2. Internal lane bypasses plan daily token limits — no rate limiting at all
The plan-level cap check at `llmRoutes.ts:312-313` still applies to internal callers (good), BUT the per-claw cap doesn't (the lane sets `clawId: null`), and there's no separate internal-caller cap. A runaway worker loop can drain the entire plan-day budget for the configured tenant.

**Fix:** Add an internal-lane daily token cap via env (`BUILDERFORCE_INTERNAL_DAILY_TOKEN_CAP`) enforced before dispatch, defaulting to a low ceiling (say 100K tokens/day).

#### H3. Half-migration: only the "act as fine-tuned agent" output goes through the gateway; the judge call still bypasses
`routes/training.ts:378` calls `streamThroughGateway` for output generation, but immediately after at `routes/training.ts:415` it calls `evaluateModelOutputs` (in `services/training.ts`) which makes its OWN `streamOpenRouter` call (line 98). One of two AI calls in this endpoint is metered/billed; the other isn't.

**Fix:** Migrate `evaluateModelOutputs` to the gateway too (same fix as C1).

#### H4. SSE consumer drops tokens at chunk boundaries
`routes/training.ts:386-407`: the inner loop does `for (const line of text.split('\n'))` per chunk with no buffering of partial trailing lines. When a chunk arrives mid-line (e.g. ends with `data: {"choices":[{"delta":{"content":"hel`), that fragment is JSON.parsed and silently dropped, then the next chunk starting with `lo"}}]}` is also silently dropped. Both halves are tossed.

The same bug exists at `services/training.ts:114-129`.

**Fix:** Use a line-buffering pattern (carry leftover into next iteration). Reference: `frontend/src/lib/api.ts:259-266` already does this correctly — `let buffer = ''; ... buffer += decoder.decode(...); const lines = buffer.split('\n'); buffer = lines.pop() ?? '';`.

#### H5. `useCase: 'train.evaluate'` sent to gateway — but there's no such use case AND `/v1/chat/completions` doesn't read `useCase`
`routes/training.ts:42` sends `useCase: 'train.evaluate'`. The canonical use-case registry uses dotted-path names — and the closest registered name is `training.dataset_evaluate`, not `train.evaluate`. Either way, the `/v1/chat/completions` route doesn't currently accept a `useCase` field; it just calls `service.complete(body)` which ignores it. Dead on arrival.

**Fix:** Drop the field for now. If/when the endpoint adds useCase support, wire the worker to send `'training.dataset_evaluate'` exactly.

### 🟡 MEDIUM

#### M1. `BUILDERFORCE_API_BASE_URL` documented but never configured anywhere
`worker/src/routes/training.ts:10` declares it on Env. `worker/src/index.ts:24` documents it. Default is `https://api.builderforce.ai`. Not in `wrangler.toml [vars]`, not in `set-secrets-from-env.mjs`, not in `.dev.vars`. Local dev defaults to production for an internal-traffic call — easy to leak dev test traffic to production billing.

**Fix:** Add to `worker/wrangler.toml` `[vars]` with the prod URL, and to `worker/.dev.vars.example` pointing at the api dev URL.

#### M2. `BUILDERFORCE_INTERNAL_TENANT_ID` shipped through `wrangler secret put`
`api/scripts/set-secrets-from-env.mjs:42`. A tenant id is not a secret — it's an integer. Using `wrangler secret put` for it means it's encrypted-at-rest, can't be viewed in the dashboard, and anyone debugging has to dig through code to figure out which tenant the worker is billing.

**Fix:** Move to `wrangler.toml [vars]` (visible, plain). Secrets are for credentials only.

#### M3. Silent error swallowing in eval flow
`routes/training.ts:404` `catch { } // ignore` — drops JSON parse errors with no log.
`routes/training.ts:410` `catch { modelOutputs.push('(Error generating output)'); }` — drops the gateway error including the type and HTTP status.

When evaluation produces all "(Error generating output)" entries, ops has no signal what failed. The judge then scores garbage and writes `score: 0.5` defaults to the artifact, polluting the metric.

**Fix:** `console.error` with the original error / response status before falling back. The fallback string itself is fine.

#### M4. `stream: true` is hardcoded but the consumer fully buffers anyway
`routes/training.ts:41` requests streaming, then lines 388-408 accumulate all chunks into `outText` before returning. Streaming buys nothing here, costs first-token-time + extra parse complexity, and is the source of H4.

**Fix:** Send `stream: false` and read the JSON response (`res.choices[0].message.content`). Cuts the SSE-parsing code entirely.

#### M5. `AI_PROVIDER` env var in worker is dead code
`worker/src/index.ts:25-26` declares `AI_PROVIDER?: 'cloudflare' | 'openrouter' | 'ab'`. The function that read it (`streamAIResponse`) was deleted. No live reader.

**Fix:** Remove from `Env` interface and from `wrangler.toml`.

#### M6. PRD claim "deleted worker/src/services/ai.ts" is inaccurate
The file was renamed, not deleted (per C1). The PRD must be corrected — and ideally implementations should be reviewed against the PRD before being marked ✅.

### 🟢 LOW / NOTES

#### L1. `streamCloudflareAI` is dead-code-ish
Only called from `services/training.ts:100` as a fallback when `OPENROUTER_API_KEY` is missing. After C1's migration, this fallback becomes obsolete (gateway is the only path). Remove `streamCloudflareAI` and the `AI?: Ai` binding.

#### L2. `wrapStreamForUsage` regex assumption holds for OpenRouter only
`llmRoutes.ts:250-285` extracts usage from "the second-to-last data line" — that's an OpenRouter-specific contract. Cerebras may emit usage in a different position; Ollama doesn't stream SSE at all (it's NDJSON, which is why the vendor has no `callStream`). Once non-OpenRouter streaming is in production, this needs to either move into the vendor module or branch on `result.vendorUsed`.

Not actionable in Step 1h, but worth tracking.

### Step 1h redo punch list (must complete before Step 2)

1. **Truly delete** `llmVendors.ts`. Migrate `services/dataset.ts` and `services/training.ts:evaluateModelOutputs` to a single shared `services/gateway.ts:streamThroughGateway` (or `callThroughGateway` for non-stream — see M4). After this, `streamCloudflareAI` and `streamOpenRouter` cease to exist in the worker.
2. **Add inbound auth on the worker training/dataset routes** — JWT or `clk_*`. No exceptions for any endpoint that triggers an LLM call.
3. **Drop the internal-tenant header**; pin the internal lane to one tenant from env (C3).
4. **Hash + timing-safe-compare the internal key** (H1).
5. **Add an internal-lane daily token cap** (H2).
6. **Fix SSE buffering** OR (better) switch to non-streaming (M4 + H4 in one stroke).
7. **Drop `useCase: 'train.evaluate'`** until the endpoint actually reads it (H5).
8. **Move `BUILDERFORCE_API_BASE_URL` and `BUILDERFORCE_INTERNAL_TENANT_ID` to `[vars]`** (M1, M2).
9. **Remove `AI`, `AI_PROVIDER`, `OPENROUTER_API_KEY` from worker env** after item 1 (M5, L1, dead-code rule).
10. **Add `console.error` before fallback** in eval flow (M3).
