/**
 * Time tracking (migration 0245) — REAL logged effort per task/member.
 *
 * Two consumers:
 *  1. The planning spine: {@link loggedMinutesByTask} gives authoritative human
 *     cost (minutes × member cost rate), replacing the cycle-time estimate.
 *  2. The member activity chart: {@link computeMemberDailyHours} buckets a
 *     member's logged hours by day (+ recent entries) for the workforce surface.
 *
 * The bucketing math ({@link bucketDailyHours}) is a pure function so it is
 * unit-testable without a DB.
 */

import { and, between, eq, inArray, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, timeEntries } from '../../infrastructure/database/schema';

/** yyyy-mm-dd in UTC (matches the `date` column + the activity-chart buckets). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface TimeEntryRow {
  entryDate: string; // 'yyyy-mm-dd'
  minutes: number;
}

export interface DailyBucket { date: string; hours: number }

/**
 * Bucket logged minutes into one entry per day for the trailing `days` window
 * ending today (inclusive), zero-filling empty days so the chart has a continuous
 * axis. Pure.
 */
export function bucketDailyHours(rows: TimeEntryRow[], days: number, now: Date): DailyBucket[] {
  const minutesByDay = new Map<string, number>();
  for (const r of rows) minutesByDay.set(r.entryDate, (minutesByDay.get(r.entryDate) ?? 0) + r.minutes);

  const out: DailyBucket[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 86_400_000);
    const key = isoDay(d);
    out.push({ date: key, hours: (minutesByDay.get(key) ?? 0) / 60 });
  }
  return out;
}

/** Summed logged minutes per task over a set of task ids (optionally date-bounded
 *  for period reporting). Used by the spine to compute human cost. */
export async function loggedMinutesByTask(
  db: Db,
  tenantId: number,
  taskIds: number[],
  window?: { from: string; to: string },
): Promise<Map<number, number>> {
  if (taskIds.length === 0) return new Map();
  const conds = [eq(timeEntries.tenantId, tenantId), inArray(timeEntries.taskId, taskIds)];
  if (window) conds.push(between(timeEntries.entryDate, window.from, window.to));
  const rows = await db
    .select({ taskId: timeEntries.taskId, minutes: timeEntries.minutes })
    .from(timeEntries)
    .where(and(...conds));
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.taskId, (out.get(r.taskId) ?? 0) + r.minutes);
  return out;
}

export interface MemberTimeEntry {
  id: string;
  taskId: number;
  taskKey: string | null;
  taskTitle: string | null;
  minutes: number;
  entryDate: string;
  source: string;
  note: string | null;
}

export interface MemberDailyHours {
  windowDays: number;
  totalHours: number;
  daily: DailyBucket[];
  entries: MemberTimeEntry[]; // most-recent first, capped
}

const MAX_ENTRIES = 200;

/** A member's daily logged-hours buckets + recent entries (with task labels). */
export async function computeMemberDailyHours(
  db: Db,
  tenantId: number,
  segmentId: string,
  member: { kind: string; ref: string },
  days: number,
  now: number,
): Promise<MemberDailyHours> {
  const since = isoDay(new Date(now - (days - 1) * 86_400_000));
  const rows = await db
    .select({
      id: timeEntries.id, taskId: timeEntries.taskId, minutes: timeEntries.minutes,
      entryDate: timeEntries.entryDate, source: timeEntries.source, note: timeEntries.note,
      taskKey: tasks.key, taskTitle: tasks.title,
    })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(
      eq(timeEntries.tenantId, tenantId),
      eq(timeEntries.segmentId, segmentId),
      eq(timeEntries.memberKind, member.kind),
      eq(timeEntries.memberRef, member.ref),
      gte(timeEntries.entryDate, since),
    ));

  const daily = bucketDailyHours(rows.map((r) => ({ entryDate: r.entryDate, minutes: r.minutes })), days, new Date(now));
  const totalHours = rows.reduce((a, r) => a + r.minutes, 0) / 60;
  const entries: MemberTimeEntry[] = rows
    .sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0))
    .slice(0, MAX_ENTRIES)
    .map((r) => ({
      id: r.id, taskId: r.taskId, taskKey: r.taskKey ?? null, taskTitle: r.taskTitle ?? null,
      minutes: r.minutes, entryDate: r.entryDate, source: r.source, note: r.note ?? null,
    }));

  return { windowDays: days, totalHours, daily, entries };
}
