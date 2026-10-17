/**
 * When and under which period a member_metrics_period snapshot is written.
 *
 * Both snapshot writers (the board scorecard on GET /api/members/metrics and the
 * engagement score on GET /api/members/engagement) run from READ paths. They used
 * to write on every page view, with `periodEnd = now()` to the millisecond, so the
 * upsert's conflict key never matched: each view inserted a fresh row per member,
 * kept the Neon compute awake, and inflated every reader that sums the table
 * (toolDataProviders, SPACE metrics). The natural grain is one snapshot per
 * tenant, window and UTC day: the period is filed under the day, so a re-run the
 * same day upserts the same row, and a read-through-cache marker makes every
 * later view that day write nothing.
 */
import { DAY_MS } from '../../domain/shared/time';
import { firstInWindow } from '../../infrastructure/cache/firstInWindow';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { utcDayStart } from '../llm/tokenUsage';

export type MemberSnapshotKind = 'scorecard' | 'engagement';

/** The marker outlives its UTC day slightly; the day in the key is what rolls it over. */
const SNAPSHOT_MARKER_SECONDS = 26 * 60 * 60;

/** The `days`-wide period ending at the current UTC day — the snapshot's natural key. */
export function memberSnapshotPeriod(days: number, now: Date = new Date()): { periodStart: Date; periodEnd: Date } {
  const periodEnd = utcDayStart(now);
  return { periodStart: new Date(periodEnd.getTime() - days * DAY_MS), periodEnd };
}

/** True for the first snapshot of this kind/tenant/window today; false after it. */
export function claimDailyMemberSnapshot(
  env: CacheEnv,
  kind: MemberSnapshotKind,
  tenantId: number,
  days: number,
  now: Date = new Date(),
): Promise<boolean> {
  const day = utcDayStart(now).toISOString().slice(0, 10);
  return firstInWindow(env, `member-snapshot:${kind}:t${tenantId}:d${days}:${day}`, SNAPSHOT_MARKER_SECONDS);
}
