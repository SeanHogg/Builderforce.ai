/**
 * The minutes half of concluding a ceremony.
 *
 * Ending a meeting through `POST /meetings/:id/end` has always written its minutes; ending
 * the SAME meeting by concluding its ceremony (`concludeCeremonySession` → `endCeremonyMeeting`)
 * did not, so a stand-up closed from the round table never got minutes unless someone went
 * to the meetings tab and asked for them — and so never reached the board that called it.
 *
 * Kept out of `concludeCeremony.ts` because it reaches into the meetings context
 * (`summarizeMeeting`), and out of `ceremonyMinutesToCanvas.ts` because `summarizeMeeting`
 * itself calls that module — the dependency runs meetings → canvas write-back, never back.
 *
 * Best-effort: a ceremony that concluded is concluded whether or not its minutes could be
 * written, so every failure is reported and swallowed.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { meetings } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { summarizeMeeting } from '../meetings/meetingIntelligence';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { syncCeremonyMinutesToCanvas } from './ceremonyMinutesToCanvas';

export async function concludeCeremonyMinutes(
  db: Db,
  env: Env,
  session: { id: string; tenantId: number; meetingId: string | null; status: string },
): Promise<void> {
  // An abandoned ceremony (nobody attended) has nothing to minute, and an active one is
  // not concluded — the caller passes the session as it was written, not as it was read.
  if (session.status !== 'completed' || !session.meetingId) return;
  try {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(scopedToTenant(meetings, session.tenantId, eq(meetings.id, session.meetingId)))
      .limit(1);
    if (!meeting) return;
    if (!meeting.summary?.trim()) {
      // Writing the minutes lands back in the canvas write-back by itself
      // (`summarizeMeeting` → `syncMinutesForMeeting`). No transcript is an honest no-op.
      await summarizeMeeting(db, env, meeting);
      return;
    }
    await syncCeremonyMinutesToCanvas(db, env, { tenantId: session.tenantId, ceremonyId: session.id });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/ceremony/concludeCeremonyMinutes.ts',
      operation: 'concludeCeremonyMinutes',
      context: { details: { sessionId: session.id, meetingId: session.meetingId } },
    });
  }
}
