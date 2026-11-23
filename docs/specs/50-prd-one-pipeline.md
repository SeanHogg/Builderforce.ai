# PRD 50 — one pipeline above the kernel

> Status: design, copied from the Agent Pipeline Map (2026-11-22) before any consolidation.
> Source: `docs/specs/_scratch-agent-pipeline-map.md` (the downloaded map). Gap Register: `ROADMAP.md` › Make › Cloud and IDE agent runs › "One pipeline for every modality".
> This slice stops at the kernel. `runAgent` (`packages/agent-run/src/runAgent.ts:65`) calling `runAgentLoop` (`packages/agent-loop/src/loop.ts`) stays. Nothing inside that call is redesigned here.
> Implementation of later stages (`routeRun`, `planWork`, `evaluateRun`, stall/continuation, the second on-prem adapter) follows a later review of those sections. This file is the contract for the slice that starts now: the forks **above** `runAgent`.

## 0. Seams confirmed against the code (2026-11-22)

| Map said | Code actually has | Consequence for this slice |
|---|---|---|
| Surfaces fork above `runAgent` → `runAgentLoop` | `runAgent` is the only production importer of `runAgentLoop` (`runAgent.ts:37`, `:121`). `check:one-execution` enforces it. | Keep the kernel. Consolidate callers of `runAgent`, not the loop. |
| `entryPoint` defaults to `'web'` at `runPrepared.ts:38` | `brain-embedded/src/run/runPrepared.ts:38`: `entryPoint: req.entryPoint ?? 'web'`. `RunPolicy.entryPoint` is already required (`contract.ts:85`) and is a telemetry label, never a behaviour branch. | The default lives on the Brain request, not on `RunPolicy`. Delete the `?? 'web'`. A missing label fails the type, it does not become web. |
| Participant sets no `entryPoint` | `clients/vscode/src/nativeBrainRun.ts:108` `runNativeBrain` calls `runBrainLoop` (`:222`) with no `entryPoint`. It owns a second journal (`:144`–`:169`, `:255`–`:266`), calls `withRunPreamble` (`:180`), and wires its own tool/confirm ports. | Participant must enter through the panel host start, with `entryPoint: 'vscode'`. Its journal, prompt assembly and port wiring go. |
| Policy modules are replaced per surface (`policy/index.ts:108`) | `composePolicyHooks` spreads `Partial<PolicyModules>` over `defaultPolicyModules()`. Production `modules:` overrides: VSIX `runPrepared.ts:90` (compaction, model, finish); cloud `cloudAdapter.ts:167` via `cloudPolicyModules` (`cloudAdapterHooks.ts:104`: compaction, guards, finish); web reply `agentReplyRun.ts:206` (compaction only). Canvas and `onPremAdapter.ts:204` pass no `modules`. | Surfaces keep supplying **ports** (`createFinishHook(ports)`, `createGuardsHook(ports)`, a summarizer). They stop replacing the module. The hook stays the one in `policy/*`. |
| Four sub-agent starts | VSIX `childRunHost.ts` `startChild` re-enters an inner host start and skips `gateStarts` (`brainRunHostPorts.ts`). Cloud `cloudChildRuns.ts` opens a durable child execution. On-prem `onPremSubagents.ts:48` calls `runAgent` in-process with `childPolicy`. `subagent-spawn.ts` `spawnSubagentDirect` has its own `buildSubagentSystemPrompt` and enters the channel shim. Shared primitives live in `packages/agent-run/src/policy/subagents/child.ts` and are used by on-prem only. | One `spawnChild` re-enters `openRun` with lineage. `MAX_SUBAGENT_DEPTH` and `subagentSystemPrompt` (`packages/agent-loop/src/subagent.ts`) stay the single sources. |
| Full/quick routing is VSIX-only | `decideRunPipeline` (`brain-embedded/src/runStore/pipelineRoute.ts:21`) is called only from `prepareBrainRun` (`runPreamble.ts:121` ← `startRun.ts:125`). Returns null when `req.pipeline` is absent or `req.lineage` is set. | Not in this slice's code. Named here so the next slice has one owner. |
| Prompt is built in four layers above the kernel | Webview `useChatSystemPrompt.ts:41`; host `clients/vscode/src/runPreamble.ts:24` `withRunPreamble`; brain-embedded `prepareBrainRun` (`runPreamble.ts:64`); participant `prompt.ts:16` `buildSystemMessages`. `runAgent.ts:84` uses `task.transcript ?? openingRows(...)`, so a surface transcript skips governance/persona rows. | This slice deletes the participant's layer only. The other three stay until `buildOpening` (later slice). |
| Second on-prem adapter | `onPremAdapter.ts:204` and `channelAdapter.ts:216` both call `runAgent`. The channel path keeps its own compaction, stall-recovery and run-governance beside the kernel. | Out of this slice. Do not delete it here. |

## 1. What "above the kernel" means

A surface is above the kernel when it does any of these **before** `runAgent`:

1. Creates the chat id or the run id.
2. Runs a start gate (change set, run journal, delta capture).
3. Chooses or labels `entryPoint`.
4. Assembles a system prompt or a transcript.
5. Binds policy modules (`modules:`).
6. Starts a sub-agent by a path that is not the same start as a user chat.

`runAgent` and everything it calls (`composePolicyHooks` as used inside the driver, `openingRows` when the surface did not pass a transcript, `runAgentLoop`, settle) is the kernel. This slice does not edit those bodies except to stop accepting a module override from a surface (section 3).

## 2. Contracts for this slice

### 2.1 `entryPoint` is required on the Brain request

`BrainRunRequest.entryPoint` becomes required. The wire values stay the existing `EntryPoint` union from `@builderforce/learned-routing` (the same union `RunPolicy.entryPoint` already requires). No new value in this slice.

```ts
/** Telemetry label. Required. Never branched on for behaviour. */
entryPoint: EntryPoint;
```

`runPrepared` assigns `req.entryPoint` with no default:

```ts
entryPoint: req.entryPoint, // was: req.entryPoint ?? 'web'
```

Callers that omit it fail the typecheck. The participant does not become a new caller of `runPrepared`; it stops calling `runBrainLoop` (section 2.2).

Known callers and the label they already pass, or must pass:

| Caller | Label |
|---|---|
| VSIX panel host | `'vscode'` (already) |
| VSIX participant, after 2.2 | `'vscode'` via the panel host |
| Web chat reply / web panel | `'web'` (already, `useBrainPanelController.ts:205`) |
| Canvas | `'canvas'` |
| Cloud tick | `'cloud'` |
| On-prem / channels | `'on-prem'` |

A test that passed `entryPoint: 'web'` to prove the old default is rewritten to pass the label explicitly. No assertion is loosened.

### 2.2 Participant enters through the panel host start

`runNativeBrain` (`clients/vscode/src/nativeBrainRun.ts`) stops owning a run. It calls the same host start the panel uses (`brainRunHost` / the function that today handles `run.start`), with:

- `entryPoint: 'vscode'`
- the participant's chat id, user turn, model, and stream events as **ports**
- no second journal, no second system-prompt builder, no second tool-confirm wiring

Deleted from the participant path once the host start is the only caller:

| Owned today | Owner after |
|---|---|
| `runId = native:${chatId}:…` and `recovery.recordStarted/Checkpoint/Finished` (`nativeBrainRun.ts:144`, `:255`) | the host's `gateStarts` journal |
| `withRunPreamble` + `buildSystemMessages` (`prompt.ts:16`) | the host preamble (still duplicated with the webview until `buildOpening`; not deleted in this slice) |
| `createNativeRunTool` / `needsConfirm` / `subscribeRun` confirm modal wiring that parallels the host | the host tool port; the participant modal is a `HumanChannel` the host already accepts |

`nativeBrainRun.ts` may remain as a thin adapter (events in, host start out) under ~150 lines. It must not call `runBrainLoop` or `runAgent`.

### 2.3 Surfaces pass ports, not modules

`RunAgentInput.modules` stays for tests and for the one place that binds engine ports. Production adapters stop passing a replacement hook.

The allowed production shape is a ports object the **existing** factory already accepts:

| Surface | Today | After this slice |
|---|---|---|
| VSIX `runPrepared.ts:90` | replaces `compaction`, `model`, `finish` | calls `createCompactionHook`, `createFinishHook` (and the recorded-model wrapper) **as the module's own factory**, fed Brain ports. The `modules:` key may remain only as `{ compaction: createCompactionHook(brainPorts), finish: createFinishHook(brainPorts), model: recordedModelHook(...) }` — those factories live in `packages/agent-run/src/policy/*`, not in `brain-embedded`. `brainFold.ts` / `brainFinish.ts` become port builders or are deleted if the factory already covers them. |
| Cloud `cloudPolicyModules` | replaces `compaction`, `guards`, `finish` | same factories, cloud ports (`cloudFinishPorts`, `GuardPorts`, gateway summarizer). `withShipGate` stays a port in front of `createGuardsHook`, not a second guards module. |
| Web `agentReplyRun.ts:206` | replaces `compaction` only | `createCompactionHook({ summarize })` from `policy/compaction`. Finish and guards stay the defaults, which already read ports. |
| Canvas, on-prem `onPremAdapter` | no `modules` | unchanged. They already finish through the default hook. |

`composePolicyHooks` keeps the override parameter so a test can still drive one module. A comment at the call states that a production adapter must not pass a hook defined outside `policy/*`.

This slice does **not** move `openLinkedWorkHold` or `specTicketCoverageGate` into the shared finish module. Those are the VSIX-only work-ledger (map section 3, item on work items). They stay bound as finish **ports** the VSIX supplies, so the surface no longer replaces the finish module's logic — it supplies the two predicates the shared finish hook already knows how to call. If the shared finish hook has no such port yet, add a `FinishPorts` field; do not copy the gate bodies.

### 2.4 `spawnChild` re-enters the same start

One function, in `packages/agent-run/src/policy/subagents/child.ts` (the file that already owns `childPolicy`, `childProvider`, `childResult`):

```ts
export interface SpawnChildRequest {
  /** The owner's run id. Required. */
  parentRunId: string;
  /** Depth of the child. `spawnChild` refuses at `MAX_SUBAGENT_DEPTH`. */
  depth: number;
  task: string;
  role?: string;
  /** Work-item ids this child owns. Empty in this slice; `planWork` fills them later. */
  workItemIds?: readonly string[];
}

export interface SpawnChildPorts {
  /** The same start a user chat uses on this surface. Creates chat id, run id, and passes the start gate. */
  openRun(request: { prompt: string; entryPoint: EntryPoint; lineage: { parentRunId: string; depth: number } }): Promise<{ runId: string; output: string }>;
}

/** Refuses at MAX_SUBAGENT_DEPTH. Builds the child prompt with `subagentSystemPrompt` only. */
export function spawnChild(request: SpawnChildRequest, ports: SpawnChildPorts): Promise<{ runId: string; output: string }>;
```

Each surface's spawn tool calls `spawnChild` and supplies `openRun` as the start it already uses for a user message:

| Surface | `openRun` port | Deleted spawn path |
|---|---|---|
| VSIX | panel host start, which calls `gateStarts` then `startRun` | `childRunHost.startChild` inner start that skips `gateStarts` |
| Cloud | the durable-execution **port** (create child execution) fed through `spawnChild`, not a second policy | policy inside `cloudChildRuns.ts` beyond "create the execution record" |
| On-prem | `onPremAdapter`'s `runAgent` entry, with lineage | `onPremSubagents.ts` direct `runAgent` |
| Legacy sessions | same on-prem `openRun` | `spawnSubagentDirect` and `buildSubagentSystemPrompt` — **deleted in this slice only if every caller is the spawn tool**. If a channel command still calls it, leave the file and name it as the blocker. Do not leave both live without a caller count. |

Children get a change set, a journal start, and delta capture because `openRun` is the user path. `entryPoint` is the parent's, not `'web'`.

## 3. Codemap — this slice only

| Behaviour | Owner after | Deleted or reduced |
|---|---|---|
| Kernel loop | `packages/agent-loop/src/loop.ts` | untouched |
| Kernel driver | `packages/agent-run/src/runAgent.ts` | untouched except a comment if `modules` docs change |
| `entryPoint` required | `BrainRunRequest` in brain-embedded; `runPrepared.ts:38` drops the default | the `?? 'web'` |
| Participant start | panel host start | `nativeBrainRun` journal + `prompt.ts` `buildSystemMessages` if no other caller |
| Finish / guards / compaction factories | `packages/agent-run/src/policy/{finish,guards,compaction}` | surface files that reimplement the hook (port builders may stay) |
| `spawnChild` | `packages/agent-run/src/policy/subagents/child.ts` | VSIX inner start; on-prem direct `runAgent` spawn; `buildSubagentSystemPrompt` when unused |
| `MAX_SUBAGENT_DEPTH`, `subagentSystemPrompt` | `packages/agent-loop/src/subagent.ts` | no second copy |

### Explicitly not in this slice

| Item | Why it waits |
|---|---|
| `routeRun` (full/quick + one model decision) | Below the entry but it changes gateway and on-prem ranking. Next slice. |
| `planWork`, work ledger, finish gate, `evaluateRun` | VSIX-only today; needs the ledger shape reviewed. |
| One stall module, one continuation owner, one `buildOpening` | Four prompt layers and three continuation owners. After spawn and entryPoint, so children and the participant already share a start. |
| Delete `channelAdapter.ts` and the `builderforce/agent-loop/` shim | Second on-prem adapter. Last. |
| `capabilities: new Set()` / `approvalGates: []` in `runPrepared.ts:39` | Kernel gate feed. Separate defect; do not bundle it into the module-override edit. |
| Stale `loop.ts` header | One-line fix, kernel file. Not this slice. |

## 4. Sequence after this slice

```
VSIX panel ──────────────┐
VSIX participant ────────┤  (same host start, entryPoint 'vscode')
Web / canvas / cloud / on-prem  (their own start, entryPoint required, no ?? 'web')
                         │
                         ▼
              start gate (change set, journal, delta)   ← children too
                         │
                         ▼
              runAgent → runAgentLoop                   ← unchanged
                         │
              spawn_agent tool
                         │
                         ▼
              spawnChild → openRun(lineage)             ← same start as the row above
```

Routing, planning, opening-prompt unification, and grading still sit where they sit today. The map's red boxes for those are unchanged by this slice.

## 5. Tests (existing assertions stay)

| Defect | Test |
|---|---|
| Missing `entryPoint` does not become `'web'` | Typecheck, plus a brain-embedded test that constructs a request without the field and expects a compile error (or, if the request is a runtime object, a thrown error — not a silent `'web'`). |
| Participant label | A test that the host start invoked by the participant records `entryPoint: 'vscode'`. |
| Child passes the start gate | A VSIX test that `spawn_agent` records a journal start / change-set id. Fails before the fix because `startChild` skips `gateStarts`. |
| No second sub-agent prompt | Grep-level test or conformance: `buildSubagentSystemPrompt` has no production caller once `spawnSubagentDirect` is deleted. |
| Surfaces do not replace finish logic | Conformance: canvas, web reply, and on-prem still settle through `finishHook` (or `createFinishHook(ports)`), and a refused finish port returns the same block reason on each. |

Run the existing suites unchanged: `packages/agent-run/test/conformance/`, `brain-embedded` cross-adapter conformance, `agent-runtime/src/conformance/crossAdapter.test.ts`, and the files touched. Do not rewrite an assertion to go green.

## 6. Decisions

1. **Stop at `runAgent`.** The user asked to consolidate duplication above `runAgent => runAgentLoop` and then stop. `routeRun`, `planWork`, `evaluateRun`, stall/continuation, and the second on-prem adapter are specified so they are not forgotten, and not implemented in this slice.
2. **`RunPolicy.entryPoint` was already required.** The bug is the Brain request default, not the policy type.
3. **`modules` stays for tests and for factory binding.** Deleting the field would break the conformance suites. The rule is: a hook body lives in `policy/*`; a surface passes ports into that factory.
4. **Work-item gates stay VSIX ports** until `planWork`. Moving their bodies now would start the next slice.
5. **Cloud keeps a durable execution as a port**, not as a policy. `spawnChild` does not know about Durable Objects.

## 7. Done for this slice

- This file is the spec. The scratch copy remains as the source diagram until the Gap Register entry is rewritten to point here.
- `entryPoint` has no `'web'` default.
- The participant starts through the panel host.
- Spawn on every surface that has a spawn tool goes through `spawnChild` → the user start.
- Production finish/guards/compaction hook **bodies** are not defined outside `policy/*`.
- No edits under `runAgentLoop`. No deletion of `channelAdapter`, `progressGuard`, `continueChat`, or `useChatSystemPrompt` in this slice.
