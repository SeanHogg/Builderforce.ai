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

/**
 * Approvals that OUTLIVE the ship gate: each is bound to `blob`, the git blob hash of the file's content as it was approved. The guard
 * fails when the file's current blob differs, so the next editor must re-approve (a new blob, a new reason) instead of riding an old
 * exemption. Compute it with `git hash-object <file>`.
 * @type {{ file: string; blob: string; changed: string; reason: string; approvedBy: string; cases?: number }[]}
 */
export const APPROVED_PERMANENT = [
  {
    file: 'packages/agent-run/test/learnedFacts.test.ts',
    blob: 'b76814c49245835147a6bef295b59ad3407f7410',
    changed: "The readChangedExcerpt case is not carried.",
    reason: "It reads the workspace with node fs and git; the package may not import node:*. The case runs unchanged in clients/vscode/src/changedExcerpt.test.ts (the editor, readChangedExcerpt).",
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'packages/agent-run/test/verify/runEndMemory.test.ts',
    blob: 'ffad21b7d8a0b963ec876ab3acc76927f091a5ce',
    changed: "The three run-end tail cases run over timeline and store.commitMemory port fakes instead of a stub Drizzle db; the seven pure cases are import-only.",
    reason: "The cloud keeps the three original tail cases unchanged in api/.../runEndMemory.test.ts; these are additional port-level variants.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/steering/steering.test.ts',
    blob: '8267bc48268c0712c6a056d3b72793f332438c06',
    changed: "drainRunSteering(7) expects [{ text: \"write the update now\", attachments: undefined }] where the Brain test expected [\"write the update now\"].",
    reason: "The steer row carries attachments in the one home, so the shape extended.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/guards/loopGuards.test.ts',
    blob: 'b94c3122922927c62e86b2c2bfa8ffa5c5d5a2a4',
    changed: "vi.hoisted telemetry, difficulty-gate and env-lever mocks replaced by GuardPorts and GuardLevers. All 12 source cases have a counterpart (one is split: its levers-off pass-through case is guards/leversOffPassThrough.test.ts); one case is new.",
    reason: "The engine read levers from env strings and wrote telemetry through module imports; the policy takes them as ports.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/finish/finish.test.ts',
    blob: '3ce1c6b9dff39b18e2e7e7dd7d1a4ab9378c013a',
    changed: "Two expectation lines: enterVerify toHaveBeenCalled became a counter > 0; the record-mock calls became a reasons list. The six evaluateFinishGates cases run over FinishGatePorts; the cloud file carries five cloudFinishPorts cases.",
    reason: "evaluateFinishGates over module mocks no longer exists in the cloud; the gates take ports.",
    approvedBy: APPROVED_BY,
  },
];

/**
 * Approvals that matter only while a push's range still spans the change they cover. They carry no `blob`. EMPTY: the PRD 35 ship-gate
 * approvals were removed once the push that shipped them (b62218a90) was green. Add an entry here only for a change inside the push that
 * makes it, and empty the array again when that push is green; an approval that must outlive its push belongs in `APPROVED_PERMANENT`
 * with a `blob`.
 * @type {{ file: string; changed: string; reason: string; approvedBy: string; cases?: number }[]}
 */
export const APPROVED_THIS_PUSH = [
  {
    file: "brain-embedded/src/run/parity/snapshots/ask-user-malformed.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/ask-user-terminal.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/big-read-paged.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/budget-warn-stop.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/chat-mode-tools.json",
    changed: "The ask_user tool spec gained the recommended option and its description sentence; the prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/child-report-exhausted-stall.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/child-report-ship-gate.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/child-report-turn-end.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/confirm-approved.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/confirm-declined.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/effort-balanced-thinking.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/effort-quick.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/effort-thorough-thinking.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/flash-pinned.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/focus-files-once.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/fold-in-tool-loop.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/hand-off-execution.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/handed-off-commands.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/image-attachment.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/image-with-context.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/ledger-in-tail.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/malformed-call-args.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/mcp-tool.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/memory-savings.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/model-breaks-mid-answer.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/pinned-model-breaks.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/planner-ignores-forced-turn.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/preflight-once.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/quick-on-flash.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/quick-route.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/read-dedupe.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/reask-discarded.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/reask-fails.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/reask-transport-failure.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/reasoning-next-action.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/reasoning-replay.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/restated-reply.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/retry-forced-turn.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/routed-tool-pin.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/ship-gate.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/six-failures-one-turn.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/small-window-tools.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/stall-exhaustion.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/stall-failover.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/steer-a-child.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/steer-before-command.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/steer-during-tool.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/steer-final-answer.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/steer-stop-word.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/step-numbering.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/stop-during-hand-off.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/stop-hook.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/sub-agent-spawn.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/thorough-route.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/tool-failure-breaker.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/tools-without-runner.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/two-steers-turn-end.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/undelegated-request.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/unknown-tool.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/wait-interrupted.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
  {
    file: "brain-embedded/src/run/parity/snapshots/work-mode-tools.json",
    changed: "The prose-answered turns gained their answeredInProse stamps.",
    reason: "Two intended changes landed after the loop froze — the ask_user recommended option (PR 6421) and answeredInProse stamping on turns handed tools that answered in prose (67f461953) — so the stored records no longer matched the agent, and a snapshot re-recorded from the agent would prove nothing about it. The intended change was applied onto the stored records by brain-embedded/scripts/apply-intended-snapshot-change.mjs; the parity suite passes 78/78 with zero diffs. Covers commit cf00098bb.",
    approvedBy: APPROVED_BY,
  },
];

export const APPROVED = [...APPROVED_PERMANENT, ...APPROVED_THIS_PUSH];
