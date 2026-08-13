/**
 * "When is this set of people free?" — the one implementation.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────
 * `availabilitySolver.ts` is pure arithmetic over windows and busy intervals: it does
 * not know what a meeting is or where declared working hours are stored. Everything
 * that DID know — load the windows, load the busy blocks from scheduled meetings, merge
 * in external calendar free/busy, hand all three to the solver — lived as closures
 * inside `createMeetingRoutes`, which is why the solver had exactly one consumer despite
 * being finished, generic and correct.
 *
 * Candidate self-scheduling needs the identical composition against the identical data,
 * and a second copy of it would be two implementations of "is this person free" that
 * drift the first time one of them learns about a new busy source. So the composition
 * moves to the application layer, the meeting routes call it, and the booking flow calls
 * it — which is the whole reason the recruiter's largest time sink was *not shipped*
 * rather than *not built*.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { meetingAttendees, meetings, userAvailability } from '../../infrastructure/database/schema';
import { loadExternalBusy, mergeBusy } from './calendarFreeBusy';
import { normalizeWindows, suggestSlots, type Availability, type BusyInterval } from './availabilitySolver';
import type { Env } from '../../env';

/** A person with no declared windows is available anytime — the solver's own rule. */
const DEFAULT_TZ = 'UTC';

/** Declared working hours for a set of refs. Missing rows mean "available anytime". */
export async function loadDeclaredAvailability(
  db: Db,
  tenantId: number,
  refs: readonly string[],
): Promise<Availability[]> {
  if (refs.length === 0) return [];
  const rows = await db.select().from(userAvailability).where(and(
    eq(userAvailability.tenantId, tenantId),
    inArray(userAvailability.userId, refs as string[]),
  ));
  const byUser = new Map(rows.map((row) => [row.userId, row] as const));
  return refs.map((userId) => {
    const row = byUser.get(userId);
    return { userId, timezone: row?.timezone ?? DEFAULT_TZ, windows: normalizeWindows(row?.windows) };
  });
}

/** Busy intervals from meetings this platform already scheduled, in epoch ms. */
export async function loadMeetingBusy(
  db: Db,
  tenantId: number,
  refs: readonly string[],
  fromMs: number,
  toMs: number,
): Promise<Map<string, BusyInterval[]>> {
  const out = new Map<string, BusyInterval[]>();
  if (refs.length === 0) return out;
  const rows = await db
    .select({ ref: meetingAttendees.memberRef, scheduledAt: meetings.scheduledAt, duration: meetings.durationMinutes })
    .from(meetingAttendees)
    .innerJoin(meetings, eq(meetings.id, meetingAttendees.meetingId))
    .where(and(
      eq(meetings.tenantId, tenantId),
      inArray(meetingAttendees.memberRef, refs as string[]),
      inArray(meetings.status, ['scheduled', 'live']),
      gte(meetings.scheduledAt, new Date(fromMs)),
      lte(meetings.scheduledAt, new Date(toMs)),
    ));
  for (const row of rows) {
    if (!row.scheduledAt) continue;
    const start = row.scheduledAt.getTime();
    const list = out.get(row.ref) ?? [];
    list.push({ start, end: start + (row.duration ?? 30) * 60_000 });
    out.set(row.ref, list);
  }
  return out;
}

/** Every busy source merged: this platform's meetings plus connected calendars. */
export async function loadAllBusy(
  db: Db,
  env: Env,
  tenantId: number,
  refs: readonly string[],
  fromMs: number,
  toMs: number,
): Promise<Map<string, BusyInterval[]>> {
  const [appBusy, externalBusy] = await Promise.all([
    loadMeetingBusy(db, tenantId, refs, fromMs, toMs),
    loadExternalBusy(db, env, tenantId, refs as string[], fromMs, toMs),
  ]);
  return mergeBusy(appBusy, externalBusy);
}

export interface ProposeSlotsOptions {
  fromMs: number;
  toMs: number;
  durationMinutes: number;
  count?: number;
  stepMinutes?: number;
}

/**
 * Slots where EVERY ref is free and within their declared window.
 *
 * One round of reads regardless of how many people are on the panel: availability and
 * both busy sources are each a single `inArray` query, not a query per attendee. That
 * matters more here than it looks — an interview loop is routinely four or five
 * interviewers, and the per-attendee shape is a fan-out that grows with the panel.
 */
export async function proposeSlots(
  db: Db,
  env: Env,
  tenantId: number,
  refs: readonly string[],
  opts: ProposeSlotsOptions,
): Promise<Array<{ startISO: string; endISO: string }>> {
  if (refs.length === 0) return [];
  const [availability, busy] = await Promise.all([
    loadDeclaredAvailability(db, tenantId, refs),
    loadAllBusy(db, env, tenantId, refs, opts.fromMs, opts.toMs),
  ]);
  return suggestSlots(availability, busy, {
    fromMs: opts.fromMs,
    toMs: opts.toMs,
    durationMinutes: opts.durationMinutes,
    ...(opts.count === undefined ? {} : { count: opts.count }),
    ...(opts.stepMinutes === undefined ? {} : { stepMinutes: opts.stepMinutes }),
  });
}
