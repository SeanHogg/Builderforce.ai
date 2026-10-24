# PRD 35 — One agent, one kernel

| | |
|---|---|
| Status | Approved design, not started. WS0 (finish the in-flight cloud-runtime change) runs first. |
| Owner | Agents program (planning: the session model; implementation: Opus agents; verify: Sonnet agents) |
| Entry points | VS Code · Rovr / Web / canvas · On-prem agent · Cloud / container |
| Design reference | [`docs/design/one-agent-one-kernel.html`](../design/one-agent-one-kernel.html), the picture: end state, both matrices, retention ledger, telemetry. Live copy: https://claude.ai/artifact/Ggc3G5y2ZLkJsVe1jDHag8 |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs › "ONE execution core" |

Read this whole document before you take a workstream. Then read the design reference. This
PRD is the contract. If the two ever disagree, this document wins; flag the drift to the
planning model.

---

## 1. The rule

**Many entry points → ONE agent → ONE kernel.** An entry point decides *where* a run gets its
model, files, shell, storage and people. It never decides *how* the run behaves. If two
entry points behave differently on the same task with the same model and the same files,
that is a bug in the agent, never a feature of an entry point.

**Above the entry points, the board and governance layer stays as it is** (§6.9).
Autonomous execution from the board and approvals by approver type have one owner each in
the cloud/web API. They decide *whether and by whom* a run starts and finishes. They then
dispatch into the one agent. What they require of a run reaches the agent as `RunPolicy`
data.

**No loss of functionality.** Every capability any runner has today is kept. §7 is the
ledger, and each row is moved before its old home is deleted.

## 2. Why

There are six executions under four entry points today. Each rebuilds the run policy around
the shared kernel: compaction, stall recovery, steering, finish gates, guards, verify, memory,
tool selection, model choice, ask-a-human and sub-agents. A fix lands on one entry point
only.

| Execution today | Entry point | Telemetry (30 days to 2026-10-25) |
|---|---|---|
| brain-embedded `runLoop` | VS Code | 452 runs, ≈33.5k model calls, ≈1.9B tokens; 4.4% failed; ≈43 steps/run; 23% cache hit |
| brain-embedded `runLoop` | Web Brain | ≈230 calls |
| brain-embedded `runLoop` | Rovr | 0 identifiable |
| `creationCanvasAi` | Canvas | not attributable (no label) |
| `cloudAgentEngine` | Cloud tickets | 4 runs (1 failed, rate-limited) |
| `agentReplyLoop` | Cloud @-replies | 0 |
| `agent-loop.ts` | On-prem channels / cron | 0 |
| Claude Agent SDK runner | On-prem tickets | 0 (90 days) |
| Container loop / Actions loop | Cloud | 0 (90 days); removed by WS0 |

Consequences for this program:
- **VS Code is the reference behaviour.** Its runs set the telemetry baseline (§8).
- **The agent's policy comes from `cloudAgentEngine`,** which has the most complete policy.
  It is proven against VS Code behaviour.
- The zero-traffic paths carry little migration risk, but their capabilities are still kept (§7).

## 3. End state

### 3.1 Codemap

```
Board + governance (api, unchanged owners) ──dispatch──┐
                                                        ▼
VS Code adapter ─┐   Rovr/Web adapter ─┐   On-prem adapter ─┐   Cloud adapter ─┐
                 └────────────────────┴────────────────────┴──────────────────┴──► packages/agent-run  (ONE agent)
                                                                                         │ policy/*
                                                                                         ▼
                                                                                   packages/agent-loop (ONE kernel)
   uses: packages/agent-tools · @seanhogg/builderforce-memory (/working, /handoff) · run-policy · model-router · cost-levers · agent-stall · run-guards
```

- `packages/agent-run` is the **only** place run policy exists, and the only importer of `runAgentLoop`.
- An adapter only **builds ports**. It has no loop, no policy, no branches on behaviour, and stays under ~300 lines.
- Proposed adapter homes:
  - `clients/vscode/src/run/vscodeAdapter.ts`
  - `brain-embedded/src/run/webAdapter.ts` (Web, Rovr, canvas)
  - `agent-runtime/src/run/onPremAdapter.ts` (tickets, channels, cron)
  - `api/src/application/runtime/cloudAdapter.ts` (CloudRunnerDO tick, tickets, @-replies)

### 3.2 The contract (`packages/agent-run/src/contract.ts`; WS1 owns it)

```ts
export function runAgent(input: {
  task: RunTask;
  policy: RunPolicy;
  ports: RunPorts;
  resume?: RunState;
  maxSteps?: number;               // 1 on the cloud tick; unbounded elsewhere
}): Promise<RunOutcome>;

export interface RunTask {
  prompt: string;
  ticketId?: number; chatId?: number | string; projectId?: number;
  persona?: string;                // compiled persona brief
  attachments?: RunAttachment[];
  dispatch: { source: 'board-sweep' | 'lane-entry' | 'chat' | 'manual' | 'ceremony' | 'subagent'; approvalId?: string; parentRunId?: string };
}

export interface RunPolicy {
  entryPoint: 'vscode' | 'web' | 'rovr' | 'canvas' | 'on-prem' | 'cloud';  // telemetry label only — NEVER branched on for behaviour
  toolScope: 'ticket' | 'chat-reply' | 'chat-work' | 'canvas' | 'subagent';
  role: string;                    // tier ladder, verify phase
  levers: CostLeverSet;            // A3, C5, C7, D1, D7, D8 …
  budgets: { steps?: number; tokens?: number };
  pinnedModel?: string;
  inference: 'local-only' | 'hybrid' | 'specific';
  verify: 'declared-checks' | 'branch-ci' | 'none';
  signoff?: { roleKey: string; laneKey?: string };   // finish blocked until signed off
  approvalGates: PolicyGate[];                        // in-run acts needing an approver
}

export interface RunPorts {
  model: ModelTransport;           // complete(request, signal) → completion
  capabilities: CapabilityProvider;// @builderforce/agent-tools contract (files, shell, git, platform, memory, human)
  store: RunStore;                 // load/save RunState; commitMemory(consolidated)
  events: EventSink;               // typed RunEvent stream + the uniform outcome row (§8.2)
  human: HumanChannel;             // ask(question, options) | approve(gate) → answer | 'paused'
  steering?: SteeringSource;       // drain(): user messages since the last step
}

export type RunOutcome =
  | { kind: 'finished'; output: string; state: RunState }
  | { kind: 'paused'; question: string; approvalId: string; state: RunState }
  | { kind: 'yielded'; state: RunState }          // maxSteps reached; resume later
  | { kind: 'failed'; reason: string; state: RunState };

/** Plain JSON. Everything any policy needs across a step boundary. */
export interface RunState {
  messages: unknown[]; step: number;
  guards: LoopGuardState;          // progress, cascade, pendingPause, checksNote
  finish: FinishGateState;         // placeholder / CI-pending / no-deliverable counters, signoff recorded
  model: ModelPolicyState;         // hand-off, pins, tried/broken models, stall budget
  memory: RunKnowledgeState;       // working memory + tool tally
  compaction: CompactionState;
  writtenPaths: string[];
  askedGates: string[];
}
```

Contract changes go through WS1 only. Another workstream that needs a field files the request
in its hand-off note and keeps working against a local type until WS1 merges the change.

### 3.3 Done means

| Check | Passes when |
|---|---|
| Conformance suite | One scripted task (fake model, in-memory provider) through all four adapters gives the same `RunEvent` trace and `RunOutcome`. The cloud adapter runs it one step per tick and still matches. A board-dispatched variant with `signoff` set is included. |
| `check:one-execution` | Nothing outside `packages/agent-run` imports `runAgentLoop` or any `policy/*` module. |
| Adapter size | Each adapter < ~300 lines, only builds ports. |
| Parity | Every pre-existing behaviour test passes **unchanged** (§5.1). `check:tests-unchanged` enforces; the test count does not drop. |
| Matrix | The design's final matrix holds: one policy module per row, entry points differ only by port. |
| No lost capability | Every §7 row's old tests pass against its new home before the old home is deleted. |
| Telemetry | Every entry point writes the uniform outcome row (§8.2); VS Code stays at or better than baseline (§8.1). |

## 4. Workstreams

Workstreams run in parallel wherever the dependency graph allows. **File ownership is
exclusive.** You edit only the paths your workstream owns. If you need a change elsewhere,
write it in your hand-off note for that path's owner.

```
WS0 ──► WS1 ──┬─► WS2a compaction ─┐
              ├─► WS2b stall ──────┤
              ├─► WS2c steer/ask/sub┤
              ├─► WS2d finish/guards/verify ─┤
              ├─► WS2e memory ─────┤
              ├─► WS2f tools ──────┤
              ├─► WS2g model ──────┤
              └─► WS6 telemetry ───┤
                                   ├─► WS3 cloud adapter ──┐
                                   ├─► WS4 VS Code + Web/Rovr/canvas adapters ─┤
                                   └─► WS5 on-prem adapter ┤
                                                           └─► WS7 enforce + delete + done
```

### WS0 — Finish the in-flight cloud-runtime change (sequential, first)

- **Goal.** Land the uncommitted "one cloud runtime, container is a sandbox" change cleanly,
  so every later workstream branches from a green main.
- **Owns.** The current working tree under `api/`, `agent-runtime/`, `brain-embedded/`,
  `packages/agent-tools/`, `clients/vscode/`, `frontend/` touched by that change.
- **Do:**
  1. Restore every test file the earlier pass rewrote to its committed version
     (`git checkout HEAD -- <file>`). Retarget only imports of deleted modules. Run the tests
     unchanged and fix the source where they fail.
  2. Fix the open review findings:
     - git verbs publish to the ticket branch (`ShellCapability.trackedBranch`);
     - the D7 note persists across ticks;
     - Actions runner poll retry, plus host liveness / `lastPollAt` fail-fast;
     - a stray runner gets `{close:true}`, and `runnerSpec` refuses any terminal status;
     - the run-end verify gets a heartbeat, cancel and a time budget;
     - the container cancel uses `res.on('close')`;
     - `RunKnowledgeState` persists across ticks;
     - the legacy 409 concludes the row and does not restore the lane;
     - sandbox read/edit fallback, with edits reading the branch first;
     - mailbox redelivery for unacknowledged requests;
     - a legacy running-container op answers "retired" and fails the run with that reason;
     - dead comments and exports cleaned up.
  3. Fix the verify failures:
     - `peekCached` / `setCached` imports in `runContext.ts`;
     - the `gatewayChatSupport.ts` role type;
     - `check:tenant-scope` (scope the new `executions` queries);
     - `check:silent-catches` (+7 new `.catch(() => …)` calls).
- **Accept.** API typecheck green; guards green; targeted tests green with unchanged
  assertions; fresh Opus review clean; committed and pushed.
- **Already in the tree (unverified).** `trackedBranch`, `checksNote`, `sandboxShell` /
  `VerifyShell`, `toShellResult` / `toCheckVerdict`, `RunKnowledgeRecorder.restore`,
  `cloudAgent/runProvider.ts` and `cloudAgent/runVerifyThenRemember.ts`.

### WS1 — Contract, package skeleton, conformance harness, guard (sequential, blocks WS2–WS6)

- **Owns.** `packages/agent-run/**` (package.json, tsconfig, `src/contract.ts`, `src/runAgent.ts`,
  `src/policy/index.ts` composition, `test/conformance/**`), `scripts/check-one-execution.mjs`,
  and its entry in `api/scripts/checks.manifest.mjs`.
- **Do:**
  - Write the §3.2 types.
  - Write `runAgent` driving the kernel with the policy hooks composed from `policy/*`
    (each one a no-op until its workstream lands).
  - Build the conformance harness: a fake `ModelTransport` that replays a script, an
    in-memory `CapabilityProvider`, a trace-recording `EventSink`, and a memory `RunStore`.
    It must run once continuously and once at `maxSteps: 1`, resuming each step from saved
    `RunState`.
  - Add `check:one-execution` in **report mode**, with a baseline allowlist naming today's
    five importers. WS7 flips it to enforce.
  - Add `check:tests-unchanged` in report mode (§5.1).
  - Fill the "Proven by" column of the full §7 ledger. For each capability, name its existing
    test files, or mark it **needs characterization test**. The WS that owns that row writes
    the test first (§5.1 step 2).
  - Make the package Worker-, browser- and Node-safe: no `node:*` and no DOM.
- **Accept.** The package builds; the harness runs a trivial script through `runAgent`;
  the guard reports the current five importers; every §7 row has a "Proven by" entry.

### WS2a–g — Policy modules (parallel after WS1)

Each WS2 workstream owns **one folder** `packages/agent-run/src/policy/<name>/**` plus its
tests. Each module:
- **Ports** the listed sources' behaviour. It doesn't rewrite it, and it extracts the
  existing code where it can (no second copy).
- **Brings the sources' existing tests along unchanged**, with imports retargeted only.
- **Exposes** a hook / port wrapper the WS1 composition calls, plus its slice of `RunState`.
- Leaves the source files alone. Adapters (WS3–5) delete them when they switch over.
- Stays under ~400 lines per file; split if larger.

| WS | Module | Ports from (all of these, nothing dropped) | Tests that must pass unchanged |
|---|---|---|---|
| 2a | `compaction` | `api/src/application/llm/compactMessages.ts` (cloud + @-reply wiring); on-prem `agents/embedded-runner/compact.ts` + reserve tokens; SDK auto-compact behaviour | `compactMessages` tests; on-prem compaction / overflow tests |
| 2b | `stall` | `cloudAgent/cloudRunModelPolicy.ts` (`cloudStallStep`, stall budget); `brain/agentReplyLoop.ts` (forced no-tools synthesis, `trimRepetitionLoop`); `brain-embedded/src/runStore/finalAnswerHook.ts` (prose ask-lift); `frontend/src/lib/canvasNoToolCalls.ts`; `agent-runtime/src/builderforce/agent-loop/stall-recovery.ts` (exhausted notice) | each source's stall tests; `packages/run-policy` stallStep tests |
| 2c | `steering`, `ask`, `subagents` | `runtime/cloudLoopControl.ts` + `lateSteerStore.ts`; composer queue (`brain-embedded` run store); on-prem `steeringQueue`; SDK `SteeringChannel` semantics · kernel `ask_human`, `ASK_USER_TOOL` (options + pending), on-prem `askHumanTool` · `runtime/cloudSubagent.ts`, `cloudChildRuns.ts`, `clients/vscode/src/subagentTool.ts`, SDK `Task` | steering relay, human-in-loop, sub-agent tests |
| 2d | `finish`, `guards`, `verify` | `cloudAgent/finishGates.ts` (placeholder, no-deliverable, CI-pending, review verdict, **signoff**); @-reply verify pin; `costLoop/loopGuards.ts` (A3, D1, D7, D8); `cloudAgent/inRunVerify.ts`, `sandbox/sandboxVerify.ts`, `cloudAgent/runVerifyThenRemember.ts` | `loopGuards.test`, finish-gate tests, `inRunVerify.test`, `runEndMemory.test` |
| 2e | `memory` | `costLoop/volatileTail.ts`; `brain-embedded/src/runStore/completeTurn.ts` + `runPreamble.ts`; on-prem `agent-loop.ts` brief + `infra/knowledge-loop.ts`; `cloudAgent/runEndMemory.ts`; `clients/vscode/src/memoryCommit.ts`, `editorRunEnd.ts`, `sessionNotes.ts`; `agents/sdk-memory-server.ts` (→ memory tools) | `run-knowledge.test`, `knowledge-loop.test`, `runEndMemory*.test`, `memoryCommit.test` |
| 2f | `tools` | capability gate (`cloudAgent/runSurfaceCaps.ts`, `cloudAgentTools.ts`); `brain-embedded/src/selectTools.ts` (lexical rank, synonyms, pinning); `llm/cloudAgentToolset.ts` `CHAT_SCOPED_AGENT_TOOLS` → `toolScope: 'chat-reply'` data; canvas tool port; `SDK_TOOLS` + `allowedToolsAfterGates` → policy gates | `cloudSurfaceCaps.test`, `selectTools` tests, `claude-agent-sdk-runner.test` (gate cases) |
| 2g | `model` | `cloudAgent/cloudRunModelPolicy.ts`, cascade, learned routing, limbic state; @-reply cascade; `clients/vscode/src/modelRouting.ts` policy half (Local only / Hybrid / Specific); `frontend/src/lib/canvasModelPort.ts` policy half; on-prem gateway model config | `cloudRunModelPolicy.test`, `modelRouting` tests, routing package tests |

### WS6 — Telemetry (parallel with WS2)

- **Owns.**
  - `packages/agent-run/src/telemetry/**`: the outcome row builder and the `RunEvent` → row mapping.
  - An API migration pair (expand now, contract in a later push):
    - `llm_usage_log.entry_point` and `run_model_outcomes.entry_point`;
    - fill `turn_index` and `tool_schema_tokens`;
    - `run_model_outcomes.compactions` and `run_model_outcomes.verify`.
  - The ingest route changes that accept them.
  - `scripts/telemetry-baseline.cjs`: read-only, prints §8.1 per entry point.
- **Accept.**
  - The migration is in both tracks (`llm_usage_log` lives in two migration tracks).
  - The baseline script reproduces §8.1 from the live ops DB.
  - The core emits one row per run with every §8.2 field.

### WS3 — Cloud adapter (after WS2 + WS6)

- **Owns.**
  - `api/src/application/runtime/cloudAdapter.ts`.
  - The policy halves of `cloudAgentEngine.ts` (moved out, then deleted).
  - `brain/agentReplyLoop.ts` (deleted).
  - `CloudRunnerDO.ts` call site.
  - `brain/agentReply.ts` call site.
- **Do:**
  - CloudRunnerDO calls `runAgent({ …, maxSteps: 1, resume })` each tick.
  - Ports:
    - provider = `cloudAgent/runProvider.ts` (git API + sandbox + IDE workspace, rehearsal as a decorator);
    - store = DO cursor;
    - events = run timeline;
    - human = pause/resume;
    - steering = steer relay.
  - @-replies run through the same adapter with `toolScope: 'chat-reply'`.
  - Board dispatch passes `RunTask.dispatch` and `RunPolicy.signoff` / `approvalGates` (§6.9).
- **Accept.**
  - Conformance passes on the cloud adapter at `maxSteps: 1`.
  - Every cloud test passes unchanged.
  - `cloudAgentEngine.ts` is gone or is the adapter (<300 lines).

### WS4 — VS Code + Rovr / Web / canvas adapters (after WS2 + WS6; highest-traffic, telemetry-gated)

- **Owns.**
  - `brain-embedded/src/run/webAdapter.ts`.
  - The `brain-embedded/src/runStore/runLoop.ts` policy (moved, then deleted).
  - `clients/vscode/src/run/vscodeAdapter.ts` and the `brainRunHost.ts` call site.
  - `frontend/src/lib/creationCanvasAi.ts` (becomes a canvas capability provider + call site).
- **Do:**
  - The run store becomes `RunStore` + `HumanChannel` + `EventSink`. That keeps single-flight,
    Stop, the confirm gate and the live trace.
  - The local-first transport and `xmlToolCalls` become `ModelTransport`.
  - Canvas board tools become a capability provider on the same run.
  - Send the entry-point label (`vscode` / `web` / `rovr` / `canvas`).
- **Accept.**
  - Conformance passes.
  - The brain-embedded, VS Code and frontend tests pass unchanged.
  - The VSIX is packaged and installed.
  - **Ship gate:** a week of VS Code telemetry is at or better than §8.1. If it regresses,
    revert to the previous VSIX and route the failure back to the planning model.

### WS5 — On-prem adapter (after WS2 + WS6)

- **Owns.**
  - `agent-runtime/src/run/onPremAdapter.ts`.
  - `builderforce/agent-loop/agent-loop.ts` policy (moved).
  - `infra/sdk-agent-engine.ts`, `agents/claude-agent-sdk-runner.ts`, `agents/sdk-memory-server.ts` (deleted).
  - The `infra/builderforce-relay.ts` call site.
- **Do:**
  - Tickets, channels and cron all call `runAgent`.
  - The provider is node fs + shell plus the native `AgentTool`s:
    - shared definitions move into `packages/agent-tools`;
    - machine-only tools stay provider capabilities.
  - The store is the session file. Events go out as relay frames.
- **Accept.**
  - Conformance passes.
  - The agent-runtime tests pass unchanged. Each SDK runner test case is retargeted to the
    public seam that carries the same behaviour, with the same inputs and expected values
    (§5.1).
  - Every §7 SDK row is covered.

### WS7 — Enforce, delete, close (last)

- Flip `check:one-execution` to enforce, with an empty allowlist.
- Run conformance across all four adapters in CI.
- Delete every source a WS2 module ported from that its adapter has not already deleted.
- Check every §3.3 row.
- The planning model moves the ROADMAP entry to DONE.md.

## 5. Rules for every agent on this program

1. **Port, then delete.** Port the missing behaviour into the agent, prove it, delete the old
   copy in the same workstream. No parallel copies, and no "duplicate remains" entries.
2. **Tests run unchanged.** Existing behaviour tests are the parity oracle. You may retarget
   an import from a deleted module to its replacement. You must not change an input or an
   expected value. A failing test means you fix the source. If a behaviour change is
   genuinely intended, stop and ask the planning model. The full procedure is §5.1.
3. **No new loop, no policy in an adapter, no `entryPoint` branching.** `RunPolicy.entryPoint`
   is a telemetry label only.
4. **No god classes.** Under ~400 lines per module, one reason to change.
5. **Model roles** (CLAUDE.md, a hard rule):
   - Opus writes code.
   - A Sonnet agent compiles, typechecks, runs the targeted tests and packages.
   - Opus or Fable reviews the diff before every commit.
   - Never a full vitest sweep.
6. **Commits.** One branch per workstream: `feat/agent-run-ws<N>`. No Co-Authored-By line.
   Bump the version of every package you change, and never reuse a version. Wait for CI
   before pushing over a running build.
7. **Docs.** Only the planning model edits ROADMAP.md, DONE.md and this PRD. Put contract or
   scope requests in your hand-off note.
8. **Hand-off note** (end of every workstream, in the PR description):
   - what moved where (as §7 rows);
   - which tests prove it, with their pass output;
   - files deleted;
   - contract requests;
   - telemetry deltas, where relevant.

### 5.1 Proving every capability with tests

Every capability moves under the same five steps. A workstream is not done until each §7 row it
owns has been through all five.

1. **Baseline on the old home.** Before porting, run the row's tests against the code that
   exists today and record the pass output in the hand-off note. A test that is not green on
   the old home is not an oracle. Report it to the planning model before going further.
2. **No test, write one first, against the old home.** If a capability has no test, write a
   characterization test that pins today's observable behaviour: inputs, tool calls, events,
   the outcome. It must pass on the old home, and it lands in the same branch **before** any
   porting commit. From then on it is an existing test and follows rule 2. Never write the test
   against the new home first. A test written to fit new code proves nothing about parity.
3. **Port, then run the same tests on the new home.** The same files, the same assertions.
   Rule 2 is the only allowed edit: an import moved from a deleted module to its replacement.
4. **Run them through every entry point that has the capability.** A capability that more
   than one entry point uses also gets a conformance case (§3.3). The same scripted task gives
   the same `RunEvent` trace and `RunOutcome` on each adapter, and on the cloud adapter at
   `maxSteps: 1`.
5. **Delete the old home only after steps 3 and 4 are green.** Deletion happens in the same
   workstream.

Not allowed in a test file on this program:
- changing an input, a fixture's content or an expected value;
- deleting a test or a test file, or merging tests so fewer cases run;
- adding `.skip`, `.only`, `.todo` or `it.fails`, or wrapping an assertion in a conditional;
- loosening a matcher: `toEqual` → `toMatchObject`, an exact string → `stringContaining`,
  `toHaveBeenCalledWith` → `toHaveBeenCalled`, an exact count → `toBeGreaterThan`;
- adding mocks that stub out the behaviour under test.

A test that reaches into a deleted module's internals, such as a private helper or an SDK
option object, is retargeted to the **public seam that carries the same behaviour**. It keeps
the same inputs and the same expected values. If no seam can carry them, it goes to the
planning model. It is never rewritten to fit.

Checked by reviewers and CI:
- The Opus or Fable review gets the test-file diff on its own and rejects any hunk that isn't
  an import line.
- The Sonnet verify agent reports the test count per file before and after. A drop fails the
  workstream.
- WS1 adds `check:tests-unchanged` (report mode, enforced in WS7). It diffs every test file
  touched on a `feat/agent-run-ws*` branch against main and fails on any changed line that
  isn't an `import` / `vi.mock` path, and on any new skip marker.

### 5.2 Running this PRD from the BuilderForce VS Code extension

The program can be driven from the BuilderForce chat in VS Code as well as from Claude Code.
The rules above are the same. Only the names change:

| Rule (§5) | In Claude Code | In the BuilderForce extension |
|---|---|---|
| Plan, sequence workstreams, edit ROADMAP / DONE / this PRD | the session model | the chat's own run (the parent) |
| Write code | Opus | `spawn_agent` with `role: "code"` (a Developer when `as_agent` names one) |
| Compile, typecheck, targeted tests, package | Sonnet subagent | `spawn_agent` with `role: "verify"` (QA). It reports pass/fail and the per-file test counts (§5.1). It does not judge design. |
| Review the diff before a commit | Opus or Fable | `spawn_agent` with `role: "plan"`, handed the diff and §5.1's test-file rules, not the coder's conclusions |
| Parallel workstreams | parallel agents | `spawn_agents`, one child per workstream, within one phase of the §4 graph |

The account's model routing picks each role's model. It is not chosen in the task text.

Children share the parent's working tree. So workstreams that run in parallel each work in
their own git worktree on their own branch:

```
git worktree add .builderforce/worktrees/ws<N> -b feat/agent-run-ws<N>
```

`.builderforce/` is gitignored, so a worktree never shows as a change in the parent's tree.
The child's task names its worktree path as its root for every file and shell call.
`search_code` and `list_files` take that path as their scope: a repo-wide search skips
ignored folders, so an unscoped search would read the parent's tree instead. The parent
removes the worktree after the branch merges.

Each child's task carries:
- its workstream section of §4, verbatim;
- §5, §5.1 and this table;
- the path of this PRD and of the design reference, so it can read them itself.

A child sees none of the parent's conversation.

## 6. Behaviour each policy module must keep (summary; sources in §4)

1. **Compaction.** Trigger on window pressure with reserve tokens. Summary-replace older
   turns. Never drop the system prompt or the current task.
2. **Stall.** Detect narration, announced-but-untaken calls and repetition. Re-prompt.
   Force a final synthesis without tools when exhausted. Lift a prose question into ask.
3. **Steering.** Drain user messages between steps and acknowledge each as `steer.applied`.
   A late steer is never lost.
4. **Finish.** Placeholder and no-deliverable blocks, the CI-pending wait, the review-verdict
   requirement and the **sign-off requirement**, with counters persisted across steps. The
   verify pin.
5. **Guards.** A3 progress detector (steer → escalate → pause). D1 cascade with escalation
   events. D7 post-edit checks, with the note shown on the next turn. D8 parallel reads.
6. **Verify.** Declared checks in a shell, or branch CI, with honest exit codes. A command
   that doesn't finish counts as not finished, never as a pass. Heartbeat and cancel.
7. **Memory.** The per-turn brief in the volatile tail. Consolidation into `codemap:<area>`
   facts at run end. Recall/remember tools.
8. **Model.** Role ladder, cascade, learned routing, pins, limbic state, the free tier first,
   Local only / Hybrid / Specific.
9. **Governance (above the agent; retained as is).** These keep their single owners in
   `api/`. WS3 retargets their dispatch at `runAgent` and changes nothing else.
   - **Autonomous board execution:**
     - `swimlane/laneEntryTrigger` and `runtime/autonomousExecutionSweep`;
     - `swimlane/evaluateAutoRun`, including the circuit breaker;
     - `runtime/autoRunSkipLedger`;
     - `runtime/dispatchCloudRun`;
     - `kanban/managedExecutionGuard` (audited override, never a refusal);
     - `manager/coordinateTicket`.
   - **Approvals by approver type:**
     - `approval/approvalGate` and `runtime/executionApprovalGate`;
     - `approval/autoApprovalRules`;
     - `approval/approvalChain` (sequential steps; a rejection ends the chain);
     - `swimlane/laneApprover` (requirements → capable staffed lane agents → fail-closed);
     - `kanban/signoffGate`.
   - **Contract with the agent.**
     - The approval id rides `RunTask.dispatch`.
     - The required sign-off role rides `RunPolicy.signoff`; the agent's finish policy
       blocks until it is recorded, on every entry point.
     - In-run approvals ride `RunPolicy.approvalGates`, and the HumanChannel routes them
       to the approvals queue.

## 7. Retention ledger (nothing is lost)

The full ledger, grouped by the parts of the one agent, is in the design reference
("Every capability, and where it lives at the end"). WS1 copies it here in full and fills
"Proven by" (§5.1). The rows most at risk:

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Read / Write / Edit / Bash / Glob / Grep | `agent-tools` `read_file` / `write_file` / `edit_file` / `run_command` / `list_files` / `search_code` on the node provider | Claude SDK built-ins | `claude-agent-sdk-runner.test` + agent-tools tool tests; conformance case per tool |
| Sub-agents | `policy/subagents` | SDK `Task`, cloud child runs, editor `spawn_agent` | sub-agent / child-run tests; editor `subagentTool` tests |
| Recall / remember during a run | memory tools on the `memory` capability | `sdk-memory-server` | WS1 to name; else characterization test (WS2e) |
| ~40 machine tools (process, browser, orchestrate, fleet, MCP/plugins, channel actions) | `agent-tools` (shared) + on-prem provider (machine-only) | on-prem native `AgentTool`s | each tool's agent-runtime tests; WS1 lists any without |
| Single-flight, Stop, confirm gate, live trace | RunStore / HumanChannel / EventSink ports | brain-embedded run store | brain-embedded run-store tests |
| Local-first inference, XML tool-call lifting, served window | ModelTransport | `localFirstTransport`, `xmlToolCalls` | `xmlToolCalls` + local-first transport tests |
| Durable ticks, sandbox, rehearsal, IDE workspace | cloud adapter + `cloudAgent/runProvider.ts` | `cloudAgentEngine`, CloudRunnerDO | cloud engine / DO / sandbox tests; conformance at `maxSteps: 1` |
| Board autonomous execution; approvals by approver type; sign-off | governance layer (unchanged) + `RunPolicy.signoff` / `approvalGates` | §6.9 sources | existing governance tests (untouched) + board-dispatched conformance case with `signoff` |

## 8. Telemetry

### 8.1 Baseline (VS Code, 30 days to 2026-10-25, ops DB)

Failure rate 4.4% (20 of 452). Steps per run ≈ 43 (failed runs ≈ 62). Prompt-cache hit 23%.
WS4 ships only if a week after cut-over stays at or better than these. Reproduce with
`scripts/telemetry-baseline.cjs` (WS6). How to attribute rows: VS Code = `tenant_api_key_id`
whose key kind is `vscode` (its `surface` is clamped to `web`); cloud = `surface='cloud'`
with `execution_id`; @-reply = `use_case='brain_agent_reply'`. Telemetry tables live on
`NEON_TRANSACTIONAL_DATABASE_URL`. Queries are read-only and never print the connection URL.

### 8.2 The uniform outcome row (every run, every entry point)

`entry_point`, `run id`, `steps`, `tool_calls`, `tool_errors`, `compactions`, `stall_recoveries`,
`escalations`, `verify` (`passed` | `failed` | `not-run`), `terminal_status`, `model`, tokens,
`cache_read_tokens`, `cost`. Today VS Code rows lack tool counts, `turn_index` and
`tool_schema_tokens` are always null, and compaction is unrecorded; WS6 closes those gaps.

### 8.3 Separate findings (not in scope; logged in ROADMAP)

- 19,608 `auto_run_skipped` and 282 `auto_run_error` events in 30 days.
- 2,093 auth-401 model failovers.

## 9. Out of scope

- New capabilities.
- UI redesign. The VS Code / web surfaces keep their UI; only the run underneath changes.
- Changes to the board and governance behaviour itself (§6.9 retargets dispatch only).
