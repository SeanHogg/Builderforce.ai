# PRD 13 — Learned Model Routing (action-type labels → outcome analytics → routing, with SSM recall)

**Status:** Draft — ready for implementation in a fresh chat.
**Owner track:** T3 · Gateway & LLM (`api/src/application/llm/**`, route `llmRoutes.ts`) with cross-cutting touches in T4 · Cloud Runtime (`api/src/application/runtime/**`) and a later T6/SSM increment (`@seanhogg/builderforce-memory`).
**Migration band:** draw the next free numbers from `api/migrations/` (latest is `0196` at time of writing → start at `0197`; confirm before writing).
**Depends on / extends:** [[claude-direct-coding-floor]] (cascade + `pickCloudModel`), the cloud agent engine (`cloudAgentEngine.ts`), `recordUsageRow`/`llm_usage_log`, the SSM Hippocampus loop (builderforce-memory).

---

## 1. Problem & Goal

Builderforce runs cloud agents across a curated pool of coding models (free + paid + the direct-Anthropic/Cloudflare floor). Today **model choice is static**: `pickCloudModel` either honours an explicit Pro-plan pin or seeds the plan's best coding model; the cascade order is hand-curated in `CODING_MODEL_POOL` / `CODING_PREMIUM_FALLBACK_MODELS`. We have **no feedback loop** telling us *which model actually performs best for which kind of task*, even though the operator's intuition ("Gemini is better at SQL, a different model is better at React refactors") is exactly the kind of signal we could learn.

**Goal:** Close the loop. (1) Label every run with an **action type**. (2) Capture a per-run **outcome score** joined to `(action_type, model)`. (3) Surface **analytics** ranking models per action type. (4) Feed the ranking back into **routing** so a run for a given action type prefers the empirically-best model the plan can reach. (5) Use **SSM/Samba memory** as a *per-codebase* recall layer that biases routing toward what has worked for *this specific repo*.

**Non-goals (this PRD):** Replacing the curated pool (the learned layer *re-orders within* the plan-reachable pool, never invents models). Training a custom model from scratch. Changing billing/metering. Touching on-prem (host) routing in phase 1 (cloud runs only; host parity is a later increment).

---

## 2. What already exists (build ON this, don't duplicate)

- **Resolved model per run** is captured: `recordCloudUsage` → `recordUsageRow` writes `llm_usage_log` with `model`, `task_id`, `project_id`, `cloud_agent_ref`, `execution_id`, `cost_usd_millicents`, `paid_overflow`, `total_tokens`. **Do not add a parallel "model used" store — join to this.**
- **Run telemetry** exists: `emitModelSelection` (`model.select`) and `emitCodingModelDegraded` (`coding_model_degraded`) write `tool_audit_events`. The selection event already records `requested`, `pin` (strict|soft), `seed`, `plan`, `premium`, `planCoders`.
- **Run outcome** exists on `executions` (`status`: completed/failed/cancelled; `result`; `error_message`) and, for the PR/CI signal, on the PR row (`pull_requests.build_status` + `build_error`, migration 0196) and merge state.
- **Plan-aware reachable pool**: `codingModelsForPlan(plan, premium)` is the single source for "which coding models can this plan reach" — routing MUST stay within this set.
- **Routing entry point**: `pickCloudModel(explicit, effectivePlan, premiumOverride)` is the single chokepoint both cloud executors call (container op + durable loop). This is where learned routing plugs in.
- **SSM recall**: the hippocampus loop (per [[ssm-hippocampus-loop]]) already persists/retrieves embeddings per codebase — the per-repo recall layer rides this, not a new store.

---

## 3. The three decisions this PRD locks in (defaults chosen; change if needed)

These were the open questions from the Gap Register. Defaults below are the recommended answers so implementation isn't blocked; flag in the kickoff chat if any should change.

| # | Decision | **Default (recommended)** | Rationale |
|---|---|---|---|
| D1 | **What is an action type?** | A small **closed enum** (v1): `sql`, `frontend_ui`, `backend_api`, `refactor`, `bugfix`, `tests`, `docs`, `devops_ci`, `data_migration`, `other`. Stored as a string; the enum lives in shared TS so api + frontend agree. | Closed set keeps analytics dense (enough samples per bucket) and the classifier cheap/reliable. Free-form slugs fragment the data. Extensible later. |
| D2 | **How is the label produced?** | A **first-pass FREE-model classifier** call, run **once per task** (not per run) and **cached on the task** so re-runs reuse it. Uses `ideProxy` (free pool) with a strict `json_schema` response_format returning `{ action_type, confidence }`. Falls back to `other` on any failure (never blocks the run). | One cheap classification per task, reused across executions, amortizes cost to ~nothing. Free pool = no paid spend. Caching on the task is the canonical perf pattern. |
| D3 | **What defines "worked best" (the outcome score)?** | A **composite 0–1 score** computed at run terminal, weighted: **PR merged** (0.5) **+ green CI on the PR branch** (0.2) **+ completed-without-degradation** (0.15) **+ efficiency** (0.15, inverse of steps & paid-overflow cost, normalized). Human approval, when present (approval resolved `approve`), pins the completion term to full. A `failed`/`cancelled` run scores 0 for the merge/CI terms. | Merge is the strongest "it actually worked" signal we have; CI green and no-degradation are corroborating; efficiency breaks ties between models that both succeed. All inputs already exist (executions status, PR build_status/merge, `coding_model_degraded` events, usage cost). No new human step required. |

---

## 4. Architecture (data flow)

```
TASK CREATED/RUN ──▶ [Classifier] ──(cached on task)──▶ action_type
                                                            │
CLOUD RUN START ──▶ pickCloudModel(explicit, plan, premium, actionType, routingTable, routingBias?)
                         │  ├─ explicit Pro pin? → honour (unchanged)
                         │  ├─ free plan? → managed default (unchanged gate)
                         │  └─ else → reorder codingModelsForPlan() by the
                         │            routing:<scope> KV blob for actionType  ◀─ 1 cached KV get (no SQL)
                         │            + optional client SSM bias (interactive) ◀─ computed on client GPU
                         ▼                                                 ▲
RUN EXECUTES (cascade, telemetry, usage rows — unchanged)                 │ (read by router + analytics)
                         │                                                 │
RUN TERMINAL ──▶ [Outcome scorer] ──▶ run_model_outcomes row (truth) ─────┤
                  (action_type, resolved_model, score, terms, cost, …)    │
                         ├──▶ incremental RMW of routing:<scope> KV blob ──┘  (Welford, no table scan)
                         └──▶ [WS push] new outcome → connected clients update their local SSM memory
```

Two backstops keep it safe: routing **degrades to today's static order** whenever stats are sparse/cold (`< MIN_SAMPLES`), and the classifier/scorer are **best-effort** (never block or fail a run).

---

## 4.1 Where the intelligence runs — cost model (the load-bearing decision)

**Hard constraint: the routing decision must work with NO client connected.** Cloud runs fire headless — board lane auto-run, scheduled deployments (`/v1/deployments`), CI-failure auto-fix, follow-up directives — and `pickCloudModel` runs **server-side at run start** inside the Worker/DO/Container. Therefore the *authoritative* learned-routing state **cannot live only in the browser** (LocalStorage/IndexedDB) and cannot require a WebSocket to a live tab: a 3 a.m. autonomous run has no tab. A per-browser store is also per-user and divergent, so it can't be the shared source of truth.

**So we split it into two layers, each placed where it's cheapest:**

| Layer | Authority? | Where it runs | Cost |
|---|---|---|---|
| **Routing table** — the `(scope, action_type, model) → rank` decision | **Yes** (shared, works headless) | **Server-side, as a tiny KV blob** read at run start | **1 KV `get` of a few-KB blob per run. Zero SQL on the hot path, zero per-page-load cost.** |
| **SSM semantic recall** — "this task *looks like* prior SQL tickets where Gemini won" | No (a *bias* on top of the table) | **Client GPU (WebGPU/builderforce-memory) when interactive**; skipped headless | **Zero server CPU, zero DB.** Heavy embed+kNN runs on the user's machine for free. |

This is the cost-optimal reading of "move intelligence to the client": **the expensive SSM compute moves to the client's GPU (free, when present); the cheap-but-must-always-work decision stays a server KV lookup.**

### The routing-table KV blob (what makes routing O(1) and DB-free)
- A compact JSON blob per scope: `routing:<scope>` → `{ updatedAt, byAction: { sql: [{model, n, avgScore, avgCostMc}], … } }`, scopes `project:<id>`, `tenant:<id>`, `global`. A few KB; bounded by `actionTypes × models`.
- **Maintained INCREMENTALLY on each outcome write** (running count + running mean, Welford-style), not recomputed from a table scan. The terminal-run write path does **one KV read-modify-write** of the blob (runs are low-frequency, so a lost-update race is rare **and** self-healing). The durable `run_model_outcomes` table stays the source of truth; the blob is a derived cache that a periodic/triggered **reconcile job** rebuilds from the table (corrects drift; also the cold-start backfill).
- **Routing read = `getOrSetCached('routing:<scope>')`** → L1 in-isolate Map hit (free) or L2 KV get (cheap); SQL only on a full reconcile. The blob changes only when a run finishes, so it's maximally cacheable.
- Net steady-state cost per run: **decision = 1 cached KV get; terminal = 1 outcome upsert + 1 blob RMW.** No per-request aggregation, no N+1, no page-load DB calls.

### SSM recall placement (client-first, headless-safe)
- The per-codebase SSM hippocampus (builderforce-memory, WebGPU) already runs **in the browser** with **IndexedDB-backed** weights/memories (`idbFactory` injection — see the SSM Hippocampus loop; **IndexedDB, not LocalStorage** — weights are MB-scale binary, LocalStorage is ~5 MB string-only and synchronous).
- **Interactive run:** when a human launches a run from a tab, the client computes the SSM recall **bias** locally (embed the task → kNN over this repo's prior `(task, winning_model)` memories) and includes a small `routingBias: { model: weight }` map in the run payload. The server merges it as a nudge over the KV table. **Zero server cost.**
- **Headless run:** no client → no bias → routing uses the KV table alone. Fully functional, just without the semantic nudge.
- **Sync/transport:** reuse the **existing execution-steering WebSocket relay** (don't add a new socket) to (a) push new server-side outcomes to connected clients so their local SSM memory stays current, and (b) optionally let a client persist a distilled memory snapshot server-side (R2/KV) so a *new* device warm-starts instead of relearning. The authoritative routing table never depends on this sync — it's pure client personalization.

**Why not client-authoritative routing (the literal proposal):** it would (1) break every headless/autonomous run, (2) diverge per user/browser so two teammates' runs route differently with no shared learning, and (3) make the decision unauditable. The hybrid above keeps the cost win (GPU compute on the client) without those failures.

---

## 5. Data model (new tables + columns)

### 5.1 `tasks.action_type` (column, migration 0197)
- `action_type varchar(32)` nullable. The cached classifier label. Null = unclassified (router treats as `other`).
- Add `action_type_confidence` `real` nullable (diagnostic; lets us re-classify low-confidence tasks later).

### 5.2 `run_model_outcomes` (table, migration 0198)
One row per **terminal cloud run** (keyed by `execution_id`, unique). The fact table analytics + routing read from.
```
id                serial pk
tenant_id         integer  -> tenants (set null)
project_id        integer  -> projects (set null)
task_id           integer  -> tasks (set null)
execution_id      integer  not null  (unique)
cloud_agent_ref   varchar(64)
action_type       varchar(32) not null default 'other'
resolved_model    varchar(200) not null     -- the model the run actually locked onto (CloudLoopState.pinnedModel / first resolved)
plan              varchar(16) not null       -- effectivePlan at run time (free|pro|teams)
score             real not null              -- composite 0..1 (D3)
merged            boolean not null default false
ci_green          boolean not null default false
degraded          boolean not null default false  -- any coding_model_degraded event fired
steps             integer not null default 0
cost_usd_millicents integer not null default 0
terminal_status   varchar(16) not null       -- completed|failed|cancelled
created_at        timestamp not null default now()
```
Indexes: `(tenant_id, action_type, resolved_model)`, `(project_id, action_type)`, `(execution_id)` unique.

### 5.3 `routing:<scope>` — the routing-table KV blob (derived, NOT a table)
The decision artifact from §4.1. A compact JSON blob per scope (`project:<id>`, `tenant:<id>`, `global`): `{ updatedAt, byAction: { <action_type>: [{ model, n, avgScore, mergeRate, avgCostMc }] } }`, bounded by `actionTypes × models` (a few KB).
- **Write path (incremental):** each `run_model_outcomes` insert does ONE read-modify-write of the affected scope blobs, updating the running `n`/`avgScore`/`avgCostMc` for `(action_type, resolved_model)` via Welford — **no table scan.**
- **Read path:** `getOrSetCached('routing:<scope>')` (L1 Map → L2 KV); the router reads the finest scope with `n >= MIN_SAMPLES` (project → tenant → global).
- **Source of truth + drift repair:** the durable `run_model_outcomes` table; a periodic/triggered **reconcile job** rebuilds each blob from a single grouped SQL (`AVG(score), COUNT(*), AVG(cost), SUM(merged)::float/COUNT(*)` grouped by `action_type, resolved_model`, windowed `created_at >= now()-N days`). This is also the cold-start backfill. The blob is a derived cache; losing it costs one reconcile, never correctness.

---

## 6. Components to build (in dependency order)

### 6.1 Shared taxonomy — `api/src/application/llm/actionTypes.ts` (+ mirror to frontend via `builderforceApi.ts` append)
- `export const ACTION_TYPES = ['sql','frontend_ui','backend_api','refactor','bugfix','tests','docs','devops_ci','data_migration','other'] as const;`
- `export type ActionType = typeof ACTION_TYPES[number];`
- `export function normalizeActionType(s: unknown): ActionType` (coerce/guard → `other`).
- One source of truth; the classifier, router, scorer, analytics, and any UI label all import this (DRY).

### 6.2 Classifier — `api/src/application/llm/classifyTask.ts`
- `classifyTaskAction(env, { title, description }): Promise<{ actionType: ActionType; confidence: number }>`.
- Uses `ideProxy(env).complete(...)` (FREE pool) with a strict `json_schema` response_format `{ action_type: enum(ACTION_TYPES), confidence: number }`, low `max_tokens` (~256), `useCase: 'task_classification'`.
- **Caller**: in `cloudAgentEngine` run start (and `loadContainerRunContext`), if `tasks.action_type` is null, classify once and persist (`UPDATE tasks SET action_type=…, action_type_confidence=…`). Reuse on every subsequent run. Best-effort: on any error, treat as `other`, do not block.
- Cache: the task column IS the cache; also wrap the classify call body in nothing extra (it's once-per-task). Optionally gate behind a `LEARNED_ROUTING_ENABLED` env flag (default on) for kill-switch.

### 6.3 Router hook — extend `pickCloudModel` + a new `rankModelsForAction`
- New signature: `pickCloudModel(explicit, effectivePlan, premiumOverride, opts?: { actionType?: ActionType; routingTable?: RoutingTable; routingBias?: Record<string, number> })`. **Keep the existing free-plan gate and explicit-pin behaviour byte-for-byte** — learned routing only changes the **soft-seed** branch.
- New pure fn `rankModelsForAction(reachable: string[], byActionStats, opts: { minSamples; bias? }): string[]` — stable-reorders `codingModelsForPlan(...)` so the highest-`avgScore` model with `n >= MIN_SAMPLES` (default 8) for this `actionType` leads; ties broken by lower `avgCostMc`; the optional client-supplied `bias` map (§4.1 SSM recall) nudges scores **before** the sort; everything below `MIN_SAMPLES` keeps the curated order. Returns the curated order unchanged when no model clears the threshold (cold-start safety). **Pure → unit-testable with no I/O.**
- The soft seed becomes `ranked[0]` instead of `codingDefaultForPlan(...)`. **The run still locks onto its turn-1 resolved model via `CloudLoopState.pinnedModel` (unchanged).** Routing only sets the *seed/preference order*; the cascade + cooldown logic is untouched.
- The router's `routingTable` comes from the **KV blob** (§5.3) read once at run start by the caller (`cloudAgentEngine`) — `getOrSetCached('routing:<scope>')`, finest scope with `>= MIN_SAMPLES` (project → tenant → global). `routingBias` is the client-computed SSM nudge passed in the run payload on interactive runs (absent/ignored headless). **One cached KV get per run; zero SQL on the decision path.**
- `emitModelSelection` gains `actionType` + `rankedFrom` (+ `biasApplied`) so the timeline shows *why* a model was seeded ("action=sql; ranked Gemini #1 from 14 prior SQL runs, avgScore 0.78; client SSM bias +0.1").

### 6.4 Outcome scorer — `api/src/application/runtime/scoreRunOutcome.ts`
- `scoreRunOutcome(env, db, { executionId }): Promise<void>` — called from **every terminal path** of a cloud run (the `finalize` op, the durable terminal tick, `handleCloudRunCrash`/fail, cancel). Idempotent on `execution_id` (unique constraint + upsert).
- Pure scoring fn `computeOutcomeScore(inputs): { score, terms }` (unit-tested in isolation) implementing D3. Inputs gathered from: `executions.status`, the linked PR row (`getTaskPullRequest` → merged + `build_status`), whether any `coding_model_degraded` event fired this execution, step count + `cost_usd_millicents` (sum from `llm_usage_log` for the execution), and any resolved approval.
- Writes one `run_model_outcomes` row, then **incrementally updates the `routing:<scope>` KV blobs** (project/tenant/global) for `(action_type, resolved_model)` via Welford — one read-modify-write each, NOT a re-aggregation (§5.3).
- `resolved_model` = `CloudLoopState.pinnedModel` if present, else the most-frequent `llm_usage_log.model` for the execution.

### 6.5 Analytics read endpoint
- `getRoutingTable(env, scope): Promise<RoutingTable>` — `getOrSetCached('routing:<scope>')`; on miss, the reconcile SQL (§5.3) rebuilds it. The router AND the analytics panel read the SAME blob (one source).
- Route `GET /llm/v1/model-analytics?scope=project:<id>|tenant|global` (in `llmRoutes.ts`, `requireTenantAccess`, tenant-scoped) → returns the blob's ranked `byAction` for a Pro analytics panel. **Cached** (the blob is the cache; the route just reads it).

### 6.6 SSM / Samba recall layer — **client-side compute, server-side merge** (phase 3 — separable increment)
Implements §4.1's client-first placement. **The heavy SSM work runs on the user's GPU; the server never embeds or runs kNN.**
- **Client (frontend / builderforce-memory, WebGPU + IndexedDB):** a `useModelRecallBias()` hook embeds the task text, runs kNN over this repo's locally-held `(task-embedding → winning_model, score)` memories, and returns a `routingBias: { model: weight }` map. Included in the run payload **only when launching interactively** (the `useTaskRunner` submit path). Persisted in IndexedDB via the builderforce-memory `idbFactory` injection; **never LocalStorage.**
- **Server:** `pickCloudModel` already accepts `routingBias` (6.3) and merges it as a pre-sort nudge. **No server SSM dependency** — headless runs simply omit it.
- **Sync (reuse the existing execution-steering WebSocket relay — do NOT add a socket):** push new `run_model_outcomes` (action_type + resolved_model + score + task summary) to connected clients so their local SSM memory stays fresh; optionally let a client persist a distilled memory snapshot to R2/KV so a new device warm-starts. The authoritative `routing:<scope>` blob is independent of this — SSM is pure personalization bias.
- Gated behind a client capability check (WebGPU present) + the kill switch; absent → identical to Phase 2 (KV-table-only routing).

---

## 7. Phasing (each phase ships working, end-to-end)

- **Phase 1 — Capture (no behaviour change).** 6.1 taxonomy, 5.1/5.2 migrations, 6.2 classifier (label tasks), 6.4 scorer (write `run_model_outcomes` on terminal). Routing still static. Outcome: we are *collecting* `(action_type, model, score)` data and can eyeball it. **Acceptance:** every new cloud run produces exactly one `run_model_outcomes` row with a sane score; tasks get an `action_type`; zero change to which model runs; no run can fail because of classify/score errors.
- **Phase 2 — Analyze + route.** 6.5 stats aggregate + analytics endpoint + a Pro analytics panel; 6.3 router hook reading the cached stats (project→tenant→global, `MIN_SAMPLES` gate). Outcome: soft-seed model is now the empirically-best reachable model per action type; cold-start = today's order. **Acceptance:** with seeded data, a `sql` task on Pro seeds the top-scoring SQL model; with `< MIN_SAMPLES` it seeds the curated default; `model.select` explains the choice; free-plan gate + explicit pin behaviour unchanged (existing `codingPool` tests still green).
- **Phase 3 — SSM per-codebase recall (client-computed bias).** 6.6. Outcome: an **interactive** run is additionally biased by semantically-similar prior runs in *this* repo, computed on the **client GPU** (zero server cost) and merged server-side. **Acceptance:** with WebGPU + local memory present, near-duplicate prior tasks nudge their winning model up via `routingBias`; headless runs and WebGPU-absent clients behave identically to Phase 2 (KV-table-only); the server runs no SSM inference and makes no extra DB call for the bias.

---

## 8. Performance & safety requirements (non-negotiable)

- **Decision hot path = O(1), DB-free**: routing reads ONE cached `routing:<scope>` KV blob (§5.3) per run — L1 Map hit or L2 KV get, **no SQL, no aggregation, no per-page-load cost.**
- **Classifier**: once per task, cached on the `tasks` row; free pool; never per-run, never blocking.
- **Write path**: per terminal run = 1 outcome upsert + incremental KV-blob RMW (no table scan). The reconcile SQL runs only on a schedule/trigger, windowed `created_at >= now()-N days` so the fact scan stays bounded as the table grows.
- **SSM**: heavy embed+kNN runs **client-side on the user's GPU** (zero server CPU/DB); server only merges a passed-in bias map; absent → no-op.
- **Scorer**: idempotent (`execution_id` unique), best-effort, fires on **all** terminal paths (don't leak un-scored runs).
- **Router**: pure reorder within `codingModelsForPlan`; **cold-start, missing blob, and any error path fall back to the existing static order** — learned routing can never make a plan-unreachable model run or break the free-plan gate.
- **DRY**: `ACTION_TYPES`, the score formula, the reachable-pool source, and the `routing:<scope>` reader each live in exactly one module.
- **Kill switch**: `LEARNED_ROUTING_ENABLED` env (default true) short-circuits 6.2/6.3 back to static behaviour without a code-path deploy.

---

## 9. Testing

- `actionTypes.test.ts` — normalize/guard.
- `classifyTask.test.ts` — schema-conforming mock → label; error/garbage → `other`.
- `scoreRunOutcome.test.ts` — table-driven `computeOutcomeScore`: merged+green+efficient ≈ high; failed ≈ 0; cancelled ≈ 0; degraded penalty; idempotent upsert.
- `rankModelsForAction.test.ts` — best-score leads; `< MIN_SAMPLES` → curated order; ties broken by cost; empty table → identity; a `routingBias` map nudges the order pre-sort.
- `routingTable.test.ts` — Welford incremental update matches a full re-aggregate; missing blob → reconcile rebuild; scope precedence project→tenant→global at `MIN_SAMPLES`.
- Extend `LlmProxyService.codingPool.test.ts` — `pickCloudModel` with `actionType`+`routingTable` still honours free-plan gate and explicit Pro pin; soft seed = `ranked[0]`; no table → static order.
- Analytics endpoint — reads the cached blob (cache hit on second call), tenant-scoped, ranked.
- (Phase 3) `useModelRecallBias` — embeds + kNN over a seeded local memory → bias map; WebGPU/memory absent → empty map (no-op).

---

## 10. Open risks / explicitly deferred (log any new ones to the Gap Register)

- **On-prem (host) runs** aren't routed by this in phase 1 (host picks its own model); host parity is a later increment — the `run_model_outcomes` capture CAN still include host runs if we score them, but routing stays cloud-only first.
- **Action-type enum drift** — if `other` dominates, revisit D1 (add buckets or move to a learned label). Monitor the confidence column.
- **Sparse paid-model data** — paid models run rarely on free tenants, so global stats may skew to free models; scope precedence (project→tenant→global) + `MIN_SAMPLES` mitigates, but seed the threshold conservatively and watch.
- **Score formula calibration** — D3 weights are a first guess; expose them as named constants so they're tunable without a schema change.
- **KV blob lost-update race** — concurrent terminals on the same `(scope, action_type)` can drop an increment in the RMW; accepted because runs are low-frequency per bucket and the scheduled **reconcile** self-heals from the durable table. If contention ever becomes real, move the increment to a DO-serialized counter or a SQL `UPDATE … RETURNING` on a small running-agg table.
- **Client SSM divergence / sync** — the per-browser SSM memory is personalization, not truth; two teammates may compute different `routingBias`. That's fine (the KV table is the shared authority); the WS push keeps local memories roughly fresh but is best-effort. A brand-new device starts with no bias until it relearns or warm-starts from a snapshot.

---

## 11. Definition of done (whole feature)

A Pro tenant running a `sql`-classified ticket is seeded onto the model that has empirically scored highest on SQL for their project (falling back to tenant→global→curated when data is thin), the choice is explained on the timeline, an analytics panel shows the per-action-type model ranking, and every terminal run writes one scored outcome row. The routing **decision is a single cached KV-blob read (no SQL on the hot path)**; the **heavy SSM recall runs on the client GPU** (zero server cost) and only *biases* interactive runs. The free-plan model gate and explicit-pin behaviour are unchanged, and the whole path degrades to today's static routing under cold-start, a missing blob, errors, headless dispatch, or the kill switch — all backed by tests.
