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
  {
    file: 'brain-embedded/src/browserEngine.test.ts',
    blob: 'f355d8ae9b4e3c57865a88e13af43ee45abb2426',
    changed: "The model label is 'Gemini Nano (Chrome)' (was 'Gemini Nano'); 'never offers a model that would have to download first' becomes 'reports a not-ready model as a downloadable/downloading row'; the fallback window and resolved model read builtInModelIdentity().",
    reason: "PRD 42 A1: the built-in browser model is named per vendor (Gemini Nano (Chrome) / Phi-4-mini (Edge)), and a downloadable or downloading model is reported as a state row instead of null (unavailable is still null). The old assertions describe the superseded behaviour.",
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
    file: 'brain-embedded/src/brainRunStore.test.ts',
    changed: "One expectation: the hand-off test's `builtin_chats_link_ticket` call count is 0 (was 2). And in 'hands overlapping tasks to the coder in order instead of fanning them out' the scripted planner calls `hand_off` on turns 1 AND 2 (was turn 1 only) and the result is read from the LAST tool message (was the first); its three assertions are unchanged.",
    reason: "Intended change (chat-link-on-create): a created work item is linked to its chat BY the create call — the run stamps its server chat onto the create, the server links it — so no separate link call follows a create. The stamped chat is asserted in runStore/createChatStamp.test.ts. Intended change (run #70776, 19c8131bd): the first overlapping hand_off is sent back once naming the clash so the planner can narrow its paths; handed off again unchanged, it runs inline in plan order exactly as the test asserts. The send-back is asserted in handOffClash.e2e.test.ts.",
    approvedBy: APPROVED_BY,
  },
  // The parity snapshots reconciled with the same intended change by
  // brain-embedded/scripts/apply-intended-snapshot-change-chat-link.mjs (its header names the three edits).
  ...[
    'ask-user-malformed', 'ask-user-terminal', 'big-read-paged', 'budget-warn-stop', 'child-own-transcript', 'child-report-exhausted-stall',
    'child-report-ship-gate', 'child-report-turn-end', 'confirm-approved', 'confirm-declined', 'effort-balanced-thinking', 'effort-quick',
    'effort-thorough-thinking', 'flash-pinned', 'focus-files-once', 'fold-in-tool-loop', 'fold-summary-fails', 'hand-off-execution',
    'handed-off-commands', 'image-attachment', 'image-with-context', 'ledger-in-tail', 'long-chat-folds', 'malformed-call-args', 'mcp-tool',
    'memory-savings', 'model-breaks-mid-answer', 'pinned-model-breaks', 'plain-chat', 'planner-ignores-forced-turn', 'preflight-once',
    'quick-on-flash', 'quick-route', 'read-dedupe', 'reask-discarded', 'reask-fails', 'reask-transport-failure', 'reasoning-next-action',
    'reasoning-replay', 'refusal-401', 'refusal-402-plan', 'refusal-402', 'refusal-429', 'reload-after-fold', 'restated-reply',
    'retry-forced-turn', 'routed-tool-pin', 'ship-gate', 'six-failures-one-turn', 'small-window-tools', 'stall-exhaustion', 'stall-failover',
    'steer-a-child', 'steer-before-command', 'steer-during-tool', 'steer-final-answer', 'steer-stop-word', 'step-numbering', 'stop-before-text',
    'stop-during-hand-off', 'stop-during-stream', 'stop-hook', 'sub-agent-spawn', 'thorough-route', 'tool-failure-breaker',
    'tools-without-runner', 'two-runs-one-fold', 'two-steers-turn-end', 'undelegated-request', 'unknown-tool', 'wait-interrupted', 'work-mode-tools',
  ].map((id) => ({
    file: `brain-embedded/src/run/parity/snapshots/${id}.json`,
    changed: 'The work-linking prompt bullet (and the fold token arithmetic it moves by 8), the removed auto `builtin_chats_link_ticket` step/call, and the run chat stamped on `builtin_tasks_create`.',
    reason: 'Intended change (chat-link-on-create): a created item links its chat in the create call, so the prompt no longer asks for a link step and the run fires none. Applied by brain-embedded/scripts/apply-intended-snapshot-change-chat-link.mjs, not regenerated from the agent.',
    approvedBy: APPROVED_BY,
  })),
];

export const APPROVED = [...APPROVED_PERMANENT, ...APPROVED_THIS_PUSH];
