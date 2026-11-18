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
    file: 'api/src/application/runtime/cloudAdapter.sharedTask.test.ts',
    blob: 'af4f9ea349fcacd0efb94f8433ccb1e1c6c6ca13',
    changed: "The host fixture's `verifyPin: undefined` becomes `reviewPin: undefined`; every expectation is unchanged.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): code review is its own `review` role, so the cloud host's review pin is named for it. A rename only.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/hostModelStream.test.ts',
    blob: '726564e0efe4e55e697db66e87f95ba7ad5f2ae0',
    changed: "Ten account mocks change from `async () => [kimi]` to `async () => ({ accounts: [kimi] })`; the import gains `ByoOrderQuery`; cases are added for lead/trail placement, free-first and the Hybrid Auto account-first order. Every original routing outcome is asserted as before.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): the accounts port now returns the server-ordered `{ accounts, freeFirst }` so a host-called account takes its place in the tenant's order instead of always leading.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/model/model.test.ts',
    blob: 'a790f6155aa942a9097945ce2b832ecc5812654d',
    changed: "`policyRole(\"verify\")` now expects `{ startPhase: \"verify\", fixedRole: \"verify\" }`; `review` cases are added.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): verify-phase review turns are sent as `review` (strongest models), so a delegated build-and-test `verify` child pins `fixedRole: 'verify'` to stay on the cheapest model.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/run/brainCloseOut.test.ts',
    blob: 'b6d6df92d116604a91c4ae1ccb7b01cc39448a69',
    changed: "Four expectations: a close-out over a self-review now finishes with reviewRecorded false (was true) and records no review, while the ticket still moves to done.",
    reason: "Intended change (5e1c0144c, chat #230): the ship close-out records a review only when an approved INDEPENDENT review of the shipped diff exists; a self-review the review gate refuses is no longer recorded as one. The old assertions pinned that bug.",
    approvedBy: APPROVED_BY,
  },
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
  {
    file: 'brain-embedded/src/run/areaR/menu.test.ts',
    blob: '8e189ba2a71edda213462f1dadf82a53e7575b6a',
    changed: "'once planning closes…' expects the code-turn menu (edit_file, ask_user and the three router tools) instead of the 64-tool menu minus hand_off; 'a catalog the limit holds whole…' builds a 20+2 tool fixture (was 62+2). Its assertions are unchanged.",
    reason: "Stale premise since cda0c33e9: the turn after planning closes is a CODE turn, capped by roleCap.ts (22 tools, no catalog-order backfill), so a 64-tool menu can no longer appear there. The fixture shrinks so that 'a catalog the limit holds whole is never trimmed' still holds under the code cap.",
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
  ...[
    'brain-embedded/src/handOffExecution.e2e.test.ts',
    'brain-embedded/src/run/turnRecordParity.test.ts',
    'brain-embedded/src/runStore/forcedBriefTail.test.ts',
    'brain-embedded/src/run/parity/scenarios/review.ts',
    'brain-embedded/src/run/parity/scenarios/tools.ts',
    'brain-embedded/src/run/parity/scenarios/turn.ts',
  ].map((file) => ({
    file,
    changed: "A read-only change run's forced hand-off/change turn is expected at 2 x READ_ONLY_STREAK_TURNS (12, the read-only streak's escalation, loop.progress_forced) instead of PLAN_TURN_BUDGET (20, loop.hand_off_due); scenario loopShows name loop.progress_forced; the routing line credits the progress guard.",
    reason: "Operator decision 2026-11-18: the read-only streak (c606ed6ad; made the spec by handOffForcedClash.e2e in 8a1b89420) wins over the 20-turn analysis budget, and the per-turn read ledger rides every tool turn. The 28 affected parity snapshots were regenerated through the authorized REGENERATE.md path the same day.",
    approvedBy: APPROVED_BY,
  })),
  {
    file: 'brain-embedded/src/brainRunStore.test.ts',
    changed: "One expectation: the hand-off test's `builtin_chats_link_ticket` call count is 0 (was 2). And in 'hands overlapping tasks to the coder in order instead of fanning them out' the scripted planner calls `hand_off` on turns 1 AND 2 (was turn 1 only) and the result is read from the LAST tool message (was the first); its three assertions are unchanged.",
    reason: "Intended change (chat-link-on-create): a created work item is linked to its chat BY the create call — the run stamps its server chat onto the create, the server links it — so no separate link call follows a create. The stamped chat is asserted in runStore/createChatStamp.test.ts. Intended change (run #70776, 19c8131bd): the first overlapping hand_off is sent back once naming the clash so the planner can narrow its paths; handed off again unchanged, it runs inline in plan order exactly as the test asserts. The send-back is asserted in handOffClash.e2e.test.ts.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/ticketToolVocabulary.test.ts',
    changed: "The 'reads an account id from a number or its decimal text, and nothing else' case (serverTicketId) and its import are removed.",
    reason: 'serverTicketId absorbed by parseSyncId/entityIdsOf — typed-entity-ids §5; the parse is covered by entityId.test.ts',
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'brain-embedded/src/run/parity/snapshots.ts',
    changed: "writingSnapshots() is true only when PARITY_SNAPSHOT=write AND an authorized REGENERATE.md (date + 'authorized') sits beside the snapshots (was the env var alone); a gated writeSnapshot() is added.",
    reason: "Intended change (cb7d0f2be, PRD 45 deterministic run gates): regeneration became a deliberate operator action. The edited line TIGHTENS the gate (env var alone no longer arms it), so 'refuses to write a snapshot' in snapshot.test.ts still holds in CI, where no REGENERATE.md exists (none is checked in).",
    approvedBy: APPROVED_BY,
  },
  ...['chat-mode-tools', 'stop-during-fold'].map((id) => ({
    file: `brain-embedded/src/run/parity/snapshots/${id}.json`,
    changed: "Additive only, plus JSON key order: the 'Batch independent reads/searches into ONE turn' operating-contract bullet, a between-turns / context-fold activity status, and the run-outcome row in agentOnly.recorded (was empty).",
    reason: "Intended change (cb7d0f2be, PRD 45 deterministic run gates): the operator regenerated every parity record behind the REGENERATE.md gate. These two hold no work-linking step, so the chat-link reconciliation below never touched them and they carry only the PRD 45 regeneration.",
    approvedBy: APPROVED_BY,
  })),
  {
    file: 'packages/agent-loop/src/chatTicketHealth.test.ts',
    changed: "Three rollupChatTicketHealth toEqual expectations gain openTickets/completedTickets (3 done + 1 cancelled -> 0/3; all-cancelled -> 0/0; in_progress + canceled -> 1/0); pct/done/total are unchanged. Four cases are added.",
    reason: "Intended change (0b42a0c29, open/completed ticket counts on every chat summary): ChatTicketHealth's shape extended with two ticket counts; every original pct/done/total value is asserted exactly as before.",
    approvedBy: APPROVED_BY,
  },
  // The parity snapshots reconciled with the same intended change by
  // brain-embedded/scripts/apply-intended-snapshot-change-chat-link.mjs (its header names the three edits). In this range they ALSO
  // carry cb7d0f2be's operator regeneration to PRD 45 behaviour (see the chat-mode-tools / stop-during-fold entries above).
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
