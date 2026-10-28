# Deterministic-first PreFetch — end state

Status: APPROVED 2026-10-28, in implementation.

## Goal

Before any LLM call, run cheap deterministic actions (MCP tools, `/` actions, static
analyzers, codegen). A confidence gate decides per request:

- **ANSWER**: a deterministic action settles the turn, and no model is called.
- **PREFETCH**: actions run and their output rides into the turn as context, so the model
  starts with facts instead of spending exploration turns.
- **LLM**: nothing confident enough; the run proceeds exactly as today.

## What exists (extended, never duplicated)

| Seam | Where | Becomes |
|---|---|---|
| `answerWithoutModel` (one host function: "where is X defined") | `brain-embedded/src/runStore/adoptAnswer.ts`, `clients/vscode/src/runSetupPorts.ts` | The first registered ANSWER action; the port changes from one function to the registry. |
| `adoptAnswerWithoutModel` (settle + persist + `recall` trace, `skippedLlm`) | `adoptAnswer.ts` | The ONE settle path for every ANSWER action. |
| Memory-first answer | `runMemory.answerFromMemory` | Unchanged; still runs after deterministic answers. |
| preSearch / context pack | `agent-tools/preSearch.ts`, `clients/vscode/src/contextPack/*` | The first registered PREFETCH action; its output already lands in `host.turnContext` (volatile tail). |
| Scorers: `difficulty-router`, `pipeline-route`, `localSuccessRouter`, `learned-routing` | `packages/*` | Unchanged; they pick a model tier *after* the gate says LLM. |
| Local engines: `bfi-node` (Synapse), WebLLM, Ollama | `packages/local-inference` | Host the logprob classifier (tier 3). |
| Savings ledger: `spend-contract`, `llm_usage_log.pipeline_route/route_score` | api + tx tracks | Records gate decisions and avoided model calls; no new table. |

## Contract: `packages/prefetch` (new, pure, no I/O)

```ts
type PrefetchKind = 'answer' | 'prefetch';
type SideEffect = 'read' | 'write';            // write ⇒ always confirm, never auto-run

interface PrefetchAction {
  id: string;                                  // 'symbols.where-defined', 'dup.jscpd', …
  kind: PrefetchKind;
  sideEffect: SideEffect;
  surfaces: Array<'vscode' | 'onprem' | 'cloud' | 'web'>;
  slash?: string;                              // explicit `/dup`, `/lint`, … (tier 1)
  patterns?: RegExp[];                         // rule match (tier 1)
  examples: string[];                          // phrasings for tiers 2–3 (registry data)
  budgetMs: number;                            // hard deadline (withinMs)
}

interface GateDecision {
  route: 'answer' | 'prefetch' | 'llm';
  actions: Array<{ id: string; p: number; tier: 1 | 2 | 3 }>;
  pNeedsLlm: number;
}

classify(request, registry, ports): Promise<GateDecision>
```

Actions are **registry data**. A host supplies an executor per id through a port
(`PrefetchExecutors`); the package never runs a tool itself. A new tool is a registry row
plus an executor, never a new branch in the gate.

## The confidence gate: a cascade, cheapest tier first

1. **Exact** (<1 ms): a `/` action typed in the composer, or a rule pattern. p = 1.
2. **Lexical/embedding + logistic** (~ms): similarity to each action's `examples`, then a
   per-action logistic head (same family as `difficulty-router/head.ts`). It learns online
   from outcomes.
3. **Logprob classifier on a local SLM** (~50–300 ms on CPU): one forward pass with the
   label set `[...actionIds, 'needs-llm']`, reading each label token's logprob. It runs on
   our engines (Synapse/`bfi-node` → WebLLM → Ollama last). It runs only when tiers 1–2
   are ambiguous and a local engine is warm; otherwise it is skipped.
4. **LLM**: when the top p is below the action's learned threshold, or `needs-llm` wins.

The thresholds are per action and calibrated from logged outcomes (accepted, or the user
re-asked the LLM). The cold-start threshold is conservative, at 0.9 for ANSWER.

## Initial action registry

| id | kind | tool | surfaces |
|---|---|---|---|
| symbols.where-defined | answer | symbol index (exists) | vscode, onprem |
| context.pre-search | prefetch | preSearch (exists) | all |
| diag.typecheck | prefetch | LSP diagnostics / `tsc --noEmit` on touched files | vscode, onprem |
| lint.check / lint.fix | prefetch / answer(write) | ESLint, Biome, Ruff | vscode, onprem |
| dup.check | answer | jscpd | vscode, onprem |
| deadcode.check | answer | knip | vscode, onprem |
| deps.cycles | answer | dependency-cruiser / madge | vscode, onprem |
| arch.boundaries | prefetch | dependency-cruiser rules / our `scripts/check-*.mjs` | vscode, onprem |
| deps.audit | answer | osv-scanner / `npm audit` | vscode, onprem |
| secrets.scan | answer | gitleaks | vscode, onprem |
| tests.related | prefetch | `vitest related` file list | vscode, onprem |
| scaffold.* | answer(write) | Plop/Hygen templates, `ide-templates` | vscode, onprem |
| codegen.openapi / codegen.prisma / codegen.graphql | answer(write) | OpenAPI Generator/orval, Prisma, GraphQL Codegen | vscode, onprem |
| codemod.pattern | answer(write) | ast-grep | vscode, onprem |
| format.apply | answer(write) | Prettier/Biome/Black | vscode, onprem |
| memory.answer | answer | answerFromMemory (exists) | all |
| knowledge.review-dir | answer(write) | memory `/knowledge` `planReview` → confirm chip → `reviewDirectory` ([PRD 38](../specs/38-prd-knowledge-graph.md) §4.3) | all |
| knowledge.ask | answer | knowledge index + graph expansion ([deterministic-knowledge-index.md](deterministic-knowledge-index.md)); otherwise PREFETCH | all |
| knowledge.graph | answer | open the knowledge-graph view, focused on the named files | all |

A tool that isn't installed in the workspace isn't offered. Detection is via `package.json`
or the PATH, memoised per workspace.

## Sequence (one flow)

```
user text ─▶ runPreamble
   ├─ classify()                               (packages/prefetch, ≤ budget)
   ├─ route=answer, read      ─▶ executor ─▶ adoptAnswerWithoutModel  (skippedLlm)
   ├─ route=answer, write     ─▶ composer confirm chip ─▶ executor ─▶ adopt
   ├─ route=prefetch          ─▶ executors in parallel (withinMs) ─▶ host.turnContext (volatile tail)
   └─ route=llm               ─▶ answerFromMemory ─▶ model routing (unchanged)
outcome ─▶ trace `prefetch.decision` + llm_usage_log.route_score ─▶ head update
```

Rules:
- The gate runs inside the existing preamble. There is no second flow and no separate panel.
- The output of `/` actions renders in the same composer transcript.
- PREFETCH output is per-turn content, so it goes only in the trailing `<run-state>`,
  never in the system prompt. This keeps the prompt cache intact.
- Write actions never auto-run. A confirm chip is shown whatever p is.
- The executor deadline is enforced and Stop aborts it (the same `withinMs` and abort as
  preSearch).
- Cloud and web get the gate plus the read-only actions that need no shell. Analyzers run
  where the workspace is: VSIX, on-prem, or the cloud container sandbox.

## Cost and savings

- Each ANSWER logs an avoided call through the existing usage-row savings fold
  (`spend-contract`), estimated at the routed model's price for a median turn. This needs
  no new table or endpoint.
- Each PREFETCH logs the turns saved, compared with the run's own exploration baseline.
- The Pipeline route report (exists) gains a gate column: answer / prefetch / llm rates
  and accuracy.

## Code map

- `packages/prefetch/src/{registry.ts,classify.ts,lexical.ts,logprob.ts,calibrate.ts,index.ts}`:
  each file is under 200 lines.
- `brain-embedded/src/runStore/adoptAnswer.ts`: `answerDeterministically` iterates the
  gate's ANSWER actions instead of calling one function.
- `brain-embedded/src/runStore/runTypes.ts`: `answerWithoutModel` is replaced by
  `prefetch?: PrefetchPort`, with every caller migrated (VSIX runSetupPorts, chatParticipant,
  nativeBrainRun, chatReferences, tests).
- `clients/vscode/src/prefetch/{executors.ts,detectTools.ts}`: executors wrap the existing
  tools. Analyzers run through the existing exec/shell tool path.
- `agent-runtime`: the same executors for on-prem.
- `packages/local-inference`: adds a `logprobs(prompt, labels)` call on Synapse/WebLLM/Ollama.
- i18n: confirm-chip and trace labels go in the VSIX nls ×5 and the frontend catalogs ×5.

## Done-checks

1. "where is X defined" still answers with no model. The existing tests run unchanged.
2. `/dup` and "find duplicate code" both settle via jscpd with `skippedLlm: true` and a
   savings row.
3. An ambiguous request ("make this better") routes to the LLM. Tier 3 is never consulted
   when no local engine is warm.
4. A write action never runs without the confirm chip.
5. PREFETCH output appears only in the volatile tail; the cache-hit probe stays at ≥ 90%
   on turn 2.
6. The gate adds ≤ 30 ms p50 when tier 3 is skipped and ≤ 300 ms p95 with tier 3.
7. The Pipeline route report shows the answer/prefetch/llm split.
8. No file is over 400 lines, and there is no second flow.
