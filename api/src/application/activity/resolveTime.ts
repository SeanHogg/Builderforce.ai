/**
 * Resolve a raw activity-signal stream into billable active-time.
 *
 * The signal stream is the audited "click sense" + engagement record: navigations,
 * tool executions, ticket lane moves, project updates, AI-agent interactions and
 * (paid) meetings, from both the portal and the VSIX. This pure function turns that
 * stream — for ONE engagement, ONE day — into minutes of active time, which becomes
 * a `time_entries` row and rolls up into a timecard.
 *
 * Heuristic ("what did you do today"): sort signals by time; walk consecutive
 * signals and credit the gap between them only while it stays under the idle
 * threshold (a longer gap = the person stepped away). Span signals with an explicit
 * `durationSeconds` (e.g. a scheduled meeting — paid because it is their time) credit
 * their full duration. A lone point signal credits a small minimum so a single action
 * isn't billed as zero. Kept pure + deterministic so it is unit-testable and safe to
 * re-run (resolution is idempotent per engagement/day).
 */

export interface ResolvableSignal {
  id?: number;
  occurredAt: string | Date;
  durationSeconds?: number | null;
  weight?: number | null;
  kind?: string;
}

export interface ResolvedDay {
  minutes: number;
  signalCount: number;
  firstSignalId: number | null;
  lastSignalId: number | null;
}

/** Idle gap (minutes) beyond which time between two signals is NOT credited. */
export const IDLE_GAP_MINUTES = 10;
/** Minimum credit (minutes) for a single point signal with no measurable span. */
const MIN_POINT_MINUTES = 1;

export function resolveActiveMinutes(
  signals: ResolvableSignal[],
  opts: { idleGapMinutes?: number } = {},
): ResolvedDay {
  const idle = opts.idleGapMinutes ?? IDLE_GAP_MINUTES;
  if (signals.length === 0) return { minutes: 0, signalCount: 0, firstSignalId: null, lastSignalId: null };

  const sorted = [...signals].sort((a, b) => ts(a.occurredAt) - ts(b.occurredAt));
  let seconds = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) continue;
    // Explicit spans (meetings, timed sessions) credit their full duration.
    if (cur.durationSeconds && cur.durationSeconds > 0) {
      seconds += cur.durationSeconds;
      continue;
    }
    const next = sorted[i + 1];
    if (next) {
      const gapSec = (ts(next.occurredAt) - ts(cur.occurredAt)) / 1000;
      if (gapSec > 0 && gapSec <= idle * 60) seconds += gapSec;
      else seconds += MIN_POINT_MINUTES * 60; // stepped away — credit only the action itself
    } else {
      seconds += MIN_POINT_MINUTES * 60; // trailing action
    }
  }
  const ids = sorted.map((s) => s.id).filter((id): id is number => typeof id === 'number');
  return {
    minutes: Math.max(0, Math.round(seconds / 60)),
    signalCount: sorted.length,
    firstSignalId: ids.length ? ids[0]! : null,
    lastSignalId: ids.length ? ids[ids.length - 1]! : null,
  };
}

function ts(v: string | Date): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}
