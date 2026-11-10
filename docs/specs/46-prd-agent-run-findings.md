# PRD 46 — Agent-run findings in the Visualizer

**Status:** Approved by the operator 2026-11-09 (scope answers below) · **Owner:** agent runtime + knowledge-graph-view
**Surfaces:** VS Code (VSIX). The web and Chrome hosts bind no port, so the new drawer stays hidden there.
**Source run:** VS Code chat #70776 ("Review the Visualizer and add a few more visualization…", local chat 70776 /
server chat 220, `local/kimi-code/kimi-for-coding`, VSIX 2026.10.153). The diagnostics report called it **Inconclusive**.

## 1. Why

Run #70776 spent 13 m 38 s and 3.06 M prompt tokens for 28 k completion tokens, then the operator stopped it.
Every one of its problems is visible in the recorded trace, and no deterministic check named any of them:

| # | What the trace shows | Cause (checked in code) |
|---|---|---|
| F1 | 21 read-only plan turns, then a forced `hand_off` | `PLAN_TURN_BUDGET = 20` (`packages/run-policy/src/policy.ts:346`); the B1 readiness advisory is never traced, so whether it fired is unknowable |
| F2 | 13 write turns, **one write each**, each re-sending ~90–110 k of prompt | model behaviour; B3 multi-edit exists and went unused |
| F3 | 13 writes, **zero** typecheck/test/diagnostics calls | PRD 45 ports are built (`clients/vscode/src/verify/index.ts:43`) but **never bound** into the Brain host request, so post-edit diagnostics (`callRunner.ts:193-202`) and the ship gates are inert |
| F4 | `edit_file` on `labels.ts` left the file unparseable (`};` closed the object early, spreads orphaned) | `applyStringEdit` is atomic; the model's `new_string` changed bracket balance. Nothing checks balance; diagnostics also skip whenever another advisory is attached (`callRunner.ts:200`) |
| F5 | 4 `ticket-create` calls of 6.7–9 KB, then the session implemented them inline | the hand-off copies the plan summary into every ticket; owned by the parallel #70776 fix (ROADMAP "Editor run #70776") |
| F6 | plan and code roles both on the same model | a `local/…` pin serves every role — the hand-off buys nothing |
| F7 | turn 21 took 123 s writing 19.7 KB of `hand_off` args | forced hand-off asks for the full research summary; latency guard covers code/verify only |
| F8 | "Tools advertised: 1" | real: the forced hand_off turn. The B8 test feeds synthetic events and never exercises the producer (`turnRecorder.ts:148`) |
| F9 | `chat-replay-baseline.cjs` counts `agent.message`, `steer.applied`, `run.budget_*`, … as tool calls | classifies by label, not `category === 'tool'` |

## 2. Operator decisions (2026-11-09)

- OD-1 The **Visualizer** is the surface that detects these issues (not the copy-diagnostics report).
- OD-2 **Finish** the three cameras the stopped run left half-written (4+1, Architecture Style, Key Features) in this pass.
- OD-3 **Fix the runtime faults** in the same pass (F3, F4, F8, F9 here; F1-trace/F5 coordinated with the parallel session).
- OD-4 Ship a `release_notes` row (category `new`) **and** a blog post.

## 3. End state

```
journal (local-first-v3)            extension host (clients/vscode)                 webview (knowledge-graph-view)
 step rows per chat  ── getMessages ─▶ knowledge/agentRuns.ts                         source.agentRuns?: AgentRunsPort
                                       traceWithPersistedSteps → detectRunFindings ─▶ AgentRunsPanel (drawer "agentRuns")
                                       cache by (chatId, lastSeq)  ◀── knowledge.call   ├ run list
                                                                     agentRuns/         ├ turn strip (read/write/forced/failed; bar = prompt tokens)
                                                                     agentRunReport     ├ findings + evidence (turn, tool, path)
                                                                                        └ files touched (written / checked) → "show on graph"
```

### 3.1 Detectors — `brain-embedded/src/runFindings/` (pure, browser-safe)

One detector per file, each `(view: RunView) => RunFinding[]`, composed by a registry array (adding a detector = one
row). `RunView` is built once per run from the merged trace: ordered turns (each `llm.complete` plus the tool steps that
follow it, `category === 'tool'` only), per-turn role/model/usage/duration/args bytes, per-turn assistant text, written
paths, check calls. It **reuses** `modelTurnLog`, `computeRunProgress`, `routingByRole`, `staffingSummaryInTrace`,
`toolExposureInTrace`, `claimsReady` (run-guards) and `isCodeChangeTool` — no second copy of any of them.

| kind | severity | fires when | params |
|---|---|---|---|
| `analysis_overrun` | warn ≥ 8 read-only turns before the first write; error when the plan budget forced a hand-off | `readTurns`, `firstWriteTurn` |
| `unkept_readiness` | warn | a readiness claim followed by ≥ 2 read-only turns | `claims`, `readTurnsAfter` |
| `serial_single_writes` | warn ≥ 4 turns that each made exactly one write | `turns`, `promptTokens` (sum over those turns) |
| `prompt_bloat` | warn when prompt : completion ≥ 50 and ≥ 500 k prompt tokens | `ratio`, `promptTokens`, `perWrite` |
| `unverified_writes` | error | files written with no successful check afterwards (diagnostics/typecheck/test tool, or a `run_command` whose command matches a typecheck/test/lint pattern) | `files`, `writes` |
| `bracket_break` | error | an `edit_file`/`write_file` whose `new_string` changes `{}`/`()`/`[]` balance relative to `old_string` (strings and comments ignored) | `path`, `delta` |
| `edit_churn` | warn | the same path written ≥ 4 times | `path`, `writes` |
| `filed_then_inline` | info | tickets created this run, none dispatched, and the session itself wrote code afterwards | `tickets` |
| `same_model_roles` | info | plan and code turns served by one model while a hand-off happened | `model` |
| `oversized_args` | warn | a non-write tool call with ≥ 4 KB arguments, or ≥ 2 calls of one tool sharing ≥ 1 KB of identical text | `tool`, `bytes`, `calls` |
| `slow_turns` | warn | turns ≥ 60 s | `turns`, `slowestMs` |
| `repeated_narration` | info | consecutive pre-call texts with word-set overlap ≥ 0.8 | `turns` |
| `stopped_unverified` | error | the run ended on a user Stop with `unverified_writes` outstanding | `files` |

Thresholds are data (`RUN_FINDING_POLICY`). Output is sorted by severity then first evidence step — deterministic.

### 3.2 Bracket balance — `packages/agent-tools/src/editBalance.ts` (pure)

`bracketDelta(before: string, after: string, ext: string): { curly: number; paren: number; square: number }` —
lexes JS/TS/JSON (skips string, template and comment bodies). Used twice: by the `bracket_break` detector, and live by
`callRunner.ts` which appends a post-edit note on the edit's own result when any delta ≠ 0 (works without a verifier).

### 3.3 Port contract (consumer-owned) — `packages/knowledge-graph-view/src/types.ts`

```ts
export type AgentRunSeverity = 'info' | 'warn' | 'error';
export interface AgentRunSummary { id: string; title: string; startedAt: string; endedAt: string; models: readonly string[];
  turns: number; counts: Readonly<Record<AgentRunSeverity, number>> }
export type AgentRunTurnKind = 'read' | 'write' | 'forced' | 'text' | 'failed';
export interface AgentRunTurn { index: number; role: string; model: string; kind: AgentRunTurnKind; toolCalls: number;
  promptTokens: number; completionTokens: number; durationMs: number }
export interface AgentRunEvidence { step: number; turn?: number; label: string; path?: string; excerpt?: string }
export interface AgentRunFinding { id: string; kind: string; severity: AgentRunSeverity;
  params: Readonly<Record<string, string | number>>; evidence: readonly AgentRunEvidence[] }
export interface AgentRunFile { path: string; writes: number; checked: boolean }
export interface AgentRunReport { summary: AgentRunSummary; turns: readonly AgentRunTurn[];
  findings: readonly AgentRunFinding[]; files: readonly AgentRunFile[] }
export interface AgentRunsPort { list(): Promise<readonly AgentRunSummary[]>; report(id: string): Promise<AgentRunReport | null> }
// KnowledgeGraphSource gains: agentRuns?: AgentRunsPort
```

`brain-embedded` returns its own structurally identical type; the VSIX adapter is where the two meet and the compiler
proves they match. The view never imports brain-embedded.

### 3.4 Host — `clients/vscode/src/knowledge/agentRuns.ts`

New `KnowledgeCall` ops `agentRuns` and `agentRunReport` (`knowledgeProtocol.ts`), dispatched in
`knowledgeBridge.ts`. Lists the 20 most recent local chats **of the Visualizer's project** that have step rows; the
report reads `persistence.getMessages(chatId)` → `traceWithPersistedSteps(messages, [])` → `detectRunFindings`. One
in-process memo keyed `(chatId, lastSeq)` — a run that has not moved is never recomputed. Webview side:
`webview/src/knowledgeGraph/hostAgentRuns.ts` (copy the shape of `hostReviewRuns.ts`), bound in
`hostKnowledgeGraphSource.ts`.

### 3.5 View — drawer `agentRuns`

`surface/panels.ts` row with `available: (env) => env.hasAgentRuns` (env flag = `!!source.agentRuns`).
Files under `surface/drawers/agentRuns/`: `agentRunsModel.ts` (pure: severity order, strip geometry, finding text
params), `AgentRunsPanel.tsx` (container + hook `useAgentRuns.ts`), `AgentRunList.tsx`, `TurnStrip.tsx` (SVG, tokens
via `cssVar`), `RunFindingList.tsx` (reuses `EvidenceList` styling conventions), `RunFiles.tsx` ("show on graph" calls the
existing focus API). Labels: `labels/surface.agentRuns.ts` nested under `agentRuns: {…}`, finding texts keyed by `kind`
with `{param}` placeholders; all five catalogs (`frontend/src/i18n/messages/*.json` `knowledgeGraph.*`) with real
translations. No file over ~200 lines; dark/light via tokens; ≤ 360 px wraps.

### 3.6 Runtime fixes in this PRD

- **Bind the PRD 45 ports** where the VSIX builds the Brain host request (beside `needsConfirm`): `verifier`, `git`,
  `reviewer` from `clients/vscode/src/verify/index.ts`. Post-edit diagnostics go live (A3).
- `callRunner.ts`: post-edit diagnostics run even when another advisory is attached (notes concatenate); bracket-balance
  note (§3.2).
- `completionGuard.ts` `canCompleteTicket`: PRD 45 §4.3 condition (no outgoing changes that fail `outgoingGate` when the
  git port is bound).
- `callPreflight.ts` one call into `shipGates.ts` — **held** until the parallel #70776 session commits its
  `callPreflight.ts` change (file ownership), then added.
- B8: a `regression:` test that drives the producer (`turnRecorder`) and reads `toolExposureInTrace`.
- `chat-replay-baseline.cjs`: tool calls = `meta.category === 'tool'`; readiness via the same regex as `claimsReady`.

## 4. Workstreams

| WS | Files (exclusive) | Done when |
|---|---|---|
| W1 detectors | `brain-embedded/src/runFindings/**`, `packages/agent-tools/src/editBalance.ts(+test)` + its index export, a trimmed fixture of #70776 under `runFindings/fixtures/` | one unit test per kind + `regression: chat #70776 yields analysis_overrun, serial_single_writes, unverified_writes, bracket_break, filed_then_inline, same_model_roles, oversized_args, slow_turns, stopped_unverified` from the real journal fixture |
| W2a cameras | knowledge-graph-view `labels.ts`, `types.ts` (ViewMode), `labels/core.ts`, `labels/surface.{4plus1,style,features}.ts`, the three cameras + `surface/style/**`, `surface/features/**`, `surface/cameras.tsx`, camera-list tests, `renderProbe.ts`/perf baseline, five catalogs | package typecheck + touched tests green; `emptyGraph.surface.test.tsx` renders all cameras |
| W3 runtime | `clients/vscode` host-request wiring, `brain-embedded/src/runStore/callRunner.ts`, `completionGuard.ts`, B8 producer test, `api/scripts/chat-replay-baseline.cjs` | parity scenarios unchanged; `regression: diagnostics run when another advisory is attached`; `regression: bracket break reported on the edit result (chat #70776)` |
| W2b+W4 drawer + host | knowledge-graph-view `types.ts` (port), `surface/panels.ts`, `registry.ts` env flag, `drawers/agentRuns/**`, `labels/surface.agentRuns.ts`, catalogs; `clients/vscode/src/knowledge/{agentRuns.ts,knowledgeProtocol.ts,knowledgeBridge.ts}`, webview host files | after W1 + W2a; host test over a fake persistence; drawer tests (hidden without port, list, report, strip, findings) |
| W5 ship | review (Opus, cross-package) → fixes → VSIX package/install → commit + push; release note + blog | §5 |

Not touched here (owned by the parallel #70776 session): `planHandoff.ts`, `handOffParallelism.ts`, `callPreflight.ts`
(until it commits), `routingByRole.ts`, `staffingSummary.ts`, `runBackstops.ts`, `deterministicFinish.ts`,
`packages/run-guards/**`, `packages/local-first/**`.

## 5. Success

- Run #70776's journal, opened in the Visualizer's Agent-runs drawer, shows ≥ 9 named findings and zero "inconclusive".
- A fresh VSIX run that breaks bracket balance sees the note on the edit's own result.
- A fresh VSIX run's `edit_file` on a `.ts` file returns language-server errors on the result (verifier bound).
