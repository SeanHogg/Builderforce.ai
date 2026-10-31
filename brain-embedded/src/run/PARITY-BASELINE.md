# WS4 parity oracle (PRD 35 section 4, WS4)

The 20 test files that drive `startRun` (plus `clients/chrome` rovrRunHost and `clients/vscode` nativeBrainRun.setup)
run UNCHANGED against both engines. `BRAIN_RUN_ENGINE=agent` selects the agent. What fails on the agent is the list of
real gaps; this file burns down to zero. No test is skipped, edited or mocked to get there.

## Old-home baseline (engine `loop`, the default)

20 files, 173 tests, all green (run before and after the seam, the shared turn recorder and the live-turn extraction).
`clients/chrome` rovrRunHost 3/3, `clients/vscode` nativeBrainRun.setup 5/5.

Not green on the old home, reported to the planning model: `src/run/webAdapter.test.ts` was committed with two missing
imports (`getCell`, `beginRun`), so 3 of its 10 tests threw ReferenceError before any of this work. The only edit is two
`import` lines. It is not one of the 20 oracle files.

## Agent engine (`BRAIN_RUN_ENGINE=agent`): burn-down

Run per file (`NODE_OPTIONS=--max-old-space-size=8192`, one file at a time; a single batch ran out of heap).
After terminal `ask_user`, narration, the delivery gates, the agent-owned model policy and the per-turn menu:
**67 of 90 green in the six files that carried failures, 23 failing.** The other 14 files are fully green
(runDriver, runOutcomeCost, continueChat, continueClaim, continueStop, hostRunContext, modelPreflightPlan, modelSignals,
serverChat, startRun.lateBackstop, startRun.settle, useChatTurns.draftStop, useContinuation; earlyDelegation.child has
not finished on the agent engine, see the last row).

| File | pass / fail |
|---|---|
| brainRunStore.test.ts | 54 / 11 |
| handOffExecution.e2e.test.ts | 2 / 4 |
| readCoverageServed.test.ts | 1 / 2 |
| runStore/earlyDelegation.test.ts | 3 / 1 |
| runStore/forcedBriefTail.test.ts | 1 / 1 |
| runStore/progressGuard.test.ts | 6 / 4 |

### What is still failing, by the row that closes it

| Row | Failing tests |
|---|---|
| Closed in this pass | terminal `ask_user` x2, narration block, delegation gates x3 ("commands it holds", sub-agent request x2), ship/review gates, hand-off fan-out (the Brain's `hand_off` reports itself to the policy, so the agent no longer pre-empts it) |
| Forced turns and progress budgets still do not fire: `PlatformTools.turn` is wired (`run/loopTurnMenu.ts`, shared `forcedTurnFor`) but the plan budget never reaches its limit, so there is no `hand_off`-only turn at turn 20 | handOffExecution x3 ("expected -1 to be 20"), forcedBriefTail, handOffExecution "only reads" (`toolChoice` of an absent forced turn) |
| A3 / WS8p readiness guard: `run.progress.observe` runs in `afterDispatchHook` from the result row; the agent never feeds `RunProgressGuard.noteTurnText`/`observe` in the order the guard reads | progressGuard x4 |
| Tool-failure breaker and the forced tools-free answer that names the failures | brainRunStore: "no tool-call limit" x3 (run ends at 8 turns instead of 60; the closing answer is not the Brain's) |
| Coder re-ask wiring | brainRunStore: "re-asks the first code change of the coding model" |
| Provider failure retry and failover (`ModelTransport.pickFallback`, classify the stream error as a transport failure) | brainRunStore: "Grok starts and then stops" x2, "429" |
| Window fit for a small cloud model (`ModelTransport.window` over the gateway catalog; the transport's `fit` runs `windowFit.prepare` but the policy's own packing sees no window) | brainRunStore: "packs the transcript for a cloud model" |
| Read paging, replay and the served-window coverage: the post-step needs the result row with the identity the cell holds; `loopStore` appends a copy | brainRunStore x2 ("pages a big read_file by LINE", "re-serves an exact re-read"), readCoverageServed x2 |
| Early delegation advisory lost between `dispatchToolPort` and the agent's tool row | earlyDelegation "rides the sixth read" |
| Stall nudge: "hands the user the commands" | brainRunStore: "re-prompts it instead of accepting it" (the agent's own stall heuristics read `availableToolNames`; the Brain passes `toolSpecs` count) |
| `earlyDelegation.child` hangs on the agent engine past 8 minutes (no result); on `loop` it passes 3/3. A real gap until explained | earlyDelegation.child |

### The run row (ship gate, section 8.1)

`steps` on the row `run_model_outcomes` reads is `codeRunOutcome`'s count of `llm.complete` trace rows. The agent engine
records each completed turn through the SAME `recordTurn` (the finishing turn included), so `startRun`'s one
`codeRunOutcome` report reads the same figure on both engines. `BrainRunRequest.reportRunRow` (the agent's own uniform row)
is NOT wired by any host, so exactly one row reaches the ledger. `runStore/engineRunRow.test.ts` pins both: one scripted
two-turn run on each engine, one report each, equal `steps`. Wiring a host to `reportRunRow` while `codeRunOutcome` still
reports would double-write the ledger; do one or the other.

## Done in this pass (commit ebbb5ae19)

Seam and switch in `startRun` (`runStore/runEngine.ts`), `engine` on `BrainRunRequest`, the device reader shared by web and
Rovr (`runStore/runEnginePreference.ts`), the VS Code setting `builderforce.agent.engine`; one live-turn view
(`runStore/turnStream.ts`) and one turn recorder (`runStore/turnRecorder.ts`) shared by `completeTurn.ts` and the agent's
model port (`run/modelTransport.ts` + `run/loopTurn.ts`); `run/brainPlatformTools.ts` (closed `PlatformTools` that calls the
loop's own `beforeDispatchHook`, `dispatchToolPort` and `afterDispatchHook`), `run/loopSteering.ts`, `run/loopStore.ts`,
`run/loopSettle.ts` (the adapter tail), `run/runPrepared.ts`.
