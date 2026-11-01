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
    file: 'packages/agent-run/test/learnedFacts.test.ts',
    changed: 'The readChangedExcerpt case is not carried.',
    reason: 'It reads the workspace with node fs and git; the package may not import node:*. It keeps running unchanged in clients/vscode/src/memoryCommit.test.ts.',
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
    changed: 'The approved answer expectation now carries approved: true.',
    reason: 'Required by parity ruling R10.',
    approvedBy: APPROVED_BY,
  },
];
