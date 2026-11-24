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
    blob: '51b7a36b24f5ffe8a6c6566adcccbcf4891dea74',
    changed: "The host fixture's `verifyPin: undefined` becomes `reviewPin: undefined`; every expectation is unchanged. The fixture observes the shared openRun entry point and pins the routing prior. Adds a regression for child lineage when the durable cursor names the child.",
    reason: "Intended change (6e6911185, BYO role routing, chat #153027): code review is its own `review` role, so the cloud host's review pin is named for it. A rename only. The one-pipeline migration moved the boundary being inspected. The domain and role assertions still run against the real adapter.",
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
    blob: '215eb5dbb5f0142f648d18c512c27bb848054e21',
    changed: "The readChangedExcerpt case is not carried. Adds cases for read-only learning, evidence thresholds and duplicate writes.",
    reason: "It reads the workspace with node fs and git; the package may not import node:*. The case runs unchanged in clients/vscode/src/changedExcerpt.test.ts (the editor, readChangedExcerpt). The original cases still run. The new cases exercise learned-fact policy at the shared runtime boundary.",
    approvedBy: APPROVED_BY,
    cases: 1,
  },
  {
    file: 'packages/agent-run/test/verify/runEndMemory.test.ts',
    blob: '38879dc8945accaa29601a415ea744acf5a03bb1',
    changed: "The three run-end tail cases run over timeline and store.commitMemory port fakes instead of a stub Drizzle db; the seven pure cases are import-only. Adds cases for confirmed branch CI and a failing local command.",
    reason: "The cloud keeps the three original tail cases unchanged in api/.../runEndMemory.test.ts; these are additional port-level variants. Both cases cover verification evidence used by the shared finish path.",
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
    blob: 'f824173f4639ca120fb90fd2b62cde1fb11851b5',
    changed: "vi.hoisted telemetry, difficulty-gate and env-lever mocks replaced by GuardPorts and GuardLevers. All 12 source cases have a counterpart (one is split: its levers-off pass-through case is guards/leversOffPassThrough.test.ts); one case is new. (chat #276, 2026-11-19) One case appended — 'never escalates on a finish held for open linked work' — every existing line unchanged. (PRD 48, 296818c0b) The harness's `pause` port is removed, and 'steers on the first trip, escalates on the second, pauses on the third' becomes '… finishes on the third': the third trip expects finalTurnDue, no pendingPause in the snapshot and a final-report tail note, instead of an ask_human park from beforeDispatchPause.",
    reason: "The engine read levers from env strings and wrote telemetry through module imports; the policy takes them as ports. Re-approved 2026-11-19 for an append-only case: a linked_work_open finish hold is owed work, not a failed verifier, so it must not escalate the model. Re-approved 2026-11-20 for PRD 48 (ship policy, chat #157440): the progress guard ladder is steer -> escalate -> finish and never asks a person whether to continue; the pause rung and its port are deleted, so the old assertions pinned the superseded behaviour.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/finish/finish.test.ts',
    blob: '521ae95a07e59c4de6cd6379effb7bdc9c1e9bb3',
    changed: "Two expectation lines: enterVerify toHaveBeenCalled became a counter > 0; the record-mock calls became a reasons list. The six evaluateFinishGates cases run over FinishGatePorts; the cloud file carries five cloudFinishPorts cases. The initializer omits the removed child flag. Starting unspent and restoring a previously spent gate remain covered.",
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
    blob: '8cf0ecca6522d3c2be26931c99d75d997480cabd',
    changed: "'once planning closes…' expects the code-turn menu (edit_file, ask_user and the three router tools) instead of the 64-tool menu minus hand_off; 'a catalog the limit holds whole…' builds a 20+2 tool fixture (was 62+2). Its assertions are unchanged. Re-approved 2026-11-21: R7 'a tool an EARLIER run called pins nothing in the next one' becomes 'stays pinned in the next one' (not.toContain → toContain). The ranking case uses a unique request keyword and compares the chosen menu with a catalog head of equal length. The small-catalog case requests a hand-off explicitly.",
    reason: "Stale premise since cda0c33e9: the turn after planning closes is a CODE turn, capped by roleCap.ts (22 tools, no catalog-order backfill), so a 64-tool menu can no longer appear there. The fixture shrinks so that 'a catalog the limit holds whole is never trimmed' still holds under the code cap. Re-approved 2026-11-21 (operator, agent-execution-efficiency review): a tool the conversation already called stays advertised in the next run (runStore/conversationPins.ts, capped at 8 and by the role cap); the old rule dropped it and a run called a tool missing from its menu. The rankings and planning-to-code menu checks now reach those behaviors under the role caps and intent gate.",
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
    changed: "(0b42a0c29) Three rollupChatTicketHealth toEqual expectations gain openTickets/completedTickets (3 done + 1 cancelled -> 0/3; all-cancelled -> 0/0; in_progress + canceled -> 1/0). (chat #276) effectiveTicketProgress/closedLaneProgress lose their third (unsupportedDelivery) and fourth (whenClosed) arguments: the 'complete'/'passthrough' mode cases are folded into one closed-lane case; an open lane at raw 100 ('in_review', 100) now expects CLAIMED_COMPLETE_PROGRESS_CAP (was 100); a closed lane carrying a stale 75 ('done', 75) now expects 100 (was 75 under passthrough). Rollup fixtures pass the producer's output instead of the deleted flag. Regression cases added for chat #276. (per-kind follow-up) The 'closedLaneProgress (any tier) floors a closed lane and never caps an open one' case becomes 'each kind closes on its own vocabulary' (roadmap 'shipped' 100, spec 'complete' 100, task 'done' at 75 -> 100, spec 'in_progress' 40 stays 40) — closedLaneProgress is deleted; its import is removed. effectiveTicketProgress's `kind` became a required parameter, so every two-argument call gains an explicit 'task' (no expected value changed).",
    reason: "Intended change (0b42a0c29): ChatTicketHealth gained two ticket counts, original pct/done/total kept. Intended change (chat #276, 2026-11-19): 'exact 100 is the only completion signal and only a CLOSED lane emits it' — an in_progress epic whose filed children were all done read 100% on the chat ring while the PRD was still open. A closed lane reads 100 on every surface (server = rail). unsupportedDelivery was fully subsumed by the open-lane cap and deleted; an independent Opus review confirmed the subsumption.",
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/brain/ceremonyTicketHealth.test.ts',
    changed: "The unsupported-delivery cases (execution/file-change fixtures for the deleted epicsWithUnsupportedDelivery query) become lane-based cases; 'does not cap a pre-close claim when the live run left no file rows' now expects the claimed-complete cap (was 100); 'stays at 0/5 … parent is done' now expects 100 (closed lane); the docs-only-epic (#6550) and 'coder run changed a non-doc file' cases are dropped — they only exercised the deleted query and are covered by the closed-lane / open-lane cases. Leaf and closed-epic regression cases added. (per-kind follow-up) 'reaches 100% exactly when every story is estimated' (an ACTIVE poker session, 4/4) now expects CLAIMED_COMPLETE_PROGRESS_CAP, with a new case for the same session `completed` reading 100; in the batching case poker:p2 (active, 4/4) expects the cap (was 100).",
    reason: "Intended change (chat #276, 2026-11-19): same rule as chatTicketHealth.test.ts; 'done' now means the lane is closed (completed_at alone no longer counts), so an epic's done/total agrees with its children's chips. Per-kind follow-up (same day): every chat-linked kind closes only on its own status words (TICKET_CLOSED_STATES); an active poker session with every story estimated is not closed, so it reads the claimed-complete rung, not 100.",
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
  // Spawn calls name their `role` (fc939c496, chat #273): a role-less spawn_agent / spawn_agents is refused with a corrective error.
  ...[
    'agent-runtime/src/run/onPremAdapter.test.ts',
    'brain-embedded/src/referenceScenario.test.ts',
    'brain-embedded/src/runStore/earlyDelegation.test.ts',
    'brain-embedded/src/runStore/progressGuard.test.ts',
    'packages/agent-run/test/conformance/referenceScenario.test.ts',
  ].map((file) => ({
    file,
    changed: "The scripted spawn_agent / spawn_agents call's args gain a `role` (explore / review); every expectation is unchanged.",
    reason: 'Intended change (fc939c496, chat #273): spawn_agent / spawn_agents require `role` (audit/compare/align = review, locate/bulk-read = explore, decide = plan) and a missing role is answered with a corrective error instead of a role-less child, so a fixture that delegates must name one to keep exercising the delegation it tests.',
    approvedBy: APPROVED_BY,
  })),
  {
    file: 'packages/agent-run/test/subagents/child.test.ts',
    changed: "The delegating script's spawn_agent args gain `role: \"explore\"`; one case is added (a role-less spawn is refused with MISSING_ROLE_ERROR and nothing is spawned), with its MISSING_ROLE_ERROR import. Every existing expectation is unchanged.",
    reason: 'Intended change (fc939c496, chat #273): spawn_agent / spawn_agents require `role`; a missing role is answered with a corrective error instead of a role-less child. The added case pins the refusal.',
    approvedBy: APPROVED_BY,
  },
  // PRD 48 ship policy (296818c0b, chat #157440): the progress guard ladder is steer -> escalate -> finish and never asks a person.
  {
    file: 'brain-embedded/src/run/parity/scenarios/ends.ts',
    changed: "The ship-gate scenario's h.start gains `...SHIPS_TO_MAIN` (shipPolicy commit_push from project_settings), with its import; every expectation is unchanged.",
    reason: 'Intended change (PRD 48 ship policy): a run pushes to the base branch only when its ship policy says so, so the ship-gate scenario must declare the commit_push policy to keep exercising the push it records.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/guards/guardsHook.test.ts',
    changed: "'A3: a parked run skips the next call with an ask_human control, once' becomes 'regression: chat #157440 — A3 never parks a run; an old saved pendingPause is ignored on resume': the hook has no beforeDispatch, and a saved pendingPause key is dropped by the next observe. The header comment says so.",
    reason: 'Intended change (PRD 48 ship policy, chat #157440): the progress guard never asks a human whether to continue — its third trip finishes the run on a no-tools report — so the pause rung, its ask_human control and beforeDispatch are deleted. The old case pinned the superseded behaviour; the new one pins that state saved before the change is harmless.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'packages/agent-run/test/guards/progressFinish.test.ts',
    changed: "The chat #146477 case drops its two pause expectations (pendingPause undefined, beforeDispatch undefined) and ', never a pause' from its title, since the pause field and beforeDispatch no longer exist. A chat #157440 regression case is added (no stronger model: second trip is a second steer, third trip finishes on a no-tools report, no ask_human).",
    reason: 'Intended change (PRD 48 ship policy, chat #157440): the guard ladder is steer -> escalate -> finish and never pauses for a person, so there is no pause to assert absent; the finish expectations of the original case are unchanged.',
    approvedBy: APPROVED_BY,
  },
  {
    file: 'api/src/application/runtime/cloudAdapter.conformance.test.ts',
    changed: "The `../llm/vendors/registry` vi.mock factory spreads the real module (importOriginal) and overrides only `catalogEntry: () => null` (was a factory exporting catalogEntry alone); every expectation is unchanged.",
    reason: "Mock repair, no behaviour change: modules on the cloud adapter's import path now read the registry at load (llm/vendors/modelTwins.ts calls getCatalog, llm/modelPoolComposition.ts calls autoRoutableModelsByTier), so the catalogEntry-only factory failed the suite before any case ran ('No \"getCatalog\" export is defined on the mock'). The fake the cases depend on (no catalog entry for the fake model) is kept.",
    approvedBy: APPROVED_BY,
  },
];

const RELEASE_BUILD_REVIEW = 'release build review (2026-11-24)';

const RELEASE_BUILD_ORACLES = [
  {
    file: 'brain-embedded/src/handOffExecution.e2e.test.ts',
    blob: '6a22ac52e576e03a82bbe13f86c065efd3f08d72',
    changed: 'Select quick routing for the child coding scenarios and use the quick change-turn budget. Bound the scripted model turns.',
    reason: 'A child can now take either shared route. The explicit coding fixture still proves the required change-only menu dispatches an edit, and the parent scenarios still verify the read-only streak.',
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "agent-runtime/src/run/onPremSubagents.openRun.test.ts",
    blob: "e40a2439e8404dedb712df8f4447791319f43b50",
    changed: "Assert the child brief and owner lineage on task dispatch.",
    reason: "The shared entry point routes child runs from its defaults. The on-prem adapter passes the brief and lineage directly.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/parity/gates.test.ts",
    blob: "0a035d9959691453a20d77cd166768a2486fb48e",
    changed: "Expect the shared independent-review refusal text.",
    reason: "The scenario still checks the review refusal, shell-publish advisory and held finish.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-loop/src/subagent.test.ts",
    blob: "d32016d7d40997e5c35f54c23930a5aa6209e300",
    changed: "Expect the child to execute its assigned slice and retain the report contract.",
    reason: "Children have scoped tool access and the prompt no longer promises the owner’s entire catalog.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/subagents/subagent.test.ts",
    blob: "55681ff33d1384f1bf3e41683028e1cc4119022e",
    changed: "Expect the child to execute its assigned slice and retain the report contract.",
    reason: "Children have scoped tool access and the prompt no longer promises the owner’s entire catalog.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/channels/killedCommand.test.ts",
    blob: "d5ed412b5444ee6b93198a6687b5efba984a053d",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/cloud/cloudPolicy.test.ts",
    blob: "2e0dd3fd3baecbe0771efc0d554b75fc3b732813",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/cloud/modelHandoff.test.ts",
    blob: "8df9ed58728b43a8fdf6e030eb237160d51eb873",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/compaction/applyCompaction.test.ts",
    blob: "f8f997781191e70af8173ebe72589d603a43bffd",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/steering/notStartedRegistry.test.ts",
    blob: "89c43a47778e07eb20f189b16de8da3291e644b7",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/support/policyContext.ts",
    blob: "98b5bd12f53768e1f55cdf56ba17b5720d9f4dff",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/telemetry/costTally.test.ts",
    blob: "10a04d44475bff2141ea73303971d5e8020f75a3",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/telemetry/outcomeRow.test.ts",
    blob: "5f549432ecc1ce91241c014c30a3cb25b7dab908",
    changed: "Use the shared state or finish-gate initializer signatures.",
    reason: "The task-specific initializer arguments were removed when children started using the shared pipeline. Existing outcome and dispatch assertions remain.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/entry/openRun.test.ts",
    blob: "d2610c93689ecd9b9bf6e944dbfe5ac2d80682e0",
    changed: "Exercise a child’s full route, planning role, and root-only spawn gate with two menu sources.",
    reason: "Child routing and verification use the shared defaults. The superseded child-only code-start and no-route branches are gone.",
    approvedBy: RELEASE_BUILD_REVIEW,
    cases: 2,
  },
  {
    file: "packages/agent-run/test/entry/routeRun.test.ts",
    blob: "c2074b94333f9a0cb71c6f884045b603159c5e01",
    changed: "Remove the case for an independent child shortcut.",
    reason: "openRun.test.ts exercises children through the supported shared routing path.",
    approvedBy: RELEASE_BUILD_REVIEW,
    cases: 1,
  },
  {
    file: "packages/agent-run/test/subagents/spawnChild.test.ts",
    blob: "de5da788fb549ddf91976b5c51d7f5f4f901e638",
    changed: "Assert nested admission is refused and previously admitted children can still prepare.",
    reason: "New spawns are root-only while admitted children retain durable resume support.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "packages/agent-run/test/subagents/child.test.ts",
    blob: "80da109036b8af6a264938eba874dfc70e44435a",
    changed: "Expect child verification and owner-only sign-off.",
    reason: "Child work follows the shared verification policy within its own tool scope.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "agent-runtime/src/conformance/crossAdapter.test.ts",
    blob: "99e15ed653fc8a93812a3e56288dc0291e7368a7",
    changed: "Observe openRun and assert the entry-routing trace.",
    reason: "The host now enters through the shared pipeline. Observing the production entry point checks both routing and the existing agent behavior.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/crossAdapterConformance.test.ts",
    blob: "bd11b89996a6122bbebab0d1b188be251494cd53",
    changed: "Observe openRun and assert the entry-routing trace.",
    reason: "The host now enters through the shared pipeline. Observing the production entry point checks both routing and the existing agent behavior.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "agent-runtime/src/run/channelOutcome.test.ts",
    blob: "72880a9f306e3e12697286f66a0decb76a1ebb7d",
    changed: "Use a command-shaped tool fixture and assert successful verification.",
    reason: "The fixture supplies command evidence to the verification gate while retaining the outcome reporting assertions.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "agent-runtime/src/run/channelRebuild.test.ts",
    blob: "31ba91c1d771304e57efbde43df07263549126cd",
    changed: "Give initial and rebuilt agents a read tool.",
    reason: "The scripted tool menu reaches the same stall, steering and rebuild assertions under the shared policy.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/areaR/steer.test.ts",
    blob: "9c28685efdc94ede9117f658efa0ff5b38844b4e",
    changed: "Explicitly request a hand-off in the Stop-during-ticket-creation scenario.",
    reason: "Tool visibility now depends on the request. The fixture still checks both ticket creates survive the interrupted hand-off.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/conformance.test.ts",
    blob: "33a8a3801abd8fe9140d7a1cc79d19ae13d733e2",
    changed: "Run the conformance contract over the entry-point registry.",
    reason: "The same cases now cover every registered host.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/brainFold.deadline.test.ts",
    blob: "6f4d1097c845c57c4f6150241cca4f0303f925aa",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/foldParity.test.ts",
    blob: "fea4b9b611d75a54d6b950f37c75d7ca4ef917ac",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/continueClaim.test.ts",
    blob: "4e1d2f3e6bd190e4755c3a92e4db8720660aebae",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/continueStop.test.ts",
    blob: "7c80c02966a66708f59576aa7342a1a867a4bc4f",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/serverChat.test.ts",
    blob: "86bbf7c48bfaa4700fb2c03f41d1eb02e4cac9ff",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/startRun.settle.test.ts",
    blob: "4516e640c0d5408308a80f2ed696837e3720b529",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/useChatTurns.draftStop.test.tsx",
    blob: "366bbb19aafb58418310c666c75b75de2e13b3c6",
    changed: "Declare the fixture host entry point.",
    reason: "openRun requires entry-point metadata. The existing fold, claim, continuation or persistence assertions still run.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/continueChat.test.ts",
    blob: "914a101ff714cc9f9459b5e01ee96b2713e6d03f",
    changed: "Declare entry points and exercise a follow-up after close-out.",
    reason: "The shared pipeline requires the host identity and the continuation fixture covers the new close-out boundary.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/test/brainRunHarness.ts",
    blob: "d49b8e2fde183e1697a26e496b93d3f86391bc36",
    changed: "Exercise openRun with preflight facts from the shared factory.",
    reason: "The preflight oracle now traverses the same entry point as production.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/test/engineKit.ts",
    blob: "ee4ec3e06411bf05210eb62eada646e7d0f10f19",
    changed: "Make entry point optional for scenarios and supply the editor default in the harness.",
    reason: "The playback fixtures share a declared host while retaining their existing request overrides.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/useBrainConversation.test.tsx",
    blob: "a8e602eb53b4667e57f69e1faf8e42b7d853fe5b",
    changed: "Declare the host and count persistence batches carrying conversation rows.",
    reason: "Routing and workflow step rows use the same persistence port. The tests still verify the number of user and assistant writes.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/runStore/startRun.lateBackstop.test.ts",
    blob: "39af5187e2604165dd89db7c973a7fb407bd8890",
    changed: "Hold a real delta-ticket call and a controlled terminal outbox flush.",
    reason: "Close-out is now inside the run. The assertions cover the late ticket completion and the claim held during the new unwind boundary.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "clients/vscode/src/brainRunHost.entryPoint.test.ts",
    blob: "260228a72c9fcc91f5e23e8705cd7aa14a9ef6f8",
    changed: "Import transientRunPersistence from nativeRunStream.",
    reason: "The extracted adapter owns the same helper. Existing assertions remain in place.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "clients/vscode/src/brainRunHost.identityTimeout.test.ts",
    blob: "2277e1a697a45fd5ff9fb0b80c240bf5cbae1aaa",
    changed: "Import transientRunPersistence from nativeRunStream.",
    reason: "The extracted adapter owns the same helper. Existing assertions remain in place.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "clients/vscode/src/nativeBrainRun.setup.test.ts",
    changed: "Retire the fixture for the removed native run entry point.",
    reason: "participantRun.test.ts covers context, checkout, cleanup and both busy windows on the supported path. The shared preflight cases cover preflight before dispatch.",
    approvedBy: RELEASE_BUILD_REVIEW,
    cases: 5,
  },
  {
    file: "brain-embedded/src/run/parity/oracle.files.txt",
    blob: "f9f3308e64a205750f22c9481062db375706dfcb",
    changed: "Replace the retired native setup file with participantRun and oneRunDoor coverage.",
    reason: "The registry now follows the supported VS Code integration and continues to guard the shared entry point.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/parity/harness.ts",
    blob: "2cc9f415f80843e2b093c78661e24aec7fe5404d",
    changed: "Declare the original web entry point, wait for a stream frame on scripted failure, and remove validated workflow spans before comparison.",
    reason: "The contract retains the legacy host identity and observes error frames consistently. Workflow telemetry has its own diagnostics tests.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
  {
    file: "brain-embedded/src/run/parity/normalise.ts",
    blob: "d3d2d29f17b0f3ddb4cf71f7d0de86d12379cc81",
    changed: "Remove validated workflow spans before normalizing comparison IDs.",
    reason: "Measured telemetry is tested separately. Route records, model calls, tool actions, terminal errors and outcomes remain in the comparison.",
    approvedBy: RELEASE_BUILD_REVIEW,
  },
];

// Every re-recorded oracle is tied to its reviewed bytes so later changes still require review.
const CHILD_ROUTING_SNAPSHOTS = new Set(['sub-agent-spawn', 'steer-a-child', 'child-own-transcript']);

const RELEASE_BUILD_SNAPSHOTS = [
  ['ask-user-malformed', '99d13d66564c834173b8b0284e83cc04c225fde8'],
  ['ask-user-terminal', 'a32a97ea9ff3be12f72a54223f355048808dfb8f'],
  ['big-read-paged', 'e549a61160ce0c4028a9936daa55325d1af60bd4'],
  ['budget-warn-stop', '1d38ee2da6e1c2105040d30c7955b312127880ef'],
  ['chat-mode-tools', 'a1472710c747a80ca91ca70819f09b1d834b8827'],
  ['child-own-transcript', '0b45ae7b5c85a32ee528843470739b58f3055328'],
  ['child-report-exhausted-stall', '7ac1e62da51aba461a3f672b1de81ea1f7c78110'],
  ['child-report-ship-gate', '8b8cc24dc795877702610ee6d2402c7dea83be4b'],
  ['child-report-turn-end', '942cf32fd3e6b2bc3a883acddbf62e6d6350bb26'],
  ['confirm-approved', 'aae055c53162524cc5cc43b3894f46e03e9bfefe'],
  ['confirm-declined', '35e5b13b1d4fd64350a682abdeb53cd95ab5a830'],
  ['effort-balanced-thinking', 'dfd3f3693eed69b0201597eec1694bfdefd868ce'],
  ['effort-quick', '9d333a86d62d861113d82f6ec5bee0f3956d158c'],
  ['effort-thorough-thinking', '4a837dd339f3149b096ac8ee3c0e3b5aa440f051'],
  ['flash-pinned', 'e6ef96296a0fcc8c03fbee013c6b9dec049617f9'],
  ['focus-files-once', '6a9bdf9c8a05422dbcd4a11c078bb8ecf92199b1'],
  ['fold-in-tool-loop', 'c8b2afc31870c6c1225884a67eea1d85095d1c26'],
  ['fold-summary-fails', '7decc3ff76c761c5220cd8571c1a61fd4a322c01'],
  ['hand-off-execution', 'a445ee80abdc3a95a532f214c648795b29221ac2'],
  ['handed-off-commands', '28f32de924a23baa6292514581e3d7e428fe1a3e'],
  ['image-attachment', '69b934313c822ec1f03a0a8fee203843df3992c9'],
  ['image-with-context', '66b9de2b6d5cd5992c870a0dd7a19755e0c5d6f6'],
  ['ledger-in-tail', '438ea94e47f6ab3651175c0f8284fff45daabf91'],
  ['long-chat-folds', '716c2c9e8323d528a336862f9b8f575844220b0a'],
  ['malformed-call-args', 'd03c491a7be6f788e52f60d9609f5899b5d735ee'],
  ['mcp-tool', '2744190ef38b5d41f2cfc7ba996f0e7c045005c5'],
  ['memory-savings', '7609f617563b14d66831458bf328352e8791a527'],
  ['model-breaks-mid-answer', '12fe4f37404d6aee8a73c2e9686ed9559c9b6092'],
  ['pinned-model-breaks', 'c60c38f7db5cf110a7f79cb94f5b386117f184e8'],
  ['plain-chat', 'f38237356af7607d39d4bdf712df60392d023218'],
  ['planner-ignores-forced-turn', '7f084361de1e6e6cc92015b58d4f631fccd113eb'],
  ['preflight-once', '5aa21f3e4dbec0b206a455fc11bb4053ebe67c98'],
  ['quick-on-flash', '0b5735cdfaa2d49080466bc57de99c47d651f575'],
  ['quick-route', 'b3f22f03ea7102cd2f48655b336759fbb4d5fb42'],
  ['read-dedupe', '2d0cc322f4dd50667f5b510eab6bbeb482ba8fec'],
  ['reask-discarded', '03c57382058929bf824ff4525caa80c6ead613dc'],
  ['reask-fails', 'ed2484c951e86fef97c30d164a5ab8bf1efafa30'],
  ['reask-transport-failure', '64b9b5fef940f4ab1298f4c09c433160edbf796e'],
  ['reasoning-next-action', 'd360b70ac2e0fc57e543c471ee240c44977ea794'],
  ['reasoning-replay', '19425f47ecdf078295aa376f276135a0ae496705'],
  ['refusal-401', '516202d544b70cf8b5bc8ad4ac2e4cdc0d093864'],
  ['refusal-402-plan', 'e0ec897335e49ed6805a85a03e167ef122fa8d49'],
  ['refusal-402', '9a8d6975c16d6594ae21a876640ffe23982a5274'],
  ['refusal-429', '319acd36575eb605afef982c37b0413931dd0665'],
  ['reload-after-fold', '1e71f91f489f4f40fa924b94573e054c06e4eea5'],
  ['restated-reply', '61b7652332ccad2f1c058141c73ecbd6d281283c'],
  ['retry-forced-turn', '1b9b597a8bdbd6b5d1eb7f9c98995d3c70c4f281'],
  ['routed-tool-pin', 'bb7b583455e4ac2cf5c98d366cd1a09228802a25'],
  ['ship-gate', '7bd259a34409f8498e8f45c0734d481c330702a3'],
  ['six-failures-one-turn', '0b3be132d7359e63c87d61a44e6834fe6c7d1ea2'],
  ['small-window-tools', 'bfdd9a9495c6210de9150494e8f5915e92667068'],
  ['stall-exhaustion', 'd4c5fbc7c89551e50c039af9a278ce8f7e5a8050'],
  ['stall-failover', 'b0ec889ca754d44c677df73a37eb03841ca4d43d'],
  ['steer-a-child', 'db835d5c9d10d36acca6aa94f8001787b4dc0253'],
  ['steer-before-command', '1186c6887229f8dc447953dc1c4346ad3219f465'],
  ['steer-during-tool', 'fc0e1b1ed139e15aa55a63ca4917063060bd15dc'],
  ['steer-final-answer', 'ae3aaa782f5fd16f9d357219261c985e5ea64a15'],
  ['steer-stop-word', 'db582ffbe395af9bf77bd968ba5dac3979b9cf17'],
  ['step-numbering', '38cda267daf3efd21943eacde83a018fb07e53e4'],
  ['stop-before-text', '5fc9ff2a2ec42bb00a76db85e0ed32daecbc71c5'],
  ['stop-during-fold', '2de94b43f089d3eb6dbcd2f61213ee158c0f1d35'],
  ['stop-during-hand-off', 'ac7f2712d5400ec6ab417e7646ba199642a11741'],
  ['stop-during-stream', '6f8b454a4cf3fe6e68fa34935067a47ce0675178'],
  ['stop-hook', '9a45868958f45c81313061441eacd3b5e0fa082a'],
  ['sub-agent-spawn', '16a8236c7b85805c9923f9e87926cfd679d12c73'],
  ['thorough-route', 'e6f9bff7faceda1dfc7dfac98128441d047a93a7'],
  ['tool-failure-breaker', 'd624b4bbea9604c2c5ac9dacc8de4e158e51815a'],
  ['tools-without-runner', '550a6a208908602a99f3c625ff7d40a8bb6c1803'],
  ['two-runs-one-fold', '9be9a8ebcccf9fac03575ec2fa3aef98d8a41a30'],
  ['two-steers-turn-end', '7e2a76ac4f86b7730e04929d06aed6712349ecab'],
  ['undelegated-request', 'b72da18540cfeb26702bafa14bcd410a496587d4'],
  ['unknown-tool', '7b4475e2934ba420d52e4dcfe4840832e795b132'],
  ['wait-interrupted', '77365dbc367647de321ee20546fcbd0f0ca8a4fe'],
  ['work-mode-tools', 'fb65709c71bbb7a6903205f07109ab5d47f63efa'],
].map(([id, blob]) => ({
  file: `brain-embedded/src/run/parity/snapshots/${id}.json`,
  blob,
  changed: CHILD_ROUTING_SNAPSHOTS.has(id)
    ? 'Record the child’s shared route and the scoped menu without nested spawning.'
    : 'Record shared entry routing, preflight where applicable, and the failure breaker’s synthesized-turn record.',
  reason: 'PRD 50 opened all hosts through the shared pipeline. Reviewed replay preserved required trace labels, reply text, terminal errors, model-call counts and outcome status. The two ship scenarios add one fresh linked-ticket read in close-out.',
  approvedBy: RELEASE_BUILD_REVIEW,
}));

export const APPROVED = [...APPROVED_PERMANENT, ...APPROVED_THIS_PUSH, ...RELEASE_BUILD_ORACLES, ...RELEASE_BUILD_SNAPSHOTS];
