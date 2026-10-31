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

## Agent engine (`BRAIN_RUN_ENGINE=agent`): 142 passed, 30 failed, 1 pending of 173

Run on commit ebbb5ae19. Six files carry every failure; 14 files are fully green (runDriver, runOutcomeCost, continueChat,
continueClaim, continueStop, hostRunContext, modelPreflightPlan, modelSignals, serverChat, startRun.lateBackstop,
startRun.settle, useChatTurns.draftStop, useContinuation, and earlyDelegation.child bar its pending case).

| File | pass / fail |
|---|---|
| brainRunStore.test.ts | 48 / 17 |
| handOffExecution.e2e.test.ts | 1 / 5 |
| readCoverageServed.test.ts | 1 / 2 |
| runStore/earlyDelegation.test.ts | 3 / 1 |
| runStore/forcedBriefTail.test.ts | 1 / 1 |
| runStore/progressGuard.test.ts | 6 / 4 |
| runStore/earlyDelegation.child.test.ts | 2 / 0, 1 pending (passes without a skip marker on `loop`; find why it is pending here) |

### The gaps, by the row that closes them

| Row | Failing tests |
|---|---|
| Final-answer gates as `DeliveryLedger` rungs (ship, review, delegation recovery, restate, stop hook, commands-handed-back) | brainRunStore: "local run is its own reviewer", "hands the user the commands it holds the tools for", "explicit sub-agent request ... answers with the delegation contract", "... re-prompts a prose ending once" |
| Terminal `ask_user` (`ToolExtension.terminalTurn`) | brainRunStore: "settles the run on the question", "still settles on the question when the user did not ask for sub-agents" |
| Narration kept as its own block | brainRunStore: "tags the block a turn says before its tool calls" |
| Forced turns and progress budgets (`turnMenu`: plan budget, change budget, no-progress, A3) | handOffExecution.e2e x5 (budget, ignored forced turn, chat that coded before, read-only coding run, sub-agent starts in `code`), forcedBriefTail ("expected -1 to be 20": the forced tail brief), progressGuard x4 (WS8p unkept readiness claim: steer, escalate, pause) |
| Stop on tool-failure breaker, forced tools-free answer | brainRunStore: "no tool-call limit" x3 (the run ends after 8 turns instead of 60, and the forced answer does not name the failures) |
| Coder re-ask on the first edit of an analysis turn | brainRunStore: "plans on the tenant order, and re-asks the first code change of the coding model" (needs the policy's `codeChangeTools` data and the model-policy role from the platform's hand-off) |
| Provider failure, retry and failover (`policy/model`, `fallbackSurface`) | brainRunStore: "Grok starts and then stops" x2, "retries a turn the gateway answered 429" |
| Window fit for a small cloud model | brainRunStore: "packs the transcript for a cloud model the gateway catalog says is small" |
| Read paging, replay from the read cache, served-window coverage | brainRunStore: "pages a big read_file by LINE", "re-serves an exact re-read ... once compaction has removed its result"; readCoverageServed x2 (the post-step needs the result row the transcript carries; the agent's row is a different identity from the cell's) |
| Early delegation nudge rides the sixth read | earlyDelegation: "rides the sixth read" (the advisory is lost between `dispatchToolPort` and the agent's tool row) |

## Done in this pass (commit ebbb5ae19)

Seam and switch in `startRun` (`runStore/runEngine.ts`), `engine` on `BrainRunRequest`, the device reader shared by web and
Rovr (`runStore/runEnginePreference.ts`), the VS Code setting `builderforce.agent.engine`; one live-turn view
(`runStore/turnStream.ts`) and one turn recorder (`runStore/turnRecorder.ts`) shared by `completeTurn.ts` and the agent's
model port (`run/modelTransport.ts` + `run/loopTurn.ts`); `run/brainPlatformTools.ts` (closed `PlatformTools` that calls the
loop's own `beforeDispatchHook`, `dispatchToolPort` and `afterDispatchHook`), `run/loopSteering.ts`, `run/loopStore.ts`,
`run/loopSettle.ts` (the adapter tail), `run/runPrepared.ts`.
