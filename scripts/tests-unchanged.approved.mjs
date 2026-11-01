/**
 * The test changes PRD 35 §5.1 lets stand, as DATA for `check:tests-unchanged`.
 *
 * §5.1: a test on this program may change only an import line or a `vi.mock` path. Anything else needs the planning model, and
 * each approval is one entry here: the file, what changed, why, and who approved it. The guard passes on a change that is import-only
 * or listed here, and fails on anything else. A new entry is the planning model's decision, never the implementer's.
 *
 * `cases` on an entry is the number of cases the file may LOSE against its original (an approved drop); omitted means none.
 */

/** The commit before the program's first (WS1). Originals of brought-along tests are read from here. */
export const PROGRAM_BASE = '468d080d2~1';

export const APPROVED_BY = 'planning model';

/** @type {{ file: string; changed: string; reason: string; approvedBy: string; cases?: number }[]} */
export const APPROVED = [
  {
    file: 'api/src/application/marketing/campaignEngine.test.ts',
    changed: 'Statement-queue fixtures follow the per-batch do-not-contact read, the write-back returning its row and the ledger-counted finish; a provider rejection is an EmailDeliveryError.',
    reason: 'Campaign delivery work, not this program: the behaviour changed on purpose, the assertions on what each test proves stand, and the review read the edits.',
    approvedBy: APPROVED_BY,
  },
  // ── brought-along pairs (new home <- original source test) ──
  {
    file: 'packages/agent-run/test/finish/finish.test.ts',
    changed: 'Two expectation lines: enterVerify toHaveBeenCalled became a counter > 0; the record-mock calls became a reasons list. The six evaluateFinishGates cases run over FinishGatePorts; the cloud file carries five cloudFinishPorts cases.',
    reason: 'evaluateFinishGates over module mocks no longer exists in the cloud; the gates take ports.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/verify/runEndMemory.test.ts',
    changed: 'The three run-end tail cases run over timeline and store.commitMemory port fakes instead of a stub Drizzle db; the seven pure cases are import-only.',
    reason: 'The cloud keeps the three original tail cases unchanged in api/.../runEndMemory.test.ts; these are additional port-level variants.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'clients/vscode/src/memoryCommit.test.ts',
    changed: 'Deleted. Its readChangedExcerpt case moved, unchanged, to clients/vscode/src/changedExcerpt.test.ts; its other 13 cases are packages/agent-run/test/learnedFacts.test.ts, unchanged.',
    reason: "PRD 35 WS7: memoryCommit.ts (the editor's twin of policy/memory/{learnedFacts,runKnowledgeCommit}.ts) is deleted; the editor imports the agent's module. Every one of the 13 cases runs unchanged against the one copy in packages/agent-run (the two files differ only in imports and in the readChangedExcerpt describe), and the one host-specific case lives with the workspace reader it tests.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/parity/oracle.files.txt',
    changed: 'The line for brain-embedded/src/run/areaR/human.test.ts is removed.',
    reason: "PRD 35 WS7: that test is deleted (approved above): both cases drove approvalGates through the human channel's approve, which the Brain never binds (ruling R10), so the code and the test are dead. oracle.test.ts requires every listed file to exist.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/test/brainRunHarness.ts',
    changed: "The harness builds the binding with a minimal real turn observer (plainTurn) instead of none, no longer sets the removed BrainRunBinding.cell/runKey, and runBound takes the whole bound run so it can run the production preflight seam.",
    reason: "PRD 35 WS7: BrainRunBinding.turn is now required (the transport's no-session branches served only tests), and cell/runKey/approvalGates left the binding as dead. The harness is a fixture, not a case: no test input or expected value changes.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/learnedFacts.test.ts',
    changed: 'The readChangedExcerpt case is not carried.',
    reason: 'It reads the workspace with node fs and git; the package may not import node:*. The case runs unchanged in clients/vscode/src/changedExcerpt.test.ts (the editor, readChangedExcerpt).',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'packages/agent-run/test/guards/loopGuards.test.ts',
    changed: 'vi.hoisted telemetry, difficulty-gate and env-lever mocks replaced by GuardPorts and GuardLevers. All 12 source cases have a counterpart (one is split: its levers-off pass-through case is guards/leversOffPassThrough.test.ts); one case is new.',
    reason: 'The engine read levers from env strings and wrote telemetry through module imports; the policy takes them as ports.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/guards/cascade.test.ts',
    changed: 'Env-string levers become the constructor flag; the difficulty-gate module becomes CascadePorts.',
    reason: 'Same as loopGuards: mocks replaced by ports.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/guards/postEdit.test.ts',
    changed: 'The repo-read mock becomes the guards read port.',
    reason: 'Same as loopGuards: mocks replaced by ports.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/compaction/compactMessages.test.ts',
    changed: 'compactionBudget is bound to a stub ModelTransport.window port; inputs and expected values unchanged.',
    reason: 'The source read the window from the API vendor catalog.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/compaction/pack.test.ts',
    changed: 'The 1,024-floor assertions are not carried (resolveCompactReserveTokensFloor); the ensure case keeps its inputs and values.',
    reason: 'The source floor is 20,000, read from config; test/compaction/reserveFloor.test.ts holds it unchanged.',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  // ── approved edits to existing tests ──
  {
    file: 'agent-runtime/src/builderforce/agent-loop/handoff-pack.test.ts',
    changed: 'packContextForModel calls and compactionSummary expectations (lines 57-116).',
    reason: 'The stall hand-off moved into the agent; the test runs through its public seam.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'agent-runtime/src/builderforce/agent-loop/handoff-pack.levers.test.ts',
    changed: 'Retargeted with handoff-pack.test.ts.',
    reason: 'Same as handoff-pack.test.ts.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'agent-runtime/src/run/channelHardening.test.ts',
    changed: 'Hand-off tests run over the real channel row shape; the tripped-breaker test reads the notice.',
    reason: 'Channel runs moved onto the agent (WS5 hardening).',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/channels/surfaceControls.test.ts',
    changed: 'Surface-control cases for the channel adapter.',
    reason: 'Channel runs moved onto the agent (WS5).',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/runtime/containerSandboxJobs.test.ts',
    changed: 'The foreground-cwd case renamed to "runs at the clone root" and its cwd lines dropped (587fcbdb4).',
    reason: 'RunSandbox.run / /sandbox/run cwd retired (WS2f item 10).',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/runtime/sandbox/sandboxJobs.test.ts',
    changed: 'The foreground-cwd case dropped (587fcbdb4).',
    reason: 'RunSandbox.run / /sandbox/run cwd retired (WS2f item 10).',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'api/src/application/runtime/sandbox/sandboxJobsToolLayer.test.ts',
    changed: 'The foreground-cwd lines dropped (587fcbdb4).',
    reason: 'RunSandbox.run / /sandbox/run cwd retired (WS2f item 10).',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/infrastructure/repositories/ExecutionRepository.persistence.test.ts',
    changed: 'update() is read to its own .returning(), not to the end of the file; completedAt leaves the update-set field list and is pinned in land().',
    reason: 'update() no longer writes completedAt (a terminal status is refused by update()); the old end anchor no longer existed.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/run-guards/src/readsWithoutSpawn.test.ts',
    changed: 'Sixth read became the fourth read (the default delegation threshold is 4).',
    reason: 'PRD 35 §8.4 budget: first spawn by turn 5 for a serial reader.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/runStore/earlyDelegation.test.ts',
    changed: 'The nudge rides the fourth read, not the sixth.',
    reason: 'PRD 35 §8.4 budget: first spawn by turn 5 for a serial reader.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'agent-runtime/src/run/channelOutcome.test.ts',
    changed: 'The reported model is the bare id (m), not <provider>/<id> (p/m).',
    reason: 'Telemetry groups one model once: every other entry point reports the bare id.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/steering/steering.test.ts',
    changed: 'drainRunSteering(7) expects [{ text: "write the update now", attachments: undefined }] where the Brain test expected ["write the update now"].',
    reason: 'The steer row carries attachments in the one home, so the shape extended.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/zzdbg.test.ts',
    changed: 'Deleted.',
    reason: 'A scratch debug file, never a behaviour test.',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'agent-runtime/src/agents/embedded-runner/run.policy-gates.test.ts',
    changed: 'Host-policy-gates mock and own-gates cases for the channel governance work.',
    reason: 'New-behaviour tests from the governance gate work on this program, reviewed.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'agent-runtime/src/infra/host-policy-gates.channel.test.ts',
    changed: 'Model fixture and gate cases for the channel governance work.',
    reason: 'New-behaviour tests from the governance gate work on this program, reviewed.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/webAdapter.test.ts',
    changed: 'The approved answer expectation now carries approved: true. runViaAgent became the test harness\'s runBound (same runAgent call over the same ports), and the run-store case is gone with cellRunStore. Then: runBound takes the bound run (its cell is no longer on the binding) and drives the production preflight module; every transport is built over a turn observer (plainTurn); the window case drops its `ports.model.preflight` assertion; the human-channel case keeps its `ask` assertion and drops the `approve` ones.',
    reason: 'Required by parity ruling R10. The cellRunStore case tested a store only the deleted second path used; the live store is brainRunStorePort (run/brainStore.ts), held by the parity snapshots. The Brain\'s production transport always has a turn observer (brainTurn.ts) and never reaches `ports.model.preflight` (run/preflightRecorded.ts replaces it), nor a governance approval (R10 keeps gates unbound), so those assertions proved only dead paths; the live preflight is pinned by the trace case (the preamble\'s check plus the recorded module) and by conformance.test.ts.',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'brain-embedded/src/run/parity/parity.test.ts',
    changed: 'Deleted.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The differential suite compared the loop with the agent; with one engine it has nothing to compare. The snapshot suite (snapshot.test.ts) keeps the loop's stored record as the oracle, one case per scenario.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/runStore/engineRunRow.test.ts',
    changed: 'Deleted.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. It ran a two-turn run on both engines to compare their `steps` rows; the one row per run is held by the agentRunReport and parity snapshots.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'clients/vscode/src/run/vscodeAdapter.test.ts',
    changed: 'Deleted.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. vscodeBinding was called by nothing (the editor's run goes through startRun); the test exercised only it.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/turnParity.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/turnRecordParity.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/turnWireParity.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/foldParity.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/areaR/calls.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/areaR/menu.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/areaR/stall.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/areaR/steer.test.ts',
    changed: 'bothEngines became a single run; agent-equals-loop equalities removed, pinned values kept on the agent run; some equality-only quantities became concrete expectations. One it() TITLE: "as a failed step" became "as a step that is not an error" (the case asserts isError: false); no input or assertion changed.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The test ran one scripted run on the loop and on the agent; it now runs it on the agent. Every concrete value the loop was pinned to stays on the agent run; each removed assertion was an agent-equals-loop equality and is held by a parity snapshot or a stated concrete expectation (see the hand-off note).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/areaR/human.test.ts',
    changed: 'Deleted.',
    reason: "Both cases drove `RunPolicy.approvalGates` through `HumanChannel.approve` and the confirm card. Parity ruling R10 keeps governance gates UNBOUND on the Brain (its request carries none, `brainRunPolicy` sends `approvalGates: []`), so `startRun` never reaches that path; the test could only prove dead code, which is deleted (`approve`, `confirmRequestFor`, `BrainRunBinding.approvalGates`). The confirm card a TOOL raises is `callPreflight.ts` and is held by prefetchGate.confirm.test.ts and the parity tools scenarios.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/conformance.test.ts',
    changed: 'The drive helper hands runAgent the production model module (preflightedModules: the preamble\'s host check, then the recorded preflight) and names the entry-point type RunEntryPoint (an import). No input, fixture, expected value or case count changed.',
    reason: "The model preflight case asserted the agent's own preflight, which asked `ports.model.preflight`; production replaces that with the recorded module (run/preflightRecorded.ts, parity ruling T10), so the case now drives the seam production runs and still expects the same events.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/runStore/agentRunReport.test.ts',
    changed: 'The loop-engine case ("a run with no coder grade reports nothing") is deleted; the graded-run case runs once and pins the report\'s source, entry point and run id instead of comparing it with the loop\'s.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The deleted case asserted the loop's behaviour (no report), which is false of the one engine.",
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'brain-embedded/src/runStore/runSpendBudget.test.ts',
    changed: "The cases drove the loop's spend hooks; they now drive the agent's budget (usdBudget) over the Brain's tree meter (brainSpendMeter), the device's one price rule and the Brain's event sink. The wording cases import budgetWarning/budgetContainedReply from the agent (the unpriced count is a number, not an object). The convo/persistence side effects of the hooks are the agent's (kernelHooks) and held by the budget-warn-stop snapshot; persistBudgetStop is asserted directly. The run-state tag case is dropped (the agent builds the tail in kernelHooks; the snapshot pins the tagged row).",
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The hooks are deleted with runLoop; every price, tree and wording case is kept on the seams that carry it.",
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'brain-embedded/src/crossAdapterConformance.test.ts',
    changed: 'runScenario no longer takes an engine argument.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. Engine selection dropped; every assertion kept.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/referenceScenario.test.ts',
    changed: 'runScenario no longer takes an engine argument.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. Engine selection dropped; every assertion kept.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'clients/chrome/src/host/rovrRunHost.entryPoint.test.ts',
    changed: "startRun no longer takes `engine: 'agent'`.",
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. Engine selection dropped; every assertion kept.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/parity/snapshot.test.ts',
    changed: 'Each scenario runs on the agent only and is held to its stored record; the loop leg is gone; the loopShows guard reads the stored record; writing a snapshot is refused.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. The loop leg proved the snapshots current; the loop no longer exists. 148 cases became 76 (74 scenarios, the id check and the refusal).",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/parity/oracle.test.ts',
    changed: 'The list guard no longer exempts tests that choose their own engine.',
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. There is one engine, so every test that drives a run is in the list.",
    approvedBy: APPROVED_BY,
  },
  // ── support files of the Brain's loop-vs-agent comparison, reduced to the agent when the loop was deleted ──
  ...[
    ['brain-embedded/src/run/parity/diff.ts', 'The record diff is labelled snapshot/agent, not loop/agent; atMostOneReportPerRun no longer takes an engine.'],
    ['brain-embedded/src/run/parity/engines.ts', 'Deleted (the list of engines to run a scenario on).'],
    ['brain-embedded/src/run/parity/harness.ts', 'runScenario and its recorder no longer take or record an engine.'],
    ['brain-embedded/src/run/parity/oracle.files.txt', 'engineRunRow.test.ts leaves the list (deleted, its own approval); the tests that were exempt as choosing their own engine, and the new oracle files, join it.'],
    ['brain-embedded/src/run/parity/runOracle.mjs', 'The <loop|agent> argument and BRAIN_RUN_ENGINE are gone: one engine.'],
    ['brain-embedded/src/run/parity/snapshots.ts', 'writeSnapshot is deleted: a snapshot can only be read, because the loop that generated them no longer exists.'],
    ['brain-embedded/src/run/parity/types.ts', 'RunRecord and Observed no longer carry an engine id.'],
    ['brain-embedded/src/test/brainRunHarness.ts', 'binding() builds the ports the Brain gives the agent (event sink, run store, steering) and runBound drives them; the reportOutcome hook it replaced was the loop-only seam.'],
    ['brain-embedded/src/test/engineKit.ts', 'runOn no longer takes an engine and bothEngines is gone; Scenario no longer omits an engine field.'],
  ].map(([file, changed]) => ({
    file,
    changed,
    reason: "PRD 35 WS4 ship gate (operator order, 2026-10-31): the Brain's old loop (runLoop) and the engine switch are deleted. This file only existed to run or compare the two engines; it now serves the agent and the stored snapshots, and no scenario, input or expected value in it changed.",
    approvedBy: APPROVED_BY,
  })),
];
