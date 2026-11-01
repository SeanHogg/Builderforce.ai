# WS4 parity baseline (PRD 35 section 4, WS4)

Written from real output, 2026-10-31, after P1 round two, P2 round four and WS7's outcome row. It replaces the hand-kept burn-down list that
used to live here; that list was stale. Nothing in this file is edited by hand when a number changes: re-run the commands below.

## The three proofs

1. **The oracle.** The test files that drive `startRun` (`parity/oracle.files.txt`, kept complete by `parity/oracle.test.ts`) run UNCHANGED on
   both engines. `BRAIN_RUN_ENGINE` selects the engine. CI runs both (`release.yml`: `oracle (brain-embedded, loop|agent)`,
   `oracle (clients/chrome, loop and agent)`, and the VS Code file on the agent in `verify-extension`).
   `node brain-embedded/src/run/parity/runOracle.mjs <brain-embedded|clients/chrome|clients/vscode> <loop|agent>`.
2. **The differential suite** (`parity/parity.test.ts`, 75 tests). 74 scripted scenarios, each through the real `startRun` once per engine on the
   production binding (`driveRun` -> `runPrepared` or `runLoop`), with the model stream, the host's persistence and its tool port as the only
   fakes. Everything an observer saw is recorded (every wire request, every persisted row, the trace, usage, the cell, the outcome rows, the
   host's frames, the error shown) and must be equal once ids and timestamps are normalised. Result: **75 of 75 pass.**
3. **The stored record** (`parity/snapshot.test.ts`, 148 tests; `parity/snapshots/*.json`). The loop's record of each scenario, generated from the loop
   engine only (`PARITY_SNAPSHOT=write`). Once `runLoop.ts` is deleted this is what the agent is held to (remove `'loop'` from
   `parity/engines.ts`). Result: **148 of 148 pass** (every scenario on both engines).

## What the harness does not treat as a difference

Everything is named in `parity/normalise.ts`; nothing else is excused.

- run ids (`guestTurnId` uuid, the `clientRunId` clock suffix), wall-clock instants and measured durations;
- the wire's own defaults, so a request is compared as the gateway body `streamChatCompletion.ts` builds from it (`modelStrict: false` or true
  with no model, `maxTokens` absent against 4096, `reasoning: off`, an empty tool list, `tool_choice` absent beside tools);
- the agent's 17 optional section 8.2 telemetry fields on a graded run's outcome row (approved). Every field the loop also sends is compared;
- `agentOnly.recorded` (the agent's `reportRunRecord`, a record for a run with no grade): not compared with the loop, asserted at most once per run.

## Oracle table (each file alone, passing tests per engine)

| File | loop | agent |
|---|---|---|
| brain-embedded/src/brainRunStore.test.ts | 65 | 65 |
| brain-embedded/src/browserEngine.test.ts | 14 | 14 |
| brain-embedded/src/chatDelivery.test.ts | 14 | 14 |
| brain-embedded/src/config.test.tsx | 2 | 2 |
| brain-embedded/src/handOffExecution.e2e.test.ts | 6 | 6 |
| brain-embedded/src/hostModelStream.test.ts | 30 | 30 |
| brain-embedded/src/localFirstTransport.test.ts | 19 | 19 |
| brain-embedded/src/readCoverageServed.test.ts | 3 | 3 |
| brain-embedded/src/run/conformance.test.ts | 4 | 4 |
| brain-embedded/src/run/webAdapter.test.ts | 10 | 10 |
| brain-embedded/src/runDriver.test.ts | 2 | 2 |
| brain-embedded/src/runOutcomeCost.test.ts | 6 | 6 |
| brain-embedded/src/runStore/continueChat.test.ts | 17 | 17 |
| brain-embedded/src/runStore/continueClaim.test.ts | 15 | 15 |
| brain-embedded/src/runStore/continueStop.test.ts | 9 | 9 |
| brain-embedded/src/runStore/earlyDelegation.child.test.ts | 3 | 3 |
| brain-embedded/src/runStore/earlyDelegation.test.ts | 4 | 4 |
| brain-embedded/src/runStore/engineRun.test.ts | 8 | 8 |
| brain-embedded/src/runStore/engineRunRow.test.ts | 1 | 1 |
| brain-embedded/src/runStore/forcedBriefTail.test.ts | 2 | 2 |
| brain-embedded/src/runStore/hostRunContext.test.ts | 3 | 3 |
| brain-embedded/src/runStore/modelPreflightPlan.test.ts | 4 | 4 |
| brain-embedded/src/runStore/modelSignals.test.ts | 7 | 7 |
| brain-embedded/src/runStore/progressGuard.test.ts | 10 | 10 |
| brain-embedded/src/runStore/serverChat.test.ts | 3 | 3 |
| brain-embedded/src/runStore/startRun.lateBackstop.test.ts | 2 | 2 |
| brain-embedded/src/runStore/startRun.settle.test.ts | 1 | 1 |
| brain-embedded/src/useBrainConversation.test.tsx | 41 | 41 |
| brain-embedded/src/useChatTurns.draft.test.tsx | 18 | 18 |
| brain-embedded/src/useChatTurns.draftStop.test.tsx | 9 | 9 |
| brain-embedded/src/useChatTurns.stopEpoch.test.tsx | 2 | 2 |
| brain-embedded/src/useChatTurns.test.tsx | 51 | 51 |
| brain-embedded/src/useChatTurns.waiting.test.tsx | 12 | 12 |
| brain-embedded/src/useContinuation.test.tsx | 2 | 2 |
| clients/chrome/src/host/rovrRunHost.test.ts | 3 | 3 |
| clients/chrome/src/host/rovrRunHost.entryPoint.test.ts | 1 | 1 |
| clients/vscode/src/brainRunHost.entryPoint.test.ts | 1 | 1 |
| clients/vscode/src/nativeBrainRun.setup.test.ts | 5 | 5 |

Total 409 tests on the loop and 409 on the agent, no failures, no skips.

## Reading a failure

`parity.test.ts` prints the differing paths (`$.wire[2].maxTokens: loop=16384 agent=4096`). `PARITY_DUMP=<dir>` writes both full records of every
scenario. A scenario also names, in `loopShows`, the trace labels the LOOP must show: a scenario that never reaches the behaviour it is named for
fails there, so equality is never vacuous.

## The run row (ship gate, section 8.1)

`steps` is the Brain's own count of completed model turns on both engines (it is compared, not normalised). A graded run reports once through
`reportOutcome`; a run with no grade is recorded once through `reportRunRecord` on the agent and not at all on the loop.
