import type { LifecycleEvent } from '@/lib/builderforceApi';

/**
 * laneOccupancy — turn a ticket's ordered lifecycle events into the LANES IT SAT
 * IN and for how long.
 *
 * WHY THIS EXISTS
 * The planning surfaces draw an Epic as a group with its children beneath it, so
 * an Epic's progress reads as a flow. A work item that is its OWN single value
 * unit — no children, the thing one person or one agent actually delivers — got
 * one bar. Its lifecycle was a row: a start, an end, and no answer to the
 * question anyone actually asks about a late ticket, which is *where did the time
 * go*. Two tickets that took eleven days look identical as bars when one spent
 * ten days in review and the other spent ten days in backlog, and those are
 * opposite problems with opposite fixes.
 *
 * The facts to answer it were already being written: `task_status_transitions`
 * stamps every lane move, and the lifecycle ledger already surfaces them as
 * ordered `lane_moved` events carrying `fromStatus` / `toStatus`. Nothing needed
 * collecting — the intervals between those events simply had to be folded up.
 *
 * Pure and DOM-free so the interesting cases (a re-entered lane, a backward hop,
 * a ticket still open, a first event that is not a lane move) are unit-testable.
 */

/** One continuous stay in one lane. */
export interface LaneSpan {
  /** The lane/status key the ticket sat in. */
  lane: string;
  /** Epoch ms the ticket entered this lane. */
  from: number;
  /** Epoch ms it left — or `now` while it is still there. */
  to: number;
  /** True while the ticket is still in this lane (the span has no end yet). */
  open: boolean;
  /**
   * True when the ticket arrived here by moving BACKWARD (a rework hop). Drawn
   * differently because a second stay in `in_progress` after a failed review is
   * rework, and rework that reads as ordinary progress is how a redo loop stays
   * invisible in a status report.
   */
  rework: boolean;
}

export interface LaneOccupancy {
  /** Every stay, in time order. A lane re-entered appears more than once. */
  spans: LaneSpan[];
  /** Lane keys in first-entered order — the swimlane row order. */
  lanes: string[];
  /** Total ms per lane, summed across re-entries. */
  totalByLane: Record<string, number>;
  /** The span the clock is still running on, if any. */
  current: LaneSpan | null;
  /** Earliest and latest instant the chart has to cover. */
  start: number;
  end: number;
}

const EMPTY: LaneOccupancy = { spans: [], lanes: [], totalByLane: {}, current: null, start: 0, end: 0 };

/** Parse an ISO timestamp to epoch ms, or null when it is unusable. */
function at(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Fold lifecycle events into lane spans.
 *
 * `createdAt` seeds the FIRST span, because the lane a ticket was created in is
 * never itself a lane move — it is the `fromStatus` of the first one. Without
 * that seed the time between opening a ticket and first touching it (very often
 * the largest single block) vanished from the picture entirely, which would have
 * made this chart lie in exactly the direction that flatters the team.
 */
export function laneOccupancy(
  events: readonly LifecycleEvent[],
  createdAt: string | null | undefined,
  now: number = Date.now(),
): LaneOccupancy {
  const moves = events
    .filter((e) => e.kind === 'lane_moved')
    .map((e) => ({ t: at(e.at), from: e.fromStatus ?? null, to: e.toStatus ?? null, backward: e.isBackward === true }))
    .filter((m): m is { t: number; from: string | null; to: string | null; backward: boolean } => m.t != null)
    .sort((a, b) => a.t - b.t);

  const created = at(createdAt) ?? moves[0]?.t ?? null;
  if (created == null) return EMPTY;

  const spans: LaneSpan[] = [];
  // The lane the ticket started in: whatever the first move says it came FROM.
  let lane = moves[0]?.from ?? null;
  let since = created;
  // The arrival, not the departure, is what makes a stay rework — so the flag is
  // carried forward from the move that opened the span, not read off this one.
  let rework = false;

  for (const move of moves) {
    // A move with no destination tells us nothing about where the ticket went;
    // closing the open span on it would invent a gap.
    if (!move.to) continue;
    if (lane) spans.push({ lane, from: since, to: Math.max(move.t, since), open: false, rework });
    lane = move.to;
    since = move.t;
    rework = move.backward;
  }

  if (lane) spans.push({ lane, from: since, to: Math.max(now, since), open: true, rework });

  const lanes: string[] = [];
  const totalByLane: Record<string, number> = {};
  for (const s of spans) {
    if (!lanes.includes(s.lane)) lanes.push(s.lane);
    totalByLane[s.lane] = (totalByLane[s.lane] ?? 0) + Math.max(0, s.to - s.from);
  }

  const current = spans.find((s) => s.open) ?? null;
  return {
    spans,
    lanes,
    totalByLane,
    current,
    start: spans[0]?.from ?? created,
    end: spans.length ? Math.max(...spans.map((s) => s.to)) : created,
  };
}

/**
 * The lane a ticket spent the most time in, when that is a MAJORITY of its life.
 *
 * A swimlane shows where the time went; this names it, because the whole reason
 * the chart exists is that "eleven days" and "ten of those eleven days in review"
 * are different facts and only the second one tells anybody what to do. Returns
 * null when no single lane dominates — inventing a culprit out of an even spread
 * would be worse than saying nothing.
 */
export function dominantLane(occupancy: LaneOccupancy, threshold = 0.5): { lane: string; ms: number; share: number } | null {
  const total = Object.values(occupancy.totalByLane).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best: { lane: string; ms: number } | null = null;
  for (const [lane, ms] of Object.entries(occupancy.totalByLane)) {
    if (!best || ms > best.ms) best = { lane, ms };
  }
  if (!best) return null;
  const share = best.ms / total;
  return share >= threshold ? { ...best, share } : null;
}
