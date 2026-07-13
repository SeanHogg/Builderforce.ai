# PRD — The Compile Primitive: `need → AgentSpec → surface`

**Status:** ✅ **COMPLETE — C1–C5 + enforcement depth (2026-06-27 → 2026-06-28).** `compile()`/`deploy()`/`deployAndDispatch()` registries, all six modality adapters, `PolicyGate` **hard-enforced at every engine's tool seam** (cloud durable+Worker, on-prem SDK runner, IDE), gateway `/v1` grounded recall, and the plain-language front door (`/compile`, `POST /api/compile`, `POST /api/compile/run`) are live and tested. The ONLY remaining items are genuinely out-of-code: a Cloudflare **Container** binding+image (infra/deploy) and a **gate-authoring UI** on the publish surface (a migration + editor) — both logged to the Consolidated Gap Register. The spine and its enforcement are done.
**Owner:** Sean Hogg
**Surfaces:** `api` (compile + deploy) · `packages/agent-tools` (AgentSpec + AgentEngine) · `@seanhogg/builderforce-memory` (ingestion/recall) · `agent-runtime` (relay) · `frontend` (need front doors)
**Related:** [ROADMAP.md](./ROADMAP.md) · [PRD-agent-stack-parity.md](./PRD-agent-stack-parity.md) · [[psychometric-persona]] · [[engine-consolidation]] · [[v2-surface-parity-plan]] · [[ssm-hippocampus-loop]]

---

## 1. The vision this serves

> *"The future is a platform that enables any human to define a need, and the agentic system solves it."*

Four operator examples define the surface area:

1. **Process** — review a team's SOPs and share a more efficient process flow.
2. **Trained agent** — train an agent on a company's proprietary data, then create a custom Agent that handles support calls.
3. **Surface** — a custom agent that executes in the IDE, on the desktop (on-premise), or in the cloud.
4. **Workflow** — a manager defines the workflow / process charts, then embeds those steps into the agent to execute.

The through-line is identical in all four: **a human expresses a need in some modality, and the system turns that need into an agent that runs on the right surface.** What differs is only the *input modality* (prose, a dataset, a process chart, a persona) and the *output surface* (IDE, desktop, cloud, workflow step).

## 2. The problem: four front doors, no shared spine

Today the platform already has **four separate "need → executing agent" paths**, each built independently, each compiling a *different* representation of a need into a *different* artifact, with no shared intermediate and no shared deploy step:

| # | Need front door | Compiles to | Deploy path | Status |
|---|-----------------|-------------|-------------|--------|
| 1 | **Diagnostic run** (`/api/tools`, `agentic-maturity`) — questionnaire/telemetry | a *score + static recommendations* | — (no agent emitted) | ✅ scoring · ❌ no agent, no "emit a better flow" |
| 2 | **Train + publish** (`/api/ide/datasets`, `/api/ide/agents`, `AgentPublishPanel`) — capability prompt → dataset → WebGPU training | `ide_agents` row + `builderforce/workforce-<id>` model ref | gateway `resolveWorkforceModel` | ✅ train/publish/infer · ❌ no proprietary-data ingestion · ⚠️ memory not recalled at inference |
| 3 | **Workflow builder** (`components/workflow-builder/**`, `workflowGraph.ts`) — process chart | `workflow_definitions` graph → `CompiledStep[]` | `instantiateRun` → claim → relay | ✅ end-to-end · ⚠️ persona exec-params not threaded to nodes |
| 4 | **Persona builder** (`psychometricCatalog.ts`, `psychometrics.ts`) — trait questionnaire | directives + `thinkLevel`/`reasoning`/`temperature` | `agentPrompt.ts` (IDE chat + workforce only) | ✅ compiled · ⚠️ used by 2 of N consumers |

The closest thing to a shared "compiler" is [`agentPrompt.ts`](api/src/application/agent/agentPrompt.ts) `buildAgentSystemPrompt()` — but it is consumed by only two of the four paths (IDE chat + workforce inference). The execution surfaces have a clean shared seam already — the `AgentEngine` interface in [`packages/agent-tools/src/engine.ts`](packages/agent-tools/src/engine.ts) with a DI registry (`resolveEngineById`) — but **nothing upstream compiles into a single spec that feeds it.**

The result: persona exec-params don't reach workflow nodes; trained memory doesn't reach inference; a diagnostic finding can't become an agent; and "define a need in plain language" has no front door at all. Each gap is a *missing edge between two things that already exist.*

## 3. The primitive

Introduce **one canonical intermediate representation** — the `AgentSpec` — and **two pure functions** around it:

```
                ┌─────────────── compile(need, modality) ───────────────┐
   NEED  ──▶    │  prose · dataset/docs · process-chart · persona ·      │   ──▶  AgentSpec
 (any modality) │  diagnostic-findings   →  one normalized AgentSpec     │      (canonical IR)
                └───────────────────────────────────────────────────────┘
                                                                              │
                ┌─────────────── deploy(AgentSpec, surface) ─────────────┐    ▼
  AgentSpec ──▶ │  ide · desktop · cloud-durable · cloud-container ·     │   ──▶  running agent
                │  workflow-node   →  AgentEngine.run via DI registry    │
                └────────────────────────────────────────────────────────┘
```

- `compile(need, modality) → AgentSpec` — a registry of **modality compilers**, each lowering one need-representation into the same spec. This is the only place that knows about prose vs. charts vs. datasets.
- `deploy(AgentSpec, surface) → AgentRun` — resolves the right `AgentEngine` via the existing DI registry and the right transport via the existing `cloudDispatch`/relay, then runs. This is the only place that knows about IDE vs. desktop vs. cloud vs. workflow-node.

Everything between is the `AgentSpec`. The four legacy front doors become four `compile` adapters; the four surfaces become `deploy` targets. No path is thrown away — they are **rehomed onto a shared spine.**

### 3.1 `AgentSpec` (the IR)

Lives in `packages/agent-tools/src/spec.ts` (zero runtime deps; browser + Node + Worker-safe, like `engine.ts` beside it):

```ts
export interface AgentSpec {
  id: string;
  identity: { name: string; title?: string; bio?: string; skills?: string[] };
  /** Base frontier model OR a workforce-<id> trained model ref. */
  model: { ref: string; autoRoute?: boolean };
  /** Compiled persona — directives + execution levers. From psychometrics.ts. */
  persona?: { directives: string[]; thinkLevel?: number; reasoningLevel?: number; temperature?: number };
  /** Knowledge the agent recalls at inference. Backed by builderforce-memory. */
  memory?: { storeId?: string; mambaStateKey?: string; recall?: 'hybrid' | 'dense' | 'off' };
  /** Governance gates compiled from policy-packs (currently CRUD-only). */
  policy?: { gates: PolicyGate[] };
  /** Optional ordered steps when the need is a process/workflow. */
  steps?: CompiledStep[];
  /** Where it is allowed to run. */
  surfaces: AgentSurface[]; // 'ide' | 'desktop' | 'cloud-durable' | 'cloud-container' | 'workflow-node'
}
```

`CompiledStep` already exists in [`workflowGraph.ts`](api/src/domain/workflowGraph.ts); `PolicyGate` is new (Section 5). `buildAgentSystemPrompt()` becomes the canonical `AgentSpec → system prompt` lowering, called by **every** surface — closing the pillar-2 (memory) and pillar-4 (persona) "compiled but not used" gaps in one move.

### 3.2 `compile()` — the modality registry

`api/src/application/compile/` with one adapter per modality, each `(need) → AgentSpec`:

| Modality | Adapter | Source need | Reuses |
|----------|---------|-------------|--------|
| `prose` | `compileFromProse.ts` | plain-language description ("an agent that triages support tickets") | LLM extraction → identity/skills/model |
| `dataset` | `compileFromDataset.ts` | capability prompt **+ proprietary docs** | dataset-gen + **new doc ingestion** (Section 4) |
| `process-chart` | `compileFromGraph.ts` | workflow_definitions graph | existing `compileDefinition()` → `spec.steps` |
| `persona` | `compileFromPersona.ts` | psychometric profile | existing `psychometrics.ts` → `spec.persona` |
| `diagnostic` | `compileFromDiagnostic.ts` | a tool_run's findings | **new**: findings → recommended `spec.steps` (Section 6) |

A single need can stack adapters (a process chart **with** a persona **and** a trained model is just three adapters merging into one spec).

### 3.3 `deploy()` — the surface registry

`api/src/application/deploy/` is a thin router over machinery that already exists:

| Surface | Engine / transport | State today |
|---------|-------------------|-------------|
| `cloud-durable` | `AgentEngine` v2 on `CloudRunnerDO` | ✅ shipped |
| `cloud-container` | `AgentEngine` v2 in Cloudflare Container | ⚠️ declared, falls back to durable |
| `ide` | VS Code `runAgent()` loop | ⚠️ divergent — not behind `AgentEngine` |
| `desktop` | native apps | ❌ no agent execution path |
| `workflow-node` | relay `resolveEngine` per `CompiledStep` | ✅ shipped |

`deploy()` does not reimplement anything — it calls `resolveEngineById` / `cloudDispatch.chooseCloudExecutor` and hands them an `AgentSpec`-derived `AgentRunInput`. The IDE and desktop gaps (Section 7) become "make this surface a `deploy()` target," not bespoke rewrites.

## 4. Closing pillar 2 — proprietary data → recall (the biggest real gap)

The train+publish path produces agents with **zero domain knowledge**: dataset generation is LLM-synthetic only, and the `HybridRetriever` / `MemoryStore` / `chunk` modules in `@seanhogg/builderforce-memory` exist but are never wired to publish or inference. Fix, as part of `compile(dataset)` + the shared spec:

1. **Ingest** — `POST /api/ide/agents/:id/ingest` (or pre-publish): upload docs → `chunkText` → embed → `MemoryStore.remember()` under a `storeId`, recorded on `AgentSpec.memory.storeId`.
2. **Recall** — `buildAgentSystemPrompt()` (now the canonical spec-lowering) calls `recallHybrid(query)` when `spec.memory.recall !== 'off'` and prepends grounded context. This makes recall work on **every** surface at once, because every surface lowers through the same function.

This is the single change that turns "trained on a capability prompt" into "trained on your company's data."

## 5. Closing pillar 4 — governance gates that actually gate

Governance today is CRUD/observability only (`governanceRoutes.ts` SOC2/vendor/DSR trackers). Add `PolicyGate` to the spec and evaluate it in `AgentEngine.run` pre/post tool-call: a gate can require approval, block a tool, or inject a directive. Policy-packs compile into `spec.policy.gates` via a `compileFromPolicy` adapter. Because gates live on the spec, they apply identically on cloud, IDE, and workflow nodes — no per-surface enforcement code.

## 6. Closing pillar 1 — "emit a better process flow"

The diagnostic engine scores maturity but never **emits** an improvement. `compileFromDiagnostic.ts` closes the loop: a `tool_run`'s low-scoring sections → LLM proposes an improved process as `CompiledStep[]` → returned as an `AgentSpec` the user can review and `deploy()` as a workflow. The diagnostic stops being a dead-end report and becomes a need front door like the others. (Reverse-engineering external diagrams — Lucidchart/Visio import — is a fast-follow; the internal `workflow_definitions` graph is the v1 source.)

## 7. Surface parity work folded in

- **IDE**: wrap VS Code `runAgent()` behind `AgentEngine` so it is a `deploy('ide', spec)` target (closes the divergent-loop gap).
- **Desktop**: give native apps the same relay-bridge the IDE uses, making `deploy('desktop', spec)` real.
- **Container**: finish the `cloud-container` executor so it stops demoting to durable.

Each is now scoped as "add a `deploy()` target," not an architecture change — exactly what [[engine-consolidation]] and [[v2-surface-parity-plan]] anticipated.

## 8. Goals / non-goals

**Goals**
- G1. One `AgentSpec` IR in `packages/agent-tools`, lowered by `buildAgentSystemPrompt()` on every surface.
- G2. `compile()` registry with the five modality adapters; the four legacy front doors rehomed as adapters (no behavior loss).
- G3. `deploy()` registry over the existing engine/transport machinery; IDE + desktop become real targets.
- G4. Proprietary-doc ingestion + hybrid recall wired into publish and inference.
- G5. Persona exec-params and policy gates reach **all** surfaces via the spec.

**Non-goals**
- Replacing the four UIs — they keep their distinct UX; only their backend lowering converges.
- A managed vector DB — LanceDB + SSM store stay the backends ([PRD-agent-stack-parity.md](./PRD-agent-stack-parity.md)).
- External-diagram import (Lucidchart/Visio) — fast-follow on the internal graph.

## 9. Phasing

| Phase | Scope | Unblocks |
|-------|-------|----------|
| **C1** ✅ | `AgentSpec` IR + `lowerAgentSpec()` in `packages/agent-tools/src/spec.ts`; `api/agentPrompt.ts` lowers through it (live on all 3 inference paths); `PsychometricExecParams` aliased to the canonical `AgentExecParams` | Pillar 2 + 4 "compiled-but-unused" gaps — the spine keystone |
| **C2** ✅ | `compile()` registry (`api/src/application/compile/`): `compileFromProse` · `compileFromDataset` · `compileFromGraph` · `compileFromPersona` · `compileFromDiagnostic` · `compileFromPolicy`, `mergeSpecs` (stack adapters → one spec), `compile(need\|need[])` dispatcher; injected `LlmComplete` keeps adapters pure | Single need spine |
| **C3** ✅ | Proprietary-doc ingestion + BM25 recall (Section 4): `agent_knowledge_chunks` (mig 0249), `POST /api/ide/agents/:id/ingest`, cached recall wired into the chat path's `recalledContext`, localized publish-panel ingest UI; reuses `@seanhogg/builderforce-memory/retrieval` `chunkText`/`bm25Search` | "Train on your data" — agents now recall ingested proprietary docs at inference |
| **C4** ✅ | `deploy()` registry + **`deployAndDispatch()`** (`api/src/application/deploy/`): surface→transport map, engine resolution, `lowerAgentSpec`→`runInput`, `surfaces` allow-list, and live dispatch — step-bearing spec → `persistCompiledRun` (a real workflow), cloud spec → `dispatchCloudRunForTask` (gates in payload). Gateway `/v1` grounded recall wired (`resolveWorkforceModel(…, query)`). | Write-once / run-any-surface |
| **C5** ✅ | `compileFromProse` (plain-language front door) + `compileFromDiagnostic` + `PolicyGate`/`AgentSpecPolicy`, rendered by `lowerAgentSpec` AND **hard-enforced by `evaluatePolicyGate` at every engine's tool seam** — cloud (`runCloudToolLoop`: block/refuse + require-approval/park-and-resume, persisted across DO ticks), on-prem (`allowedToolsAfterGates` + `renderPolicyDirectives`), IDE (`clients/vscode/src/policy.ts`). `coercePolicyGates` is the one shared wire validator. | Plain-language front door + "emit a better flow" + gates that actually gate |

## 10. Success criteria

- A plain-language need ("an agent that answers billing questions from our docs") compiles to an `AgentSpec` and deploys to cloud **and** IDE from the same spec.
- A published agent recalls company docs at inference on every surface.
- A persona's `temperature`/`thinkLevel` provably changes a *workflow-node* run, not just IDE chat.
- A diagnostic finding can be turned into a runnable workflow in one click.
