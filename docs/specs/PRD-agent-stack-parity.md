# PRD — Agent-Stack Parity: Hybrid RAG + Semantic Evaluation

**Status:** ✅ Shipped (2026-06-27)
**Owner:** Sean Hogg
**Surfaces:** `@seanhogg/builderforce-memory` · `agent-runtime` (LanceDB extension) · `api` (eval + scoring + cron + route) · `frontend` (marketing/blog)
**Related:** [ROADMAP.md](./ROADMAP.md) · blog: *The AI Agent Tech Stack, Built* · [[evermind]] · [[token-cost-optimization]]

---

## 1. Background & problem

The canonical "AI agent tech stack" is seven layers: **foundation model · orchestration · memory · vector DB/RAG · tools · observability/eval · deployment**. Most teams assemble it from seven separate vendors. Builderforce.ai already ships all seven as one platform — but an honest audit (2026-06-27) found two layers were *present but conventional-thin*, behind what a modern reference stack delivers:

| Layer | Before | Gap vs reference |
|-------|--------|------------------|
| **4 · Vector DB / RAG** | Vector (cosine) retrieval over LanceDB + an SSM embedding store | No **chunking**, no **hybrid** (BM25 + vector) search, no **reranking** |
| **6 · Observability / Eval** | Tracing, cost metering, outcome scoring (merge/CI/cost/steps) | No **semantic** eval (faithfulness / relevance / hallucination); no **drift** monitoring |

The other five layers already meet-or-exceed the reference (multi-vendor gateway, multi-agent orchestrator, four-type SSM-native memory, capability-gated tools + MCP, Cloudflare Workers/DO/Containers deployment). **Goal: close Layers 4 and 6 so the platform meets-or-exceeds at every layer.**

## 2. Goals / non-goals

**Goals**
- G1. Production-grade RAG retrieval: chunking + hybrid dense/sparse + reranking, reusable across the SSM memory store and the LanceDB long-term-memory path.
- G2. Semantic evaluation of answer quality: faithfulness, answer/context relevance, hallucination rate — automatic and zero-cost on every run, with an on-demand LLM-as-judge upgrade.
- G3. Quality-drift monitoring per (action-type × model) with alerting.
- G4. No regressions; full test coverage on new pure modules; clean typecheck + schema/migration checks.

**Non-goals**
- A managed/cloud vector DB (Pinecone/Weaviate) — LanceDB + SSM store stay the backends.
- Re-embedding the inline per-run eval with an LLM judge by default (cost). The judge is opt-in via the route.
- A new Observability-UI panel for drift (data + API shipped; the panel is a fast-follow).

## 3. Layer 4 — Hybrid RAG

**Module:** `@seanhogg/builderforce-memory` → `packages/memory/src/retrieval/` (zero runtime deps; browser + Node + Worker-safe), exported at the new `./retrieval` subpath (avoids pulling the WebGPU engine).

| File | Responsibility |
|------|----------------|
| `chunk.ts` | `chunkText` — recursive character splitter, largest-natural-boundary-first, with overlap + hard-split fallback. |
| `bm25.ts` | `bm25Search` — Okapi BM25 (k1/b tunable), reuses the shared tokenizer. |
| `fusion.ts` | `reciprocalRankFusion` (rank-based merge, k=60), `maximalMarginalRelevance` (relevance vs novelty). |
| `HybridRetriever.ts` | `hybridRetrieve` — dense (cosine) + sparse (BM25) → RRF → MMR. Degrades to BM25-only / dense-only. |

**Wiring**
- `MemoryStore.recallHybrid(query, topK, runtime?, opts?)` — embeds candidates + query (where a runtime is available), runs the hybrid pipeline.
- LanceDB extension (`agent-runtime/extensions/memory-lancedb`): `MemoryDB.searchHybrid()` over-fetches a dense pool, fuses + reranks; `storeText()` chunks long inputs on write. Used by the recall tool, auto-recall hook, and CLI.

**Acceptance:** hybrid returns exact-token matches dense-only misses; near-duplicates suppressed by MMR; graceful degradation verified. 67 tests @ 100% coverage; memory suite 261 green.

## 4. Layer 6 — Semantic evaluation + drift

**Module:** `api/src/application/eval/`

| File | Responsibility |
|------|----------------|
| `semanticEval.ts` | `evaluateResponse({question, context, answer}, {judge?})` → `{faithfulness, answerRelevance, contextRelevance, hallucinationRate, overall, method}`. Lexical backend (token coverage / F1, zero-cost) + injected **LLM-as-judge** (rubric prompt → parsed/clamped JSON). Never throws (judge failure → lexical). |
| `driftMonitor.ts` | `computeDrift(baseline, recent)` (mean-shift z-score + PSI → `none`/`warn`/`alert`, regression-only), `populationStabilityIndex`, `detectGroupDrift` (per-group baseline-vs-recent split). |
| `runEvalDriftSweep.ts` | Daily cron — per-tenant, per-group drift → alert log. |

**Persistence:** migration **0222** adds `faithfulness`, `answer_relevance`, `hallucination_rate`, `eval_method` to `run_model_outcomes` (+ partial index for drift scans).

**Wiring**
- `scoreRunOutcome` (the one site on every terminal path) scores the run's deliverable (`executions.result`) vs the task text inline (lexical) and persists alongside the outcome score.
- `POST /api/eval` — score an arbitrary `{question, context, answer}` with the LLM judge (via `llmProxyForPlan`, so it's metered/capped like any completion); `judge:false` for a free lexical score.
- `GET /api/eval/drift` — per-(action-type × model) drift report (read-through cached 5m).
- Daily cron branch runs `runEvalDriftSweep`.

**Acceptance:** ungrounded answer → low faithfulness / high hallucination; judge garbage/throw → lexical fallback; clear regression → `alert`, improvement → never alerts. 27 eval + 8 scoreRunOutcome tests green; api tsc + schema-drift + migration checks clean.

## 5. Rollout & metering

- **Inline eval** ships with the scorer — zero added cost, active immediately on every cloud run.
- **LLM-judge route** routes through the metered gateway; judge spend is billed/capped per tenant like any completion.
- **LanceDB hybrid path** is live: all three memory packages published to npm at **`2026.6.28`** (tag `v2026.6.28` → `release.yml`, green) with the `./retrieval` subpath export; agent-runtime resolves it and `pnpm tsgo` typechecks clean.

## 6. Risks & open residuals

- **Per-run faithfulness is relevance-only without retrieved context** — needs the run's injected memory/RAG context threaded to the scorer for true grounding (full version available now via `/api/eval`).
- **Drift alerts log to `console.warn`** — wire to the human-requests / Slack-email path + add an Observability-UI panel (data + API exist).
- All residuals are logged in the [Consolidated Gap Register](./ROADMAP.md#consolidated-gap-register).

## 7. Success metrics

- Layer scorecard: 7/7 layers at "meets-or-exceeds" (was 5/7).
- Every terminal cloud run carries a persisted quality score; drift sweep surfaces regressions before users report them.
- RAG recall quality (exact-token + semantic) improves without a managed vector-DB dependency.
