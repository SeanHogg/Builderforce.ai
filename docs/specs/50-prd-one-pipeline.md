# PRD 50 — one pipeline above the kernel

> Status on 2026-11-23: shared entry, child admission, Brain preflight and compaction, scoped ticket and spec evidence, routing feedback, and the on-prem execution entry are implemented. Relay and cloud assignments enter the ledger at opening, and cloud owners read durable child evidence before settlement. Shared verification records executed checks in the run tally. Native-session parity, continuation recovery, and provisioned editor, channel, and cloud validation remain open. See the [pipeline map](./_scratch-agent-pipeline-map.md) for current coverage.
> Source: `docs/specs/_scratch-agent-pipeline-map.md` (the downloaded map). Gap Register: `ROADMAP.md` › Make › Cloud and IDE agent runs › "One pipeline for every modality".
> This slice stops at the kernel. `runAgent` (`packages/agent-run/src/runAgent.ts:65`) calling `runAgentLoop` (`packages/agent-loop/src/loop.ts`) stays. Nothing inside that call is redesigned here.
> Implementation of later stages (`routeRun`, `planWork`, `evaluateRun`, stall/continuation, the second on-prem adapter) follows a later review of those sections. This file is the contract for the slice that starts now: the forks **above** `runAgent`.

## Full workflow follow-up

The entry slice has been extended. openRun and the Brain preamble share routing defaults. The persisted run state carries the decision across durable ticks. Full routing is the default. Existing editor settings and explicit host configuration can opt into auto routing. Shared opening assembly renders governing instructions ahead of history. Brain and channel use that opening rather than assembling separate transcript prefixes.

planWork and evaluateRun now support host-scoped explicit assignments. The shared runtime keeps ids and criteria in run state, presents them on turns, checks evidence in one batch on finish, and emits counts in terminal diagnostics. Brain and in-process on-prem can bind this contract. Existing ticket and spec checks still operate. Assigning and resolving existing surface work through this contract, child evidence, downstream scoring, remaining gate and continuation consolidation, and the second on-prem adapter are still open.

The follow-up fixes early VSIX admission before shared validation, cloud admission stamps overwritten by the rebuilt child payload, Brain calling removed progress and retry hooks, a missing Brain failure-synthesis marker, and prose finishes skipping close-out. The detailed current status lives in the pipeline map. Historical slice text below describes the initial contract.

The next follow-up wires Brain's ticket and spec checks and cloud PR handoff into the ledger. Children now carry scoped assignments on all three hosts. The runtime excludes unresolved completed runs from routing feedback and takes queued follow-ups after finish-tool results. Brain defers native approval until the editor resolves the tool and workspace path, and it records the driver's sole closing synthesis. On-prem sessions, tickets and children now share an execution entry. The roadmap lists the remaining evidence, gate and wake ownership work.

## Implementation review (2026-11-23)

The [pipeline map](./_scratch-agent-pipeline-map.md) now describes the inspected checkout. Sections 0–7 below retain the original slice contract and historical rationale; they must not be read as current-state findings. This review supersedes stale file names and implementation assumptions in those sections.

| Contract | Inspected status | Remaining work |
| --- | --- | --- |
| Required entryPoint (§2.1) | Required on Brain request; runPrepared has no default; openRun rejects a missing policy label | RunEntryPoint aliases shared EntryPoint; Brain conformance execution fails on the existing tool-dispatch path (see validation) |
| Participant through panel host (§2.2) | Implemented by participantRun.ts runViaHost → host.start; host labels vscode | Host gate tests pass; participant/host integration needs the built Brain package |
| Factories own policy (§2.3) | openRun composes surface ports for every inspected adapter | Recorded preflight facts and native history ports enter shared factories; no compaction.hook escape hatch remains |
| Shared spawnChild (§2.4) | Implemented by policy/subagents/child.ts; VSIX, durable cloud, in-process on-prem and all four legacy callers reach it | Authenticated host starts and native admission/completion semantics stay surface-owned |
| Children pass editor gate | Implemented through startThrough → gated.start | Does not imply a common start lifecycle across all surfaces |
| Kernel unchanged by this review | Entry, spawning, preflight and compaction changes stay above the kernel | Preserve runAgent → runAgentLoop |

Adjacent work has also advanced beyond the baseline: shared routeRun now owns full/quick scoring, Brain openingSections owns editor opening assembly, and deterministic close-out runs through openRun instead of a duplicate direct call from startRun. These do not complete routing configuration parity, cross-surface opening, or continuation consolidation.

### Implemented child-start contract (§2.4)

The generic contract in §2.4 is now implemented. prepareChildStart validates registered entryPoint, nonempty owner/task/parent identity and integer child depth before host effects. spawnChild<Result> calls the scoped host start without interpreting its native result. The implementation preserves these requirements:

- Carry the parent's EntryPoint explicitly; openRun requires it.
- Define depth as the CHILD depth: allow integer depths 1 through MAX_SUBAGENT_DEPTH; reject deeper/invalid requests before start side effects. Existing checks on PARENT depth refuse spawning when the parent is already at the cap.
- Carry the owner's display identity and optional persona/base prompt, so shared subagentSystemPrompt preserves existing child instructions and inherited context.
- Separate background admission from eventual completion. VSIX spawn controls return a handle while observing the host completion promise separately; cloud admission returns a durable handle; on-prem childRunner returns a completed report. The generic start-result port preserves those behaviors. Do not await cloud completion inside a durable start request.
- Keep authorization in each authenticated start port. Shared lineage/depth validation does not replace tenant scoping, session agent allow-lists, or host tool approvals.
- Preserve all legacy callers. spawnSubagentDirect has FOUR production call sites: sessions-spawn-tool.ts, commands-subagents.ts, infra/local-agent-transport.ts and transport/local-adapter.ts. All four now reach shared spawnChild through that compatibility adapter; keep the adapter for gateway/session delivery, configured depth and agent allow-list authorization.
- The old buildSubagentSystemPrompt name is absent. Current buildSubagentSessionPrompt already uses shared subagentSystemPrompt and MAX_SUBAGENT_DEPTH, with session-specific additions. Remove only after its live callers and necessary session behavior migrate.
- openRun is the shared runtime entry; identity, editor journal/delta capture and durable execution creation still belong to host lifecycle ports. Passing openRun alone is not proof that a child passed the same host start as a user.

### Policy and enforcement corrections

The production composition owner is packages/agent-run/src/openRun.ts. Adapters supply surface ports instead of modules. SurfacePorts.preflight now accepts RecordedModelPreflight data, not a hook. The shared policy/model createModelHook factory constructs the event and verdict, preserving the host plan model and suppressing a second check or repeated notices. Brain preflightRecorded.ts only snapshots cell facts. SurfacePorts.compaction now accepts only CompactionHookOptions. Its history strategy lives in policy/compaction/history.ts: memo reuse, immutable source rows, summary deadline and fallback, one timeout attempt per run, row comparison and saved-token accounting. Brain brainFold.ts supplies storage, native-row conversion, summary transport, activity/diagnostic sinks and recordFold for durable markers; it defines no hook body. The existing compactionSavedTokens API re-exports the shared implementation.

check-one-execution.mjs enforces imports, not the ownership of supplied hook bodies. The inaccurate enforcement comment was removed. The preflight data contract, shared-factory regressions and production-door single-check/no-duplicate-notice regression replace its callback exception. The compaction callback exception is also removed from the type contract; runPrepared.door.test.ts checks history ports and absence of the hook field. The import guard is not claimed to inspect arbitrary callback semantics.

### Validation and upkeep

Coverage to retain: agent-run test/entry/openRun.test.ts and test/conformance/, Brain crossAdapterConformance.test.ts and runStore/openingSections.test.ts, VSIX participantRun.test.ts, brainRunHost.entryPoint.test.ts and hostStartGate.test.ts, and runtime conformance/crossAdapter.test.ts and onPremSubagents.openRun.test.ts. Existing assertions remain acceptance requirements; this source review is not a test pass.

The initial diff was verified before edits, including runStore/runTypes.ts; none of the prior reports were assumed applied. Added shared spawn coverage (18 cases), shared history strategy coverage (3 cases), durable prompt round-trip coverage, and an on-prem standing-instruction assertion. Existing preflight regressions remain. Repaired malformed newline literals in the participant regression fixture and runSetup turn-context join; typed existing test mocks/callback parameters so agent-run can typecheck.

Validation on 2026-11-23:

- Shared focused suites: **13 files / 88 tests pass**, covering spawning, history, openRun, recorded preflight, routing and conformance. Agent-run typecheck passes with the TypeScript 6 compiler and `--ignoreDeprecations 6.0`.
- Brain: **4 files pass** (recorded preflight, saved-token accounting, fold deadline and production door). Its two conformance files fail: baseline c56ce694e also fails these files, with the same premature tool-dispatch failure and missing model-window request; added entry labels exercise that same failure. Brain typecheck reports existing TurnRetry/TurnSession.recover and missing BrainRunContext.progress errors, plus missing @seanhogg/bfi-web and @mlc-ai/web-llm.
- Full agent-run suite: 821 pass / 2 fail before adding spawn/history cases. The forcedTurns trace-step and failureSynthesis extra-call failures both reproduce on a detached c56ce694e worktree. No assertions were loosened.
- VSIX hostStartGate and childRunSpawner pass (13 tests); participant and host entry integration cannot load the built @seanhogg/builderforce-brain-embedded package. VSIX typecheck is blocked by missing vscode type definitions after the newline syntax repairs.
- Runtime onPremSubagents passes (6 tests, including the standing-instruction assertion); runtime conformance cannot load @sinclair/typebox; legacy tests cannot load @aws-sdk/client-bedrock. Cloud child tests cannot load @neondatabase/serverless. Runtime typecheck reports unresolved dependencies including @sinclair/typebox, qrcode-terminal and @opentelemetry packages. API typecheck exhausted the default Node heap at about 4 GiB. Neither passed.
- check-one-execution --enforce, the source-package graph check and git diff --check pass. TypeScript syntax parsing passes for all 34 changed/untracked source files. Syntax and repository guards do not establish runtime parity; no live run was traced.

Validation tools were installed outside the repository manifests before the user requested no package installs. No further installs are performed. Remaining missing packages are reported as blockers.

For every subsequent implementation, update the current pipeline map, this status table and ROADMAP.md together. Name which forks were removed, which behavior remains surface-specific, actual validation results and any blocker.

## 0. Historical baseline: seams confirmed on 2026-11-22

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
  parentRunId: string;
  entryPoint: EntryPoint;
  /** CHILD depth: integer 1 through MAX_SUBAGENT_DEPTH inclusive. */
  depth: number;
  owner: string;
  task: string;
  role?: string;
  persona?: SubagentPersona;
  basePrompt?: string;
  workItemIds?: readonly string[];
}

export interface ChildStartRequest {
  prompt: string;
  systemPrompt: string;
  entryPoint: EntryPoint;
  lineage: { parentRunId: string; depth: number };
  workItemIds: readonly string[];
}

export interface SpawnChildPorts<Result> {
  /** Authenticated/scoped user-start port; returns its native admission handle OR completed result. */
  openRun(request: ChildStartRequest): Promise<Result>;
}

/** Validate before invoking the port; build standing instructions with subagentSystemPrompt only. */
export function spawnChild<Result>(request: SpawnChildRequest, ports: SpawnChildPorts<Result>): Promise<Result>;
```

Each surface's spawn tool calls `spawnChild` and supplies `openRun` as the start it already uses for a user message:

| Surface | `openRun` port | Deleted spawn path |
|---|---|---|
| VSIX | childRunHost calls spawnChild then the already-gated host start | Separate standing-prompt assembly; existing asynchronous completion observation stays |
| Cloud | spawnChild prepares standing instructions, persisted in CloudChildSpec before durable admission; childBrief appends the tick base prompt | Separate child-prompt policy; durable records and tenant scoping stay |
| On-prem | spawnChild then openRun, childPolicy/childProvider, parent lineage and inherited persona | Missing shared standing instructions; completed childResult stays |
| Legacy sessions | spawnSubagentDirect authorizes then calls spawnChild; gateway agent start reaches the existing session/channel runtime entry | Compatibility adapter retained for all four callers; session prompt adds session-specific context to prepared standing instructions |

The generic result preserves background admission (VSIX/cloud) and completed reports (in-process on-prem). A durable start must persist the shared prompt inputs or prepared opening for its later tick; it must not wait for child completion or discard the shared opening. Keep session-specific delivery and authorization until every legacy caller is migrated. Validate depth and lineage before any start side effects.

Editor children get a change set, a journal start, and delta capture through the gated host port. Other surfaces keep their own authenticated lifecycle ports. `entryPoint` is the parent's, not `'web'`.

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

## 4. Target sequence after this slice (not current state)

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

## 7. Acceptance criteria for this slice (not a completion report)

- This file is the slice contract. The pipeline map is the current-state diagram; the Gap Register links both. Keep their implementation status synchronized.
- `entryPoint` has no `'web'` default.
- The participant starts through the panel host.
- Spawn on every surface that has a spawn tool goes through `spawnChild` → the user start.
- Production finish/guards/compaction hook **bodies** are not defined outside `policy/*`.
- No edits under `runAgentLoop`. No deletion of `channelAdapter`, `progressGuard`, `continueChat`, or `useChatSystemPrompt` in this slice.
