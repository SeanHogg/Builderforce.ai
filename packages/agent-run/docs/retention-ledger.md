# PRD 35 §7 — Retention ledger (nothing is lost)

WS1 deliverable. Full copy of the §7 retention ledger from
`docs/specs/35-prd-one-agent-one-kernel.md` (whose rows summarize the design
reference `docs/design/one-agent-one-kernel.html` "Every capability, and where
it lives at the end"), with the **Proven by** column filled per §5.1.

- **Proven by** names the existing test file(s) that must pass, *unchanged*,
  against the capability's end-state home before its old home is deleted
  (§7 "No lost capability"). A row marked **needs characterization test** has
  no test today; its workstream writes the characterization test as part of
  porting (WS2–WS8), and `check:tests-unchanged` enforces that pre-existing
  tests are only touched for import/mock-path changes.
- Rows whose old home is `api/src` governance (§6.9) are **untouched**: the
  governance layer keeps its single owner; WS3 retargets dispatch only.
- Paths are repo-relative. Test files were verified to exist on `main` at
  WS1 time except where a row is explicitly marked as needing a test.

## The agent's loop (on the one kernel)

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Tool loop, streaming, cancel, budgets | Agent `runAgent` on the kernel | Kernel; Claude SDK loop | `packages/agent-loop/src/loop.test.ts`, `cancelDispatch.test.ts`, `runNarration.test.ts`; WS1 conformance suite (`test/conformance/conformance.test.ts`) |
| Step-at-a-time runs (resume between Durable Object ticks) | Agent, via `RunState` + `maxSteps` | `cloudAgentEngine` durable ticks | cloud engine/DO tests under `api/src/application/runtime/`; WS1 conformance `maxSteps: 1` resume-equivalence case |
| Prompt assembly: persona, skills, governance, heartbeat prompt, psychometrics | Agent prompt assembly | SDK runner (persona/skills append); on-prem embedded runner; cloud engine | agent-runtime embedded-runner tests under `agent-runtime/src/agents/`; **needs characterization test** consolidating the three prompt sources (no dedicated brain-embedded `runPreamble` test today) |

## The agent's run policy

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Context compaction with reserve tokens | Agent `policy/compaction` | Cloud `compactMessages`; @-reply wiring; on-prem SessionManager; SDK auto-compact | needs characterization test (WS2a) |
| Stall / narration recovery, forced final synthesis, repetition trim, prose ask-lift | Agent `policy/stall` | Cloud; @-reply loop; `finalAnswerHook`; `canvasNoToolCalls`; on-prem `stall-recovery.ts` | `packages/agent-loop/src/repetitionLoop.test.ts` + on-prem `stall-recovery.ts` tests under `agent-runtime/src/`; **needs characterization test** for the brain-embedded `finalAnswerHook` / canvas / cloud variants (WS2b) |
| Steering between steps | Agent `policy/steering` (source is a port) | Cloud steer drain; composer queue; on-prem `steeringQueue`; SDK `SteeringChannel` | `brain-embedded/src/runStore/steerInterrupt.ts` tests; needs characterization test for cloud/on-prem/SDK variants (WS2c) |
| Finish gates: placeholder, no-deliverable, CI-pending, review verdict, sign-off, verify pin | Agent `policy/finish` | Cloud `finishGates`; @-reply verify pin | cloud `finishGates` tests under `api/src/application/runtime/`; needs characterization test (WS2d) |
| Guards: progress (A3), cascade (D1), post-edit check (D7), parallel reads (D8) | Agent `policy/guards` | Cloud `LoopGuards`; @-reply cascade | cloud guard tests under `api/src/application/runtime/`; needs characterization test (WS2d) |
| Run-end verify (declared checks or branch CI) | Agent `policy/verify` | Cloud `inRunVerify` + `sandboxVerify` | cloud verify tests under `api/src/application/runtime/`; needs characterization test (WS2d) |
| Policy gates, cost levers, stable-prefix caching | Agent policy, switched by `RunPolicy` data | Cloud engine; SDK allowed-tool filtering | needs characterization test (WS2) |

## The agent's tools

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Read, write, edit, shell, glob, search | Agent tool registry (`agent-tools`): `read_file`, `write_file`, `edit_file`, `run_command`, `list_files`, `search_code` | SDK built-ins (Read, Write, Edit, Bash, Glob, Grep); cloud; editor | agent-tools tool tests under `packages/agent-tools/`; conformance case per tool in `test/conformance/conformance.test.ts` |
| Tool selection: capability gate, lexical ranking with synonyms, pinning touched tools, scope | Agent `policy/tools`: one selector; scope is `RunPolicy.toolScope` | Cloud capability gate; `selectToolsForTurn`; `CHAT_SCOPED_AGENT_TOOLS`; canvas tool port; `SDK_TOOLS` | `brain-embedded/src/selectTools.ts` tests; needs characterization test for the other selectors (WS2f) |
| Platform tools (the MCP catalog) | Agent tool registry, from every entry point | `builtinMcpService` (already one) | `api/src/application/llm/builtinMcpService` tests (untouched owner) |
| Machine tools: process, browser, orchestrate, fleet, MCP and plugins, channel actions (reactions, buttons, TTS) | Agent tool registry. Shared definitions move into `agent-tools`. The on-prem capability provider backs them. | On-prem native `AgentTool`s | each tool's agent-runtime tests under `agent-runtime/src/`; rows without one are listed by WS2f as needing a characterization test |
| Canvas board tools | Agent tool registry, backed by the canvas capability provider | `creationCanvasAi` tool port, board writers | `frontend/src/lib/creationCanvasAi.test.ts`; `canvasBuildTools` tests under `frontend/src/` |
| Shell and clone in the cloud; repo-less IDE workspace | Cloud capability provider: git API + sandbox (`sandboxCore`) + IDE workspace | Cloud engine; container ops (already removed) | cloud engine/sandbox tests under `api/src/application/runtime/`; `scripts/check-sandbox-core.mjs --check` + `check:container-shared.mjs --check` ratchets |
| Rehearsal shadow (dry run) | A provider decorator around the agent's capabilities | Cloud `decorateProvider`, frozen read ref | cloud `decorateProvider` tests under `api/src/application/runtime/`; needs characterization test |

## The agent's memory

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Per-turn run brief (working memory) | Agent `policy/memory` over builderforce-memory `/working` | Cloud, brain-embedded and on-prem wiring | needs characterization test (WS2e) |
| Run-end consolidation and code map; session notes | Agent `policy/memory`; the write goes to the store port | Cloud `runEndMemory`; `memoryCommit` / `editorRunEnd`; on-prem `knowledge-loop` | cloud `runEndMemory*.test` under `api/src/` + `clients/vscode/src/memoryCommit.test.ts`; needs characterization test for on-prem `knowledge-loop` |
| Recall / remember during a run | Agent memory tools on the `memory` capability | `sdk-memory-server`; `memory_recall` tool | **needs characterization test (WS2e)** — PRD §7 names this row as WS1-to-name; no existing test covers the in-run recall/remember path |

## The agent's model policy

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Model choice: role ladder, cascade, learned routing, limbic state, pins, Local only / Hybrid / Specific | Agent `policy/model` | `cloudRunModelPolicy`; @-reply cascade; `modelRouting`; `canvasModelPort`; on-prem gateway config | `brain-embedded/src/runStore/modelPreflight.ts` tests + `packages/learned-routing/` tests; needs characterization test for cloud/canvas/on-prem variants (WS2g) |

## The agent's people and children

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Ask a human, with options and a pending bar | Agent `policy/ask` | Kernel `ask_human`; `ASK_USER_TOOL`; `askHumanTool` | `packages/agent-loop/src/askUser.test.ts` |
| Sub-agents: read-only or writable, background, steerable, lineage | Agent `policy/subagents` (a child is the same agent) | Cloud child runs; editor `spawn_agent`; on-prem sessions; SDK `Task` | editor `subagentTool` tests under `clients/vscode/` + `brain-embedded/src/`; needs characterization test for cloud/on-prem/SDK variants (WS2c) |

## Above the agent: board and governance (one owner, retained as is)

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Autonomous execution from the board | Unchanged owner. Dispatches into the one agent. | `swimlane/laneEntryTrigger`, `runtime/autonomousExecutionSweep`, `swimlane/evaluateAutoRun`, `runtime/autoRunSkipLedger`, `runtime/dispatchCloudRun` | existing governance tests under `api/src/application/swimlane|runtime/` (untouched); board-dispatched conformance case with `signoff` (WS1 harness) |
| Approval before a run (`task.execution`), reusing an outstanding request; auto-approval rules | Unchanged owner, checked at dispatch. Approval id on `RunTask.dispatch`. | `approval/approvalGate`, `runtime/executionApprovalGate`, `approval/autoApprovalRules`, `approval/requestApproval` | existing approval tests under `api/src/application/approval/` (untouched) |
| Approvers by approver type: lane requirements, staffed lane agents, fail-closed; sequential chains | Unchanged owner. Resolved role reaches the agent as `RunPolicy.signoff`. | `swimlane/laneApprover`, `approval/approvalChain`, `kanban/managedLaneRoles`, `manager/staffUnfilledLanes` | existing lane/approval tests under `api/src/application/` (untouched) |
| Sign-off required to finish | Agent `policy/finish` enforces `RunPolicy.signoff` on every entry point | `kanban/signoffGate`; cloud `requiredSignoff` + `builtin_kanban_signoff` finish gate | `api/src/application/kanban/signoffGate` tests (untouched) + board-dispatched conformance case with `signoff` |
| In-run approvals: governance policy gates on tool calls; pause and resume | Agent `policy/ask` + `policy/tools` from `RunPolicy.approvalGates`; HumanChannel routes to the approvals queue | Cloud `policyGates` / `policyAskedGates`; `approval/decideApproval`; `executionResume`; SDK allowed-tool gates | cloud policy-gate tests under `api/src/application/runtime/`; existing `approval/decideApproval` tests (untouched) |
| Managed-board authority and manager coordination: audited override, never a refusal | Unchanged owner, at dispatch | `kanban/managedExecutionGuard`, `manager/coordinateTicket` | existing managed-execution tests under `api/src/application/kanban|manager/` (untouched) |

## Ports: the only thing an entry point supplies

| Capability | Lives in, at the end | Found today in | Proven by |
|---|---|---|---|
| Where the model runs: local-first, in-browser, gateway, BYO; XML tool-call lifting; served-window detection | ModelTransport port | `localFirstTransport`; `xmlToolCalls`; gateway clients | `xmlToolCalls` tests + local-first transport tests under `packages/` (agent-loop / model transports) |
| Where state lives: single-flight per chat, Stop, session files, Durable Object cursor | RunStore port | brain-embedded run store; on-prem sessions; CloudRunnerDO | `brain-embedded/src/runStore/` tests (`brainRunStore.test.ts` et al.) |
| Where events go: live trace, timeline, relay frames, webview | EventSink port | Run store trace; cloud timeline; relay | `brain-embedded/src/runStore/` trace tests + WS1 conformance trace-recording EventSink |
| How people are reached: tool-confirm gate, approval bar, relay ask, pause + resume | HumanChannel port | Run store confirm gate; cloud pause; relay | `brain-embedded/src/runStore/` confirm-gate tests; needs characterization test for cloud pause/relay variants |

## WS1 status against the acceptance bar

- Every §7 row has a **Proven by** entry: either named existing test file(s), or an
  explicit **needs characterization test** with the owning workstream.
- Rows marked **needs characterization test** are the input to WS2–WS8's
  parity-oracle work; `check:tests-unchanged` (report mode in WS1) enforces
  §5.1 while those ports land.
- The `memory_recall` / recall-during-a-run row is called out in PRD §7 as the
  highest-risk row; it is the first characterization test WS2e owes.
