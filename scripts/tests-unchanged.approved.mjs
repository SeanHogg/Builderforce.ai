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
    file: 'agent-runtime/src/agents/candidate-ranking.test.ts',
    blob: '9b955f3fde1d576bd1a4693080820b196bd84901',
    changed: "\"plan keeps the operator's order exactly\" becomes \"plan and review lead with the strongest tier\"; the balanced-order and learned-evidence cases move from `plan` to `chat`. Every other expectation is unchanged.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): MODEL_ROLE_OBJECTIVE makes plan and review strongest-first (+1); chat (0) is now the balanced role that keeps the operator's order. User-approved 2026-11-18.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'agent-runtime/src/agents/model-routing.test.ts',
    blob: 'e60e8e87b4cfaf1a9a15923d6b8749a3cc578443',
    changed: "\"a plan turn keeps the operator's lead\" now expects the strongest model; the keeps-the-lead case is kept under `chat`.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): plan is strongest-first; chat is the balanced role. User-approved 2026-11-18.",
    approvedBy: APPROVED_BY,
  },
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
    blob: 'dd0b5c60393809d25ca731135f88058075ce55ca',
    changed: "Four expectations: a close-out over a self-review now finishes with reviewRecorded false (was true) and records no review, while the ticket still moves to done. (chat #276) The fixture request's `tools` now lists builtin_chats_list_tickets; no assertion changed.",
    reason: "Intended change (5e1c0144c, chat #230): the ship close-out records a review only when an approved INDEPENDENT review of the shipped diff exists; a self-review the review gate refuses is no longer recorded as one. The old assertions pinned that bug. Intended change (chat #276, 2026-11-19): the ticket backstops read the chat's tickets only where the host's catalog carries the listing tool, so the fixture host must declare it.",
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
    blob: 'cb5c12807871f4804e093933e96cb8304074a55f',
    changed: "vi.hoisted telemetry, difficulty-gate and env-lever mocks replaced by GuardPorts and GuardLevers. All 12 source cases have a counterpart (one is split: its levers-off pass-through case is guards/leversOffPassThrough.test.ts); one case is new. (chat #276, 2026-11-19) One case appended — 'never escalates on a finish held for open linked work' — every existing line unchanged.",
    reason: "The engine read levers from env strings and wrote telemetry through module imports; the policy takes them as ports. Re-approved 2026-11-19 for an append-only case: a linked_work_open finish hold is owed work, not a failed verifier, so it must not escalate the model.",
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
/** The parity snapshots whose host call log apply-intended-snapshot-change-ticket-listing.mjs reconciled (see the last block). */
const TICKET_LISTING_RECONCILED = new Set(['ship-gate', 'child-report-ship-gate', 'hand-off-execution']);

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
    reason: 'serverTicketId absorbed by parseSyncId/entityIdsOf — platform.md typed entity ids §5; the parse is covered by entityId.test.ts',
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
    changed: "(0b42a0c29) Three rollupChatTicketHealth toEqual expectations gain openTickets/completedTickets (3 done + 1 cancelled -> 0/3; all-cancelled -> 0/0; in_progress + canceled -> 1/0). (chat #276) effectiveTicketProgress/closedLaneProgress lose their third (unsupportedDelivery) and fourth (whenClosed) arguments: the 'complete'/'passthrough' mode cases are folded into one closed-lane case; an open lane at raw 100 ('in_review', 100) now expects CLAIMED_COMPLETE_PROGRESS_CAP (was 100); a closed lane carrying a stale 75 ('done', 75) now expects 100 (was 75 under passthrough). Rollup fixtures pass the producer's output instead of the deleted flag. Regression cases added for chat #276.",
    reason: "Intended change (0b42a0c29): ChatTicketHealth gained two ticket counts, original pct/done/total kept. Intended change (chat #276, 2026-11-19): 'exact 100 is the only completion signal and only a CLOSED lane emits it' — an in_progress epic whose filed children were all done read 100% on the chat ring while the PRD was still open. A closed lane reads 100 on every surface (server = rail). unsupportedDelivery was fully subsumed by the open-lane cap and deleted; an independent Opus review confirmed the subsumption.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/brain/ceremonyTicketHealth.test.ts',
    changed: "The unsupported-delivery cases (execution/file-change fixtures for the deleted epicsWithUnsupportedDelivery query) become lane-based cases; 'does not cap a pre-close claim when the live run left no file rows' now expects the claimed-complete cap (was 100); 'stays at 0/5 … parent is done' now expects 100 (closed lane); the docs-only-epic (#6550) and 'coder run changed a non-doc file' cases are dropped — they only exercised the deleted query and are covered by the closed-lane / open-lane cases. Leaf and closed-epic regression cases added.",
    reason: "Intended change (chat #276, 2026-11-19): same rule as chatTicketHealth.test.ts; 'done' now means the lane is closed (completed_at alone no longer counts), so an epic's done/total agrees with its children's chips.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'brain-embedded/src/runStore/startRun.lateBackstop.test.ts',
    changed: "The codeRun fixture passes `tools` (builtin_chats_list_tickets) to startRun alongside runTool; every expectation is unchanged.",
    reason: "Intended change (chat #276, 2026-11-19): the ticket backstops read the chat's tickets only where the host's catalog carries the listing tool; the Stop-during-settle case depends on that listing call being made, so the fixture host must declare the tool.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/task/taskProgressBreakdown.test.ts',
    changed: "'can report delivered merged code as complete before the lane catches up' now expects CLAIMED_COMPLETE_PROGRESS_CAP (was 100). One regression case added (open epic whose subtasks are all closed).",
    reason: "Intended change (chat #276, 2026-11-19): the agent's own task tools (builtinMcpService loadTaskProgress / single-task read) must not report 100 for an open lane while the chat chip reads 75 — the model read 'complete' from its own tool. Every return of buildTaskProgressBreakdown now goes through effectiveTicketProgress.",
    approvedBy: APPROVED_BY,
  },
  // The parity snapshots reconciled with the same intended change by
  // brain-embedded/scripts/apply-intended-snapshot-change-chat-link.mjs (its header names the three edits). In this range they ALSO
  // carry cb7d0f2be's operator regeneration to PRD 45 behaviour (see the chat-mode-tools / stop-during-fold entries above).
  // The SAME 72 records also carry 47642b1d5's epic-parent directive bullet, inserted by
  // brain-embedded/scripts/apply-intended-snapshot-change-epic-parent.mjs — one block covers both, since the last entry per file wins.
  // Three of them (TICKET_LISTING_RECONCILED) also carry the host-call reconciliation of
  // brain-embedded/scripts/apply-intended-snapshot-change-ticket-listing.mjs.
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
    changed: 'The work-linking prompt bullet (and the fold token arithmetic it moves by 8), the removed auto `builtin_chats_link_ticket` step/call, and the run chat stamped on `builtin_tasks_create`. Plus (47642b1d5) the linked-chat EPIC-PARENT directive bullet ("When an open EPIC is linked to this chat… builtin_tickets_from_delta passing parentTaskId… file a child task with builtin_tasks_create (parentTaskId=…)") inserted after the STATUS bullet, and the fold token arithmetic it moves by 95 (estimatedTokens +95, non-zero trimmedTokens −95, the still-over-window notice +95).' +
      (TICKET_LISTING_RECONCILED.has(id)
        ? ' Plus host.toolCalls only: ' + (id === 'hand-off-execution'
          ? 'the trailing builtin_chats_list_tickets is dropped (this host advertises no listing tool).'
          : 'one builtin_chats_list_tickets before the first-edit from_delta (parent-epic lookup), and one before the settle from_delta (the open-work hold; the settle\'s parent-epic lookup reuses it); the trailing listing (the in_progress advance, read fresh) is unchanged.')
        : ''),
    reason: 'Intended change (chat-link-on-create): a created item links its chat in the create call, so the prompt no longer asks for a link step and the run fires none. Applied by brain-embedded/scripts/apply-intended-snapshot-change-chat-link.mjs, not regenerated from the agent. Intended change (47642b1d5, "fix(agent-run): hold a run\'s end while its linked tickets are open…"): chatWorkLinkingDirective gained the epic-parent bullet for a linked chat, so an open epic\'s remaining work is filed under it. Applied by brain-embedded/scripts/apply-intended-snapshot-change-epic-parent.mjs, not regenerated from the agent.' +
      (TICKET_LISTING_RECONCILED.has(id)
        ? ' Intended change (47642b1d5 + the per-run listing memo in runStore/chatTickets.ts): the ticket-list backstops are gated on the listing tool and act only on run-owned tickets, the parent-epic lookup lists once before a mint, and the read-only questions of one settle reuse one listing until an attempted ticket write or a model turn, while every ticket move reads the listing fresh. Applied by brain-embedded/scripts/apply-intended-snapshot-change-ticket-listing.mjs, not regenerated from the agent.'
        : ''),
    approvedBy: APPROVED_BY,
  })),
];

export const APPROVED = [...APPROVED_PERMANENT, ...APPROVED_THIS_PUSH];
