# PRD 35 — One agent, one kernel

| | |
|---|---|
| Status | Approved design, in progress. **WS0 landed** (clean tree, `main` = `origin/main` at `6b1a1469e`, 2026-10-25). **WS8a–h shipped 2026-10-25 in VSIX 2026.10.76** (DONE.md); its leftovers are in ROADMAP. **WS8i–o shipped 2026-10-25** (api 2026.10.81, brain-embedded 2026.10.52, agent-tools 2026.10.14, model-router 2026.10.18, tool-output-policy 2026.10.2; DONE.md), after the overnight WS1 run (VS Code chat #6) delivered 5 files in 6.5 hours. **WS1 merged** (#878: contract, package skeleton, conformance harness, report-mode guards). **WS2a–g merged** (#880: all twelve policy modules under `packages/agent-run/src/policy/`). No entry point imports `@builderforce/agent-run` yet, so the old homes still run every execution. **WS8p is open** (added 2026-10-27: a run that says it is ready and keeps reading trips no guard, and A3 itself counts new files as progress). It ships on today's VS Code home ahead of WS4. **Next: WS6** (telemetry; `src/telemetry/` does not exist yet), then WS3/WS4/WS5, then WS7. Status checked 2026-10-27. Board: epic 5979, one ticket per workstream. Revised 2026-10-25: adds run efficiency (§2.1, WS8, §6.10, §8.4). Evidence: one VS Code run took 79 turns to update this PRD and never updated it. |
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

### 2.1 Why, part two: the agent is slow on the reference entry point

On 2026-10-25 a VS Code chat ran "Review this PRD and implement it using subagents". It was
captured mid-run:
- 79 turns, 174 tool calls, 11 errors and 77 minutes.
- It filed 5 tickets and dispatched none: 0 sub-agents and 0 persona children.
- It never edited this PRD.
- Its prompts averaged ≈58k tokens, with a 23% cache hit rate.
- It ran entirely on `MiniMax-M3.1-Flash-Preview`. The tenant's Anthropic token had expired and
  the refresh failed, so the planning phase quietly fell back to that model.

The root causes below were checked against the code on 2026-10-25. Each one is a run-policy
defect, so each has a home in §4.

| # | Defect (verified) | Where today | Turns lost on that run | Fixed by |
|---|---|---|---|---|
| E1 | **Read coverage claims lines the model never saw.** The model sees the trimmed result, but the cache stores the untrimmed one. `afterDispatchHook` (`brain-embedded/src/runStore/toolCallHooks.ts:89,104`) caches `ran.out`. The trim happens in `dispatchTool.ts:177`, and its result (`windowReadFile`'s last kept line) is thrown away. `servedReadWindow` (`packages/run-guards/src/readCoverage.ts:125`) trusts the untrimmed copy's `truncated:false` + `totalLines` and extends coverage to EOF. A second defect: a covered-read replay (`beforeDispatch.ts:197`) re-trims the cached result from offset 1, so a request for offset 251 is served lines 1–~250 again. The model worked around both with `sed` through `run_command`, which coverage never tracks. | brain-embedded (VS Code, Web, canvas) | ≈4 + the shell workaround | WS8a now; WS2f ports it |
| E2 | **No task context at turn 1.** Evermind recall searches with the raw user sentence (`runMemory.ts:40` `latestUserText`). `runContextFor` (`clients/vscode/src/brainRunHost.ts:441`) adds only the run-context envelope and recent session notes. The run does not get the file the user named, the chat's linked tickets and runs, git state per repo, or the `codemap:` facts for the areas the file names. `gatherChatDiagnostics` already reads tickets and runs, but it has no host readers and no git reader. | every entry point; cloud tickets get PRD + ticket + facts | ≈6–10 | WS2e |
| E3 | **The multi-repo workspace root errors on every git and shell call.** `runGitTool` (`packages/agent-tools/src/git-tools.ts:265`) infers a repo only from a path argument. `runPublishTool` (:611) doesn't infer one at all. `run_command` runs at `workspaceFolders[0]` and has no `cwd`. `ToolContext` carries no project or request, and the VS Code client never fetches `project_repositories`. | VS Code | 2–3 per run, plus a `cd X &&` on every command | WS8b now; WS2f ports it |
| E4 | **Reads are expensive.** `read_file` takes one path. The markdown outline exists as a separate tool (`file_outline`), but nothing points a large-doc read at it. Every execution sizes the result cap differently: VS Code fixed 16k/6k; cloud C7-off **uncapped**; @-reply an 8k slice; canvas **uncapped**; on-prem 30% of window plus a second guard with different constants. VS Code already resolves the window (`resolveContextWindow`) but only window-fit uses it. | all | ≈3 per large file | WS2f |
| E5 | **Delegation is checked only at the end.** `leftDelegationUndone` (`brain-embedded/src/delegationRequest.ts:78`) fires from `finalAnswerHook` (prose end) or on `ask_user`. A run that keeps reading never reaches either, so it never delegates. | brain-embedded only; no other entry point checks | the whole run (0 dispatched) | WS8c now; WS2c ports it |
| E6 | **Long shell commands block the run.** `run_command` takes `{command}` only, with a 10-minute timeout (`localShell.ts:23`, `sandboxCore.mjs:25`). Background exec with `yieldMs`/`background` and a `process` poll tool exists **only on-prem**. | VS Code, cloud | one 10-minute stall | WS2f |
| E7 | **The planning model degrades silently.** An expired BYO token (`tenantProviderKeyService.ts:458`) drops that vendor from routing. The client learns about it only after a turn, from `x-builderforce-byo-unresolved`. `llm.model_downgrade` fires only when the requested model is not `default`, so an auto-routed planning turn that lands on a Flash-class model leaves no trace. | all | quality of the whole run | WS2g |
| E8 | **Write-back is uneven.** The VS Code client *does* write `codemap:` facts (`memoryCommit.ts:261`). It writes them only behind the Memory switch and only after ≥3 changed files (`MIN_CONSOLIDATED_FILES`), with no `tags:['codemap']`, no `chatId` (so it skips the memory-off gate) and no `fileAnchors`. A read-only review run writes nothing. @-reply and canvas write nothing. | VS Code partial, @-reply/canvas none | the next run starts cold | WS8d now; WS2e ports it |
| E9 | **Tool catalogs differ per execution.** VS Code ranks 64 of ~476 lexically, plus 3 router tools. Cloud tickets use ≤20 core tools plus `tool_search`, but only behind lever `c1_deferred_tools` (10% rollout). @-reply advertises ~160 every turn and on-prem advertises all of them. `find_symbol` isn't registered on cloud. | all | prompt size every turn (≈58k average) | WS2f |
| E10 | **Stop doesn't stop, and the user can't redirect the run.** Four separate failures:<br>1. A message typed mid-run is **held until the run ends** (`useChatSend.ts:86-97` → `useQueuedTurns.ts:93-106`). It reaches the model only if the user clicks "Steer now", and even then only at the next step (`completeTurn.ts:42` `drainRunSteering`), so a 5–10-minute command delays it that long. The VS Code path emits no `steer.applied` event.<br>2. No entry point reads stop intent in the text ("STOP executing", "stop now"). On-prem matches only the bare words (`auto-reply/reply/abort.ts` `ABORT_TRIGGERS`).<br>3. **The Stop button doesn't kill the running command.** `runControl.ts:136` aborts the model call, but `runTool(name, args)` (`dispatchTool.ts:64`) → `createNativeRunTool` → `fileTools.ts` builds a `ToolContext` with no `signal`. `ShellCapability.run(command)` takes none, and `localShell.ts` `execOnce` passes none to `exec`. The child process runs to its 10-minute timeout. The cmd→bash retry can then start it again.<br>4. The kernel (`agent-loop/src/loop.ts`) awaits the dispatch that's already running before it checks `isCancelled()`. The UI shows "stopped" while the loop is still waiting. On-prem already does this right: it passes the signal into `tool.execute`, `bash-tools.exec.ts` kills on abort, and a queued user message skips the turn's remaining calls. Cloud passes `ctx.signal`, but `run_command` ignores it. | VS Code (all 4), cloud (3, 4), on-prem partly | the user's control of the run: "write the update now" and "STOP" were both ignored | WS8e now; WS2c ports it |

Corrections to the first-pass analysis:
- The VS Code client already writes `codemap:` facts (E8). The gap is the gate and the missing fields, not a missing writer.
- `gatherChatDiagnostics` collects no git status (E2).
- The diagnostics' "6 KB per-result budget" is the default cap for non-read tools; `read_file`'s cap is 16k.

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

- **Split by layer (operator decision, 2026-10-25).** Pure brain logic does not live in `packages/agent-run`. It lives in tested builderforce-memory packages, and `agent-run` imports it:
  - **`@seanhogg/builderforce-memory`** (`/working`, `/handoff`): the context fold and compaction (`buildWorkingTranscript`, budgets, tail sizing), the summarizer prompt, consolidation markers, and window fit.
  - **`@seanhogg/builderforce-memory-engine`**: the stall, finish and verify decision functions.
  - **`agent-run`** keeps only the stateful run store, the ports and the adapters' composition. A WS2 policy module is a thin binding over these pure functions, never a second copy.
  - **First slice landed 2026-10-25.** The fold and the consolidation markers moved out of `brain-embedded/src/workingTranscript.ts` and `consolidation.ts`.
- `packages/agent-run` is the **only** place run policy is composed, and the only importer of `runAgentLoop`.
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
  workspace?: { defaultRepo?: string; focusPaths?: string[] };  // resolved by the adapter (§6.10); git + shell default to defaultRepo
}

export interface RunPolicy {
  entryPoint: 'vscode' | 'web' | 'rovr' | 'canvas' | 'on-prem' | 'cloud';  // telemetry label only — NEVER branched on for behaviour
  toolScope: 'ticket' | 'chat-reply' | 'chat-work' | 'canvas' | 'subagent';
  role: string;                    // tier ladder, verify phase
  levers: readonly CostLeverId[];   // @builderforce/cost-levers owns the ids — A3, C5, C7, D1, D7, D8 …
  budgets: { steps?: number; tokens?: number };
  pinnedModel?: string;
  inference: 'local-only' | 'hybrid' | 'specific';
  verify: 'declared-checks' | 'branch-ci' | 'none';
  signoff?: { roleKey: string; laneKey?: string };   // finish blocked until signed off
  approvalGates: PolicyGate[];                        // in-run acts needing an approver — reuse @builderforce/agent-tools spec.ts:118
  delegation: { requested: boolean; readsBeforeNudge: number };  // requested = asksForSubagents(prompt) unless declined; default nudge after 6 reads
}

export interface RunPorts {
  model: ModelTransport;           // complete(request, signal) → completion
  capabilities: CapabilityProvider;// @builderforce/agent-tools contract (files, shell, git, platform, memory, human)
  store: RunStore;                 // load/save RunState; commitMemory(consolidated)
  events: EventSink;               // typed RunEvent stream + the uniform outcome row (§8.2)
  human: HumanChannel;             // ask(question, options) | approve(gate) → answer | 'paused'
  steering?: SteeringSource;       // drain(): user messages since the last step
  context: ContextSource;          // pack(task) → ContextPack, built once before turn 1 with NO model call (§6.10)
}

/** Volatile per-run context. It goes in the turn-context block, never in the cached prefix. */
export interface ContextPack {
  focus: Array<{ path: string; outline?: Array<{ heading: string; line: number }>; content?: string }>; // named files: whole when under the read cap, else outline
  chat?: { tickets: unknown[]; runs: unknown[] };   // what gatherChatDiagnostics reads
  repos?: Array<{ repo: string; branch: string; dirty: string[] }>;
  facts: Array<{ key: string; content: string }>;   // codemap:<area> facts for the areas the focus files name
  recall: string[];                                  // Evermind recall, queried with prompt + focus-file terms
}
// ModelTransport also exposes window(model) → number | undefined, which the tools policy uses
// to size the result cap (§6.10). The policy falls back to today's fixed caps when it is undefined.

export type RunOutcome =
  | { kind: 'finished'; output: string; state: RunState }
  | { kind: 'paused'; question: string; approvalId: string; state: RunState }
  | { kind: 'yielded'; state: RunState }          // maxSteps reached; resume later
  | { kind: 'failed'; reason: string; state: RunState };

/** Plain JSON. Everything any policy needs across a step boundary. */
export interface RunState {
  messages: unknown[]; step: number;
  guards: LoopGuardState;          // progress, cascade, pendingPause, checksNote — WS1 names this type; today's guard state lives in costLoop/loopGuards.ts
  finish: FinishGateState;         // placeholder / CI-pending / no-deliverable counters, signoff recorded — reuse cloudAgent/finishGates.ts:55, do not redefine
  model: RunPolicyState;           // @builderforce/run-policy — pins, tried/broken/proven models, failovers, turnRetries
  memory: RunKnowledgeState;       // working memory + tool tally — reuse @builderforce/agent-tools run-knowledge.ts:96, do not redefine
  compaction: CompactionState;
  writtenPaths: string[];
  askedGates: string[];
  reads: ReadCoverageState;        // the windows the model was SERVED (post-trim), plus the read-without-spawn count
}
```

Contract changes go through WS1 only. Another workstream that needs a field files the request
in its hand-off note and keeps working against a local type until WS1 merges the change.

### 3.3 Done means

| Check | Passes when |
|---|---|
| Conformance suite | One scripted task (fake model, in-memory provider) through all four adapters gives the same `RunEvent` trace and `RunOutcome`. The cloud adapter runs it one step per tick and still matches. A board-dispatched variant with `signoff` set is included. |
| `check:one-execution` | Nothing outside `packages/agent-run` imports `runAgentLoop` or any `policy/*` module. |
| Adapter size | Each adapter < ~300 lines, only builds ports. Today the five loop-bearing files total **3945 lines** (`cloudAgentEngine` 2398, `agent-loop.ts` 695, `agentReplyLoop` 446, `creationCanvasAi` 247, `runLoop` 159) — §4.0.2. |
| Parity | Every pre-existing behaviour test passes **unchanged** (§5.1). `check:tests-unchanged` enforces; the test count does not drop. |
| Matrix | The design's final matrix holds: one policy module per row, entry points differ only by port. |
| No lost capability | Every §7 row's old tests pass against its new home before the old home is deleted. |
| Telemetry | Every entry point writes the uniform outcome row (§8.2); VS Code stays at or better than baseline (§8.1). |
| Efficiency | The §8.4 reference scenario replays through every adapter within its budgets: first spawn by parent turn 5, ≤15 parent turns, 0 covered-read stubs for unseen lines, 0 repo-resolution errors, 0 shell reads of workspace files, and no readiness claim left unkept for more than 2 turns. A stop settles the run in ≤2 s with no child process left, and a mid-run steer reaches the next model call. |

## 4. Workstreams

Workstreams run in parallel wherever the dependency graph allows. **File ownership is
exclusive.** You edit only the paths your workstream owns. If you need a change elsewhere,
write it in your hand-off note for that path's owner.

```
WS0 ──┬─► WS8 efficiency fixes on today's homes (a–h, parallel; ships to VS Code now)
      │
      └─► WS1 ──┬─► WS2a compaction ─┐
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

### WS8 — Efficiency fixes on today's homes (parallel with WS1; after WS0)

VS Code carries ≈all the traffic and is months from its WS4 cut-over, so four defects from §2.1
are fixed where they live today. Each one lands with a test on the old home first (§5.1 step 2).
The WS2 module that later ports that home brings the test along unchanged. This is not a
parallel copy: the WS2 port moves this code, and it never rewrites it.

| WS | Owns | Do | Accept |
|---|---|---|---|
| 8a | `packages/run-guards/src/readCoverage.ts`, `brain-embedded/src/readCoverage.ts`, `brain-embedded/src/runStore/{dispatchTool,toolCallHooks,beforeDispatch}.ts`, `packages/tool-output-policy/src/readFileWindow.ts` | **E1.** Cache what the model was served: the windowed `read_file` value (before the advisory is attached). Keep the untrimmed copy only for the replay. `servedReadWindow` and `clipRequestedToEof` read the served copy's `offset`/`truncated`/`totalLines`. A covered-read replay serves the *requested* window from the cached full result, not offset 1. A read-only `run_command` that prints a workspace file (`cat`/`sed -n`/`head`/`tail` on one path) records coverage of the lines it printed, so the same window is not read twice. | Characterization test first: a 534-line file trimmed to ~250 lines; the read at offset 251 is **not** stubbed; the replay at offset 251 returns line 251. The existing `readCoverage.test` cases pass unchanged. |
| 8b | `packages/agent-tools/src/{git-tools,capabilities,tool,core-tools}.ts` (pure resolver + `ShellCapability.defaultRepo` + `run_command` `cwd`); `clients/vscode/src/{localShell,localCapabilities,nativeBrainRun,brainRunHost,bfApi}.ts` (resolution); `clients/vscode/src/ticketBranchTool.ts` (reuse) | **E3.** One pure `resolveDefaultRepo({ candidates, paths, projectRepos })` in agent-tools, next to `inferRepoFromPath`. It resolves in this order: explicit `repo` → a repo-relative path in the request or args → the chat's project repo (`GET /api/repos/projects/:id/repositories`, matched to a checkout's origin with `parseRemoteUrl`) → the only candidate. If none of those decides it, return today's candidate error. `runGitTool` and `runPublishTool` both use it. `run_command` runs in the default repo (with an optional `cwd` arg inside the workspace). `ticketBranchTool`'s own `checkoutsUnder`/candidate message is migrated onto it (no second copy). | Characterization tests for today's candidate error first (`git-repo-scope.test`). New cases: a path in the request picks the repo; the project repo picks it; a single checkout picks it; explicit `repo` wins. |
| 8c | `brain-embedded/src/delegationRequest.ts`, `brain-embedded/src/runStore/dispatchTool.ts`, `packages/run-guards/src/` (a pure reads-without-spawn counter) | **E5.** When `leftDelegationUndone` holds and the run has made `readsBeforeNudge` (6) read calls with no spawn, the next read result carries the undelegated-request nudge as its advisory. It fires once per run, and the end-of-run recovery stays as the backstop. The nudge names the expected shape: the parent reads only the request's named document, then spawns research children with briefs. | Test: a scripted run that asks for sub-agents and reads 6 times gets the nudge on read 6, not at the final answer. A run that spawns before read 6 gets no nudge. The existing `delegationRequest` / `finalAnswerHook` tests pass unchanged. |
| 8d | `clients/vscode/src/{memoryCommit,editorRunEnd,bfApi}.ts` | **E8.** Send `chatId` and `fileAnchors` on the codemap write; the route accepts both. There is no `tags` field or column, and the `codemap:` key prefix is what every reader filters on. Read-only runs are already consolidated, because `consolidate` counts reads toward its 3-file minimum. When the Memory switch is off, put one line in the run trace saying no facts were written, so diagnostics don't read "0 writes" as a fault. | `memoryCommit.test` passes unchanged, plus new cases for the read-only consolidation and the sent fields. |
| 8e | `packages/agent-tools/src/{capabilities,core-tools}.ts` (`ShellCapability.run(command, { signal })`; `runCommandTool` passes `ctx.signal`); `packages/agent-loop/src/loop.ts` (race the dispatch against cancel); `clients/vscode/src/{localShell,fileTools,nativeBrainRun}.ts` (signal → `exec` `signal` + kill the process tree on Windows); `brain-embedded/src/runStore/{dispatchTool,runControl}.ts` (`runTool(name, args, signal)`); `brain-embedded/src/useChatTurns.ts` + `clients/vscode/webview/src/chat/useChatSend.ts` (mid-run routing); a pure `stopIntent(text)` in `packages/run-guards` (shared with on-prem's `ABORT_TRIGGERS`, which moves onto it) | **E10.**<br>1. **Stop kills the work.** The run's abort signal reaches every tool through `ToolContext.signal`. The VS Code shell kills the child process tree on abort and doesn't run the cmd→bash retry after an abort. The kernel races the in-flight dispatch against cancel, so the run settles `cancelled` within 2 s of Stop and the late tool result is dropped.<br>2. **A mid-run message steers by default.** While a run is active, a typed message goes to `run.steer`, not the hold queue; "Queue for after" becomes the explicit chip, the reverse of today. The steer interrupts the running step: it aborts a foreground `run_command` (the steer tells the model it was interrupted) and skips the remaining calls of that turn, as on-prem does. It is drained before the next model call and recorded as `steer.applied`.<br>3. **Stop intent in text equals the Stop button.** A message that `stopIntent` matches ("stop", "STOP executing", "stop now", "halt", "cancel the run", `/stop`; not "don't stop" and not "stop the server") stops the run like the button does. The text still lands in the chat. | Characterization tests first, against today's code:<br>• Stop during a long `run_command` leaves the child alive. This test flips when the fix lands, and is the planning model's one sanctioned behaviour change.<br>• A mid-run message is held.<br>New tests:<br>• Stop kills a `sleep 600` child in under 2 s on Windows and POSIX.<br>• The kernel returns `cancelled` with a dispatch still in flight.<br>• A typed "STOP executing" stops the run.<br>• A typed "write the update now" reaches the model on the next call, and the command it interrupted is reported as aborted.<br>The `useChatTurns`, `brainRunStore`, `engineRun`, `loop.test` and `abort.test` cases pass unchanged, except the held-message case named above. |

Added 2026-10-25, when the operator asked for every item that improves VS Code execution to
ship now. Each of these is built on today's VS Code home. WS2e/f/g port it to the other
entry points, carrying the tests unchanged.

| WS | Covers | Do (VS Code) |
|---|---|---|
| 8f | **E2 context pack** + recall query | `brainRunHost.ts` `runContextFor` gains a third part, the pack (§3.2 `ContextPack`). It is built once per run with no model call, time-boxed and failure-tolerant:<br>• focus files: inlined if ≤16k chars, otherwise their outline;<br>• the chat's linked tickets and runs;<br>• git state for each checkout;<br>• matching `codemap:` facts.<br>The pack renders as the volatile turn-context block. Recall queries with the prompt plus a host hint built from the focus paths and headings. |
| 8g | **E4 reads** + **E6 background shell** | `windowedCap` with the run's resolved window, threaded into `trimToolResult`. `read_file` `paths[]` (≤8) and a markdown outline when a file is over the cap. `run_command` `background` / `yieldMs` plus `command_status` / `command_stop` on a `ShellCapability.start/poll/kill` job API. Jobs die with the run. |
| 8h | **E7 model preflight** | Before turn 1, check BYO health (refreshing first where the API supports it). An expired, revoked or unresolved provider is announced in the run before any work. `llm.model_downgrade` fires for auto-routed turns too. |

Added 2026-10-25 (evening), after the overnight run of VS Code chat #6 ("implement the PRD
using subagents", 857 turns, ~6.5 hours, 11 children, 5 files written). Diagnosed from the
chat's local journal and the ops DB. Each item ships on today's home now; the WS2 module that
owns the area ports it, tests unchanged.

| WS | Defect (verified) | Fix on today's home | Ported by |
|---|---|---|---|
| 8i | **A mention of sub-agents was read as a request for them.** Every PRD 35 brief names the sub-agent policy, so the WS1 coder was told "STOP READING AND DELEGATE" at step 2, spawned four researchers and waited 90 minutes before its first write; a research child fanned out four more. | `asksForSubagents` matches an ask ("use / via / delegate to / run … sub-agents", "spawn agents"), never a mention; one `runLeftDelegationUndone(run)` (`brain-embedded/src/runStore/earlyDelegation.ts`) behind all three gates. A sub-agent runs the same gate as its owner, on its own brief: no lineage branch. | WS2c (`RunPolicy.delegation` is set from the user's request only, never from `RunTask.dispatch.source: 'subagent'`) |
| 8j | **Child reports were cut twice.** 4K per report in VS Code, then the 6K default cap on `wait_agents`; owners re-asked finished children and re-spawned researchers. | `SUBAGENT_REPORT_CHARS` (8K) + `clipChildOutput` in agent-tools, used by the VS Code and cloud report builders; `wait_agents: 32_000` in `tool-output-policy`. | WS2c / WS2f |
| 8k | **Learned routing sealed out stronger coders.** Any model with ≥8 samples ranked ahead of every cold one, so a STANDARD model with history led `code` turns over a never-tried ULTRA coder indefinitely. | `liftUntriedStronger` (`packages/model-router`), quality-first roles only, on both the connected-account and plan-pool paths. | WS2g |
| 8l | **Empty-handed runs taught the router nothing.** IDE outcomes were reported only when code changed. | `codeRunOutcome` grades `failed` for a change request that ran ≥20 turns and changed and delegated nothing (stopped or not), for the model that served most turns. One rule for every run, sub-agents included; a research brief reads as a question (`asksForChange`), and an owner's wake turn is not a request. | WS2g + WS6 |
| 8m | **Dead OpenRouter connection led every request** (~1,770 401s in one night): only the daily probe alerted a connection and the seed never read connection alerts. | Live-failover connection alerts (keyed connections) + `demoteAlertedConnections` in the credential resolver. | WS2g |
| 8n | **No consumption awareness.** An account was demoted only after it refused a turn. | `providerHeadroom.ts`: provider rate-limit headers (Anthropic unified/API, OpenAI-style, Codex) observed per attempt; an owner account ≥90% used is demoted until its window resets. | WS2g |
| 8o | **A dead Claude refresh token read as transient** ("expired — retry") for the whole night: Anthropic/OpenAI resolvers treated 400 `invalid_grant` as transient, xAI/Kimi as revoked. | One `isRevokedRefresh` (400/401/403) for all four subscription resolvers. | WS2g |

Not code: that night every frontier account the tenant had was refused — Anthropic (refresh
token dead), Grok (403 "out of credits or need a Grok subscription"), Codex (403), Kimi (429)
and the OpenRouter connection (401). With 8k–8o the router routes and reports this honestly,
but a coder can only be used once the owner reconnects or tops up an account.

Added 2026-10-27, after VS Code chat #6 kept saying it was ready and kept reading. Run #562
went 105 turns and was flagged `⚠ SPUN` after 78 changes. The chat as a whole ran 2,067 turns,
almost all of them on MiniMax Flash and local Kimi. The phrase is any of "Now I have everything
I need", "one final check, then I write" or "let me now implement", and each one is followed
by one more read.

| WS | Defect (verified 2026-10-27) | Fix on today's home | Ported by |
|---|---|---|---|
| 8p | **A run that says it is ready and keeps reading trips no guard, on any entry point.** Three gaps:<br>1. **VS Code has no progress detector.** The A3 `ProgressDetector` (`packages/run-guards/src/progressDetector.ts`) is bound in the cloud's `costLoop/loopGuards.ts` and in `packages/agent-run/src/policy/guards` (WS2d). Nothing in brain-embedded or `clients/vscode` uses either.<br>2. **A3 would not catch this loop even where it is bound.** Its `no_progress` window counts a call that names a path the run has not touched before as progress (`noProgress.ts`: "exploring new files IS progress"). So "I have everything I need" followed by one more new file resets the window every turn.<br>3. **The VS Code breaker misses it.** `cacheServedStreak` counts only repeats the read cache answered, and a new file is new ground. It also switches off once the run has changed code, and it fires at most twice a run. The announced-call re-prompt fires only when no call is made. | **1. A new A3 signal, `unkept_ready`, in `run-guards`, so every binding gets it.**<br>• A pure `claimsReady(text)` matches the model's own declaration that it is done gathering or about to write: "I have everything I need", "I now have enough", "one final check, then I write", "now I'll implement / write / make the change", "let me write the update now". It does not match text inside code fences or quotes, or a negated claim ("I don't have enough yet").<br>• A turn whose text `claimsReady` and whose calls are all read-only is an **unkept claim**. Read-only means no write or edit, no `spawn_agent(s)`, no `hand_off` and no `ask_user`.<br>• A turn that changes a file, spawns, hands off or asks clears the count.<br>• The second unkept claim of a run is a trip. New paths do not reset it.<br>• `ProgressDetector` composes it as a fifth signal, ranked between `circling_read` and `no_progress`. Its state is plain JSON, so the cloud's one-turn ticks carry it.<br>**2. VS Code binds the detector now.** It binds the one `ProgressDetector`; it does not copy it. Every brain-embedded run gets it: parent and sub-agent, before and after edits, planning and coding (lever `a3_progress_detector`, already at 100%). The run store calls `observe` on every dispatched call and `endTurn` on every model turn. The detector's ladder maps onto what the editor already has:<br>• **steer:** the note goes in the next turn-context block;<br>• **escalate:** a forced change turn through `progressBudget.ts` (`changeToolsOf`, `changeBrief`; `hand_off` alone while planning);<br>• **pause:** `ask_user` with `progressPauseQuestion`.<br>Trace: `loop.progress_check`. The binding lives in its own `runStore/progressGuard.ts`, so no run-store file grows past its limit. | WS2d: `policy/guards` gets the signal through `run-guards`, so there is nothing to copy. At WS4 the VS Code binding is deleted for `policy/guards`, and its tests move over unchanged. |

**8p accept.**
- **Characterization test first, on today's code.** A fake model's turns each say "Now I have everything I need" and read one new file. Today no guard fires in 20 turns. This test flips when the fix lands, and it is the planning model's sanctioned behaviour change for 8p.
- **New tests:**
  - The second unkept claim trips. The turn after the trip offers only the change tools, or `hand_off` while planning.
  - A review run that reads 30 new files and makes no readiness claim does not trip.
  - A claim followed by a write, a spawn or a hand-off clears the count.
  - A sub-agent follows the same rule.
  - `claimsReady` cases: the matches above; a quoted or fenced phrase, a negated claim and the user's own words do not match.
- **Unchanged:** the existing `progressDetector`, `noProgress`, `cacheServedStreak`, `loopGuards` and agent-run `guards` tests pass unchanged.
- **Budget:** §8.4's "turns from a readiness claim to a change" row holds.

E9, one catalog strategy across executions, stays in WS2f. VS Code's lexical ranking works as
it is. The fix is to unify the other executions onto one strategy, and it needs WS6's
telemetry to compare.

WS8 ships in the next VSIX and api releases. Each item bumps the versions of the packages it
touches.

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
| 2c | `steering`, `ask`, `subagents` | `runtime/cloudLoopControl.ts` + `lateSteerStore.ts`; composer queue (`brain-embedded` run store); on-prem `steeringQueue`; SDK `SteeringChannel` semantics · kernel `ask_human`, `ASK_USER_TOOL` (options + pending), on-prem `askHumanTool` · `runtime/cloudSubagent.ts`, `cloudChildRuns.ts`, `clients/vscode/src/subagentTool.ts`, SDK `Task` · `brain-embedded/src/delegationRequest.ts` + the WS8c in-run nudge → `RunPolicy.delegation` on every entry point · stop and interrupt: WS8e `stopIntent`, signal-to-tool, the steer that interrupts a step; on-prem `agent-loop.ts` skip-remaining-calls + `bash-tools.exec.ts` kill-on-abort | steering relay, human-in-loop, sub-agent tests, `delegationRequest` tests, WS8e stop tests, on-prem `abort.test` + exec abort tests |
| 2d | `finish`, `guards`, `verify` | `cloudAgent/finishGates.ts` (placeholder, no-deliverable, CI-pending, review verdict, **signoff**); @-reply verify pin; `costLoop/loopGuards.ts` (A3, D1, D7, D8; A3 gains `unkept_ready` through `run-guards`, WS8p); `cloudAgent/inRunVerify.ts`, `sandbox/sandboxVerify.ts`, `cloudAgent/runVerifyThenRemember.ts` | `loopGuards.test`, finish-gate tests, `inRunVerify.test`, `runEndMemory.test` |
| 2e | `memory` + `context` | `costLoop/volatileTail.ts`; `brain-embedded/src/runStore/completeTurn.ts` + `runPreamble.ts` + `runMemory.ts` (recall) + `turnContext.ts`; `clients/vscode/src/brainRunHost.ts` `runContextFor`; on-prem `agent-loop.ts` brief + `infra/knowledge-loop.ts`; `cloudAgent/runEndMemory.ts`; `clients/vscode/src/memoryCommit.ts`, `editorRunEnd.ts`, `sessionNotes.ts`; `agents/sdk-memory-server.ts` (→ memory tools); `brain-embedded/src/gatherChatDiagnostics.ts` readers (→ `ContextSource`). **Also builds (§6.10):** the `ContextPack`; the recall query from prompt + focus-file terms; the per-turn brief on @-reply and canvas (missing today); codemap write-back on every entry point with WS8d's fields. | `run-knowledge.test`, `knowledge-loop.test`, `runEndMemory*.test`, `memoryCommit.test`; new: context-pack conformance case |
| 2f | `tools` | capability gate (`cloudAgent/runSurfaceCaps.ts`, `cloudAgentTools.ts`); `brain-embedded/src/selectTools.ts` (lexical rank, synonyms, pinning); `costLoop/deferredTools.ts` (core set + `tool_search`); `llm/cloudAgentToolset.ts` `CHAT_SCOPED_AGENT_TOOLS` → `toolScope: 'chat-reply'` data; canvas tool port; `SDK_TOOLS` + `allowedToolsAfterGates` → policy gates; read coverage (`packages/run-guards/src/readCoverage.ts` + brain-embedded binding, after WS8a); result caps (`tool-output-policy`, on-prem `tool-result-truncation.ts` + `tool-result-context-guard.ts`, @-reply 8k slice); on-prem `bash-tools.exec-runtime.ts` background exec + `process` poll; default repo (after WS8b). **Also (§6.10):** one catalog strategy, a core set plus `tool_search` with no lever; `find_symbol` on cloud; `read_file` `paths[]` and a large-markdown outline pointer; one window-sized cap. | `cloudSurfaceCaps.test`, `selectTools` tests, `claude-agent-sdk-runner.test` (gate cases), `readCoverage.test` (both), `tool-output-policy` tests, on-prem truncation / context-guard / exec tests, `git-repo-scope.test` |
| 2g | `model` | `cloudAgent/cloudRunModelPolicy.ts`, cascade, learned routing, limbic state; @-reply cascade; `clients/vscode/src/modelRouting.ts` policy half (Local only / Hybrid / Specific); `frontend/src/lib/canvasModelPort.ts` policy half; on-prem gateway model config; BYO resolution signal (`tenantProviderKeyService.ts` `unresolvedReasons`, `byoCredentialHealth.ts`). **Also (§6.10):** a preflight before turn 1; `llm.model_downgrade` for auto-routed turns too. | `cloudRunModelPolicy.test`, `modelRouting` tests, routing package tests, `byoCredentialHealth` tests |

### WS6 — Telemetry (parallel with WS2)

- **Owns.**
  - `packages/agent-run/src/telemetry/**`: the outcome row builder and the `RunEvent` → row mapping.
  - An API migration pair (expand now, contract in a later push):
    - `llm_usage_log.entry_point` and `run_model_outcomes.entry_point`;
    - fill `turn_index` and `tool_schema_tokens`;
    - `run_model_outcomes.compactions` and `run_model_outcomes.verify`;
    - the §8.2 efficiency fields: `first_spawn_turn`, `covered_read_stubs`, `shell_file_reads`, `repo_errors`, `context_pack_tokens`, `model_preflight`, `unkept_ready_claims`, `progress_trips`.
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

#### How the parent works (hard rule, from the 2026-10-25 run, §2.1)

The parent plans. It does not research. Research means reading code, searching, or tracing
callers, and it always goes to children.

1. **Turns 1–2.** Read this PRD (one `read_file`, or its outline and then the sections in
   question) and the chat's state, which the context pack supplies (§6.10). Do not call
   `chats_list_tickets` or `chats_runs` for state the pack already holds. Do not read source
   files.
2. **By turn 5.** Spawn research children with `spawn_agents`: one per question or per
   workstream, each with `role: "explore"` and a brief. A brief states:
   - the question;
   - the files or folders to start from (§4's "Ports from" column);
   - what is already known, and what is ruled out;
   - the answer's shape: paths with line numbers, short excerpts, a word cap.
3. **While children run.** Draft the PRD / ROADMAP edits that don't depend on their answers.
   Run long shell work in the background (§6.10). Never run it in the foreground.
4. **When children report.** Write the PRD / ROADMAP / DONE edits **in the same turn** that
   the last answer arrives. Filing tickets is not the deliverable. A run that files tickets
   and leaves them undispatched, or that ends without the requested doc edit, has failed.
5. **Budget.** A planning or PRD-update request finishes within 15 parent turns (§8.4). If it
   is going over, stop reading and spawn.

The same rule holds in Claude Code: the planner reads the PRD and delegates code research to
Explore subagents in parallel.

## 6. Behaviour each policy module must keep (summary; sources in §4)

1. **Compaction.** Trigger on window pressure with reserve tokens. Summary-replace older
   turns. Never drop the system prompt or the current task.
2. **Stall.** Detect narration, announced-but-untaken calls and repetition. Re-prompt.
   Force a final synthesis without tools when exhausted. Lift a prose question into ask.
3. **Steering and stop.** Drain user messages between steps and acknowledge each as
   `steer.applied`. A late steer is never lost. In addition, on every entry point (WS8e, E10):
   - A message typed during a run steers it by default.
   - A steer interrupts the step that's running. It aborts a foreground tool and skips that
     turn's remaining calls.
   - Stop, or a message `stopIntent` matches, aborts the tool in flight through
     `ToolContext.signal` and kills its process. The run settles `cancelled` within 2 s.
   - The model never gets another turn after a stop.
4. **Finish.** Placeholder and no-deliverable blocks, the CI-pending wait, the review-verdict
   requirement and the **sign-off requirement**, with counters persisted across steps. The
   verify pin.
5. **Guards.** A3 progress detector (steer → escalate → pause), on every run of every entry
   point: parent and sub-agent, before and after edits. Its five signals are edit-revert,
   repeated failure, circling read, unkept readiness claims and no progress. An unkept claim is
   a turn that says the run is ready ("I have everything I need") and then only reads (WS8p).
   New files reset the no-progress window, but they never excuse an unkept claim. D1 cascade
   with escalation events. D7 post-edit checks, with the note shown on the next turn. D8 parallel reads.
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
10. **Context and efficiency (§2.1; WS8 first, then WS2c/e/f/g).** These are the same on
    every entry point:
    - **Context pack before turn 1.** The adapter's `ContextSource` builds the
      `ContextPack` in one parallel fan-out, with no model call. It is attached as the
      volatile turn-context block, so the cached system prefix doesn't change.
      - Focus files are the paths named in the prompt or attachments. A focus file under the
        read cap is inlined whole; otherwise the pack carries its heading/symbol outline with
        line numbers (`file_outline`'s extractor).
      - Chat state comes from the `gatherChatDiagnostics` readers.
      - Git state is read per repo.
      - The `codemap:` facts are those for the areas the focus files name.
      - The pack is capped at 8k tokens. It drops the oldest or largest parts first and says
        what it dropped.
    - **Recall query.** It is built from the prompt plus the focus files' headings and the code
      paths they name, never the bare sentence.
    - **Read coverage.** It records what the model was *served* (post-trim) and covers
      `read_file` plus read-only shell prints of a file. A replay serves the requested window.
      It applies on every entry point; today only brain-embedded has it.
    - **One result cap.** It comes from `windowedCap(tool, tableCap, window)` in
      `tool-output-policy`, with the window from `ModelTransport.window()`:
      - `read_file`: `clamp(windowToolResultCap(window), 16k, 64k)`;
      - every other tool: `min(tableCap, windowToolResultCap(window))`;
      - unknown window: the table cap. This replaces the cloud C7-off uncapped path, the @-reply 8k slice, canvas's
      missing cap and on-prem's second guard, whose constants disagree with the package.
    - **Reading tools.**
      - `read_file` accepts `paths: string[]`, up to 8, with each file windowed and capped on
        its own.
      - A read of a markdown file larger than the cap returns its outline first, with a note
        to page by heading line.
    - **One catalog strategy.** A role core set (≤20) plus `tool_search`, with no lever. The
      pinned, required and named-in-prompt tools stay advertised. `find_symbol` is registered
      wherever `repo.symbols` exists, cloud included.
    - **Default repo.** It is resolved by WS8b's resolver into `RunTask.workspace.defaultRepo`,
      and git tools and the shell use it.
    - **Background shell.** `run_command` gains `background` / `yieldMs`, plus a `process`-style
      poll that returns a job handle. This ports on-prem's exec runtime to the shared tool. A
      foreground command keeps the 10-minute ceiling.
    - **Delegation.** When `RunPolicy.delegation.requested` is set, the nudge fires after
      `readsBeforeNudge` reads with no spawn (WS8c), and the end-of-run check stays as the
      backstop.
    - **Model preflight.** Before turn 1 the model policy checks BYO resolution for the
      vendors the role ladder would use.
      - An `expired` token gets one refresh attempt.
      - If the token is still unresolved, or the plan phase would land on a Flash-class
        (non-`agentic` tier) model, the run emits `model.preflight` with the reason. The
        HumanChannel shows it before any work starts.
      - `llm.model_downgrade` also fires for auto-routed turns.
    - **Write-back.** Every entry point that reads ≥3 files commits a `codemap:` consolidation
      at run end, with `chatId` and `fileAnchors` (the anchors are derived server-side for
      every writer). There is no `tags` field: the `codemap:` key prefix is what readers
      filter on (WS8d). Read-only runs count.

## 7. Retention ledger (nothing is lost)

The full ledger, grouped by the parts of the one agent, is in the design reference
("Every capability, and where it lives at the end"). WS1 delivered the filled copy, with a
"Proven by" entry per row, at [`packages/agent-run/docs/retention-ledger.md`](../../packages/agent-run/docs/retention-ledger.md).
That file is the working ledger. 19 of its rows are marked **needs characterization test**;
the WS that owns each one writes it first (§5.1 step 2). The rows most at risk:

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
| Read de-dup / covered-read replay | `policy/tools` + `RunState.reads` | brain-embedded `readCoverage` + `beforeDispatch` (VS Code / Web / canvas only) | both `readCoverage.test` files + the WS8a characterization test |
| Background exec + poll | `agent-tools` `run_command` + shell capability | on-prem `bash-tools.exec-runtime.ts`, `bash-tools.process.ts` | on-prem exec / process tests |
| Window-sized result cap | `policy/tools` via `tool-output-policy` | on-prem `tool-result-truncation.ts`, `tool-result-context-guard.ts` | on-prem truncation + context-guard tests; `tool-output-policy` tests |
| Deferred catalog + `tool_search` | `policy/tools` | `costLoop/deferredTools.ts` (behind `c1_deferred_tools`) | `deferredTools` tests |
| Lexical tool ranking + router tools | `policy/tools` | `brain-embedded/src/selectTools.ts`, `toolRouter.ts` | `selectTools` tests |
| Delegation nudge | `policy/subagents` | `brain-embedded/src/delegationRequest.ts`, `finalAnswerHook.ts` | `delegationRequest` tests + WS8c test |
| Codemap write-back | `policy/memory` via `RunStore.commitMemory` | `cloudAgent/runEndMemory.ts`, `clients/vscode/src/memoryCommit.ts` | `runEndMemory*.test`, `memoryCommit.test` |
| Stop kills the running tool; a steer interrupts a step; stop words in text | `policy/steering` + `ToolContext.signal` on every capability | on-prem `agent-loop.ts` (steer skips remaining calls), `bash-tools.exec.ts` (kill on abort), `auto-reply/reply/abort.ts` (`ABORT_TRIGGERS`) | on-prem `abort.test` + exec tests; WS8e tests; a stop conformance case on every adapter |
| Default repo for git + shell | `agent-tools` resolver + adapter-built `RunTask.workspace` | `git-tools.ts` `inferRepoFromPath`, `ticketBranchTool.ts` `checkoutsUnder` | `git-repo-scope.test`, `ticketBranchReview.test` + WS8b cases |

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
`cache_read_tokens`, `cost`, plus these efficiency fields:
- `first_spawn_turn`: null when nothing was spawned;
- `covered_read_stubs`;
- `shell_file_reads`: `cat`/`sed`/`head`/`tail` of a workspace file;
- `repo_errors`: not-a-repo results;
- `context_pack_tokens`;
- `model_preflight`: `ok` | `refreshed` | `degraded:<reason>`;
- `unkept_ready_claims`: turns that claimed readiness and then only read (WS8p);
- `progress_trips`: the A3 trips, by signal.

Today VS Code rows lack tool counts, `turn_index` and `tool_schema_tokens` are always null,
and compaction is unrecorded; WS6 closes those gaps.

### 8.3 Separate findings (not in scope; logged in ROADMAP)

- 19,608 `auto_run_skipped` and 282 `auto_run_error` events in 30 days.
- 2,093 auth-401 model failovers.
- The builderforce-memory Claude Code hook recalls entries marked `[absorbed→Evermind v511] … (content lost)`: the absorb step kept the key but dropped the body, so recall returns empty stubs. That is builderforce-memory's absorb path, not this program.

### 8.4 Reference scenario: "update a PRD using sub-agents"

The 2026-10-25 run (§2.1) becomes a scripted conformance case and a live regression check.

**The task.** "Review `docs/specs/35-prd-one-agent-one-kernel.md` and update it using
sub-agents." The scripted version runs in a multi-repo workspace root with a 45 KB markdown
PRD.

| Measure | 2026-10-25 run | Budget |
|---|---|---|
| Parent turns to finish | 79+ (unfinished) | ≤ 15 |
| Turn of the first spawn | never | ≤ 5 |
| Reads of the PRD | 8 (4 windows + 2 `sed` + stubs) | ≤ 2, or outline + sections |
| Covered-read stubs for lines never served | ≥ 1 | 0 |
| `repo_errors` | 2 | 0 |
| Foreground commands over 2 min | 1 (10 min) | 0 |
| PRD edited | no | yes |
| Planning model | Flash (silent fallback) | stated by `model_preflight` before turn 1 |
| Time from a typed "write the update now" to the model seeing it | never: held until the run ends | the next model call; a foreground command running at the time is aborted |
| Time from Stop / a typed "STOP" to the run settling | never: the 5 m+ command kept running | ≤ 2 s, with the child process gone |
| Turns from a readiness claim ("I have everything I need") to a change, spawn or hand-off | never: chat #6 claimed and kept reading (run #562: 105 turns, `⚠ SPUN`) | ≤ 2 (WS8p) |

The live check runs on WS8's VSIX and again on WS4's. A miss routes to the planning model.

## 9. Out of scope

- New capabilities, except the §6.10 efficiency items. Most of those port a capability that one
  entry point already has to all of them. The genuinely new pieces are the `ContextPack`,
  `read_file` `paths[]`, `model.preflight` and the read-only codemap consolidation.
- UI redesign. The VS Code / web surfaces keep their UI; only the run underneath changes.
- Changes to the board and governance behaviour itself (§6.9 retargets dispatch only).
