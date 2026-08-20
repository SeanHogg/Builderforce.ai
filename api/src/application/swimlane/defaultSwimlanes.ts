import { TaskStatus } from '../../domain/shared/types';

export interface DefaultSwimlaneSeed {
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
  gate: 'auto' | 'human';
}

/**
 * Default swimlanes seeded when a board is first created.
 *
 * They mirror the task board's kanban columns 1:1 — each `key` is exactly a
 * {@link TaskStatus} value — so the Board-configuration panel shows the same
 * lanes the user already sees on the board, and agent-per-lane mapping on the
 * board is an exact key match rather than a name heuristic.
 *
 * Order matches the kanban column order. `done` is terminal.
 *
 * ── WHY `in_review` IS `auto` (changed 2026-07-25, migration 0369) ────────────────
 * It was seeded `human`, on the reasoning that review is the natural approval point.
 * Measured consequence: EVERY board shipped with autonomy switched off one lane short
 * of Done, and 0.7% of tickets reached Done autonomously. A human gate does not mean
 * "a human reviews this" — nobody was reviewing — it means "this ticket stops here",
 * and tickets sat in review for weeks with `human_gate` as the only explanation.
 *
 * `auto` does NOT mean unreviewed. It means the lane may dispatch a REVIEWER:
 *   • `laneRequirementGate` resolves one from the lane's requirement rows, its
 *     staffing (`laneApprover` tier b) or the ticket's manifest, and blocks the
 *     lane's normal agent while that review run is out;
 *   • `evaluateTaskAutoRun` suppresses the owner fallback on a review-class lane
 *     ({@link isReviewLane}), so the gate opening can never mean the author re-runs
 *     on its own work;
 *   • with no reviewer resolvable at all the lane reports `no_agent` — "staff a
 *     reviewer", which a person can act on — instead of `human_gate`, which reads as
 *     "working as intended".
 *
 * A team that genuinely wants a person to approve every ticket sets the lane back to
 * `human` in Board configuration; that stays a deliberate choice rather than the
 * unexamined default it used to be.
 *
 * ── WHY `backlog` IS `human` ─────────────────────────────────────────────────────
 * Backlog is the STAGING lane: it is where a raw idea, an imported issue, a
 * feedback item and a half-written thought all land before anyone has agreed they
 * are work. Seeding it `auto` meant every one of those started a billable run the
 * moment it was created, on a description nobody had refined — the measured shape of
 * which was a 299-ticket backlog cohort that autonomy kept reaching for. Moving a
 * ticket OUT of backlog (to To Do / Ready) is the cheapest, most natural "yes, do
 * this" a person can give, and every lane after it stays `auto`, so this costs one
 * drag and buys back the tokens spent on unrefined tickets.
 *
 * `blocked` stays `auto` deliberately: a ticket lands there because something stopped
 * it, and the lane's job is to try to unblock it.
 *
 * This is a SEED. Boards that already exist keep whatever gate they were configured
 * with — a default change must never silently re-gate a running board.
 */
export const DEFAULT_SWIMLANES: DefaultSwimlaneSeed[] = [
  { key: TaskStatus.BACKLOG, name: 'Backlog', position: 0, isTerminal: false, gate: 'human' },
  { key: TaskStatus.TODO, name: 'To Do', position: 1, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.READY, name: 'Ready', position: 2, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.IN_PROGRESS, name: 'In Progress', position: 3, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.IN_REVIEW, name: 'In Review', position: 4, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.BLOCKED, name: 'Blocked', position: 5, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.DONE, name: 'Done', position: 6, isTerminal: true, gate: 'auto' },
];
