/**
 * A FINISHED CEREMONY'S MINUTES, ON THE BOARD THAT CALLED IT — the use case.
 *
 * ── THE ASYMMETRY THIS CLOSES ───────────────────────────────────────────────
 * The board could START a ceremony and never hear back from one. `startStandup` opens
 * a `ceremony_sessions` row, stamps the card `resourceId: 'ceremony:<id>'` and draws a
 * `joins` edge from every seat — and the minutes, the decisions and the follow-up work
 * then landed on the companion meeting, on `/workforce?tab=meetings`, while the card
 * went on displaying the sentence it was convened with.
 *
 * ── WHEN IT RUNS ────────────────────────────────────────────────────────────
 * Whenever both halves exist — the ceremony has concluded AND its minutes are written —
 * whichever happens second:
 *   • `summarizeMeeting` calls {@link syncMinutesForMeeting} right after it stores the
 *     minutes (a meeting summarized after its ceremony closed);
 *   • `concludeCeremonyMinutes` runs it when a ceremony concludes over minutes that
 *     already exist (or writes the minutes first, which lands back here);
 *   • the stand-up card's "Pull minutes onto the board" act calls the route that runs
 *     {@link syncCeremonyMinutesToCanvas} — the same code, on demand.
 * A still-running ceremony is skipped: its minutes are by construction not final.
 *
 * ── ONE WRITER ──────────────────────────────────────────────────────────────
 * What changes is decided by `applyCeremonyMinutesToBoard` (pure, idempotent); how it
 * is written is `rewriteBoardGraph` (revision+1, lost-race safe, `canvas.changed`).
 * Neither the browser nor a second server path places follow-ups any other way, so a
 * meeting's action items reach a board once no matter how many of the three triggers
 * fire.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  ceremonySessions, creationSessionObjects, creationSessions, meetings, meetingTranscriptSegments,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseMeetingMinutes } from '../../domain/meetings/meetingMinutes';
import { rewriteBoardGraph } from '../canvas/rewriteBoardGraph';
import { applyCeremonyMinutesToBoard, CEREMONY_RESOURCE_TYPE, type CeremonyMinutesBoardResult } from './ceremonyMinutesBoard';

/** The event a minutes write-back appends to a board's timeline. */
export const CEREMONY_MINUTES_EVENT = 'canvas.ceremony_minutes_synced';
/** Who a write-back is attributed to — the same identity that posts minutes to chat. */
const MINUTES_ACTOR = { type: 'agent' as const, ref: 'meeting-notes', userId: null };
/** One retry on a lost revision race: the loser re-reads the newer board and decides again. */
const MAX_ATTEMPTS = 2;

export type MinutesToCanvasOutcome =
  | { status: 'not_found' }
  /** The ceremony is still running — its minutes are not final. */
  | { status: 'still_running' }
  /** The ceremony never had a companion meeting, so nothing was captured. */
  | { status: 'no_meeting' }
  /** There is a transcript but nobody has generated minutes from it yet. */
  | { status: 'not_summarized' }
  /** Nothing was said, so there is nothing to summarize. */
  | { status: 'nothing_captured' }
  | {
    status: 'synced';
    /** Boards holding a card for this ceremony. Zero when none is saved anywhere. */
    boards: number;
    /** Boards actually rewritten (a re-run on unchanged minutes writes none). */
    written: number;
    placed: number;
    updated: number;
    removed: number;
    /** Open action items in the minutes. */
    actionItems: number;
  };

/** Every board in this tenant holding a card for this ceremony. */
async function boardsShowingCeremony(db: Db, tenantId: number, ceremonyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ sessionId: creationSessionObjects.sessionId })
    .from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(scopedToTenant(
      creationSessions, tenantId,
      eq(creationSessionObjects.resourceType, CEREMONY_RESOURCE_TYPE),
      eq(creationSessionObjects.resourceId, ceremonyId),
    ));
  return rows.map((row) => row.sessionId);
}

/** Apply the minutes to one board, retrying once if a concurrent save took the revision. */
async function syncBoard(
  db: Db,
  env: Env,
  args: { tenantId: number; boardId: string; ceremonyId: string; meetingId: string; summary: string; generatedAt: string | null },
): Promise<{ written: boolean; result: CeremonyMinutesBoardResult | null }> {
  const minutes = parseMeetingMinutes(args.summary);
  let last: CeremonyMinutesBoardResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const outcome = await rewriteBoardGraph<CeremonyMinutesBoardResult | null>(db, env, {
      sessionId: args.boardId,
      tenantId: args.tenantId,
      actor: MINUTES_ACTOR,
      eventType: CEREMONY_MINUTES_EVENT,
      operation: `ceremony-minutes:${args.ceremonyId}:${args.boardId}`,
      edit: (graph) => {
        const applied = applyCeremonyMinutesToBoard(graph, {
          ceremonyId: args.ceremonyId,
          minutes,
          generatedAt: args.generatedAt,
          newId: () => crypto.randomUUID(),
        });
        if (!applied || !applied.changed) return { unchanged: applied };
        return {
          graph: applied.graph,
          eventPayload: {
            ceremonyId: args.ceremonyId, meetingId: args.meetingId,
            placed: applied.placed, updated: applied.updated, removed: applied.removed,
          },
          result: applied,
        };
      },
    });
    if (outcome.status === 'missing') return { written: false, result: null };
    last = outcome.result;
    if (outcome.status !== 'conflict') return { written: outcome.status === 'written', result: outcome.result };
  }
  return { written: false, result: last };
}

/**
 * Write a concluded ceremony's minutes back onto every board that holds its card.
 *
 * Every refusal is NAMED — "still running", "no meeting room", "not summarized yet" and
 * "nothing was said" are four different answers for the person who pressed the button.
 */
export async function syncCeremonyMinutesToCanvas(
  db: Db,
  env: Env,
  args: { tenantId: number; ceremonyId: string },
): Promise<MinutesToCanvasOutcome> {
  const [session] = await db
    .select({ id: ceremonySessions.id, status: ceremonySessions.status, meetingId: ceremonySessions.meetingId })
    .from(ceremonySessions)
    .where(scopedToTenant(ceremonySessions, args.tenantId, eq(ceremonySessions.id, args.ceremonyId)))
    .limit(1);
  if (!session) return { status: 'not_found' };
  if (session.status === 'active') return { status: 'still_running' };
  if (!session.meetingId) return { status: 'no_meeting' };

  const [meeting] = await db
    .select({ id: meetings.id, summary: meetings.summary, summaryGeneratedAt: meetings.summaryGeneratedAt })
    .from(meetings)
    .where(scopedToTenant(meetings, args.tenantId, eq(meetings.id, session.meetingId)))
    .limit(1);
  if (!meeting) return { status: 'no_meeting' };
  if (!meeting.summary?.trim()) {
    const [segment] = await db
      .select({ id: meetingTranscriptSegments.id })
      .from(meetingTranscriptSegments)
      .where(scopedToTenant(meetingTranscriptSegments, args.tenantId, eq(meetingTranscriptSegments.meetingId, meeting.id)))
      .limit(1);
    return { status: segment ? 'not_summarized' : 'nothing_captured' };
  }

  const boards = await boardsShowingCeremony(db, args.tenantId, session.id);
  const totals = { written: 0, placed: 0, updated: 0, removed: 0, actionItems: parseMeetingMinutes(meeting.summary).actionItems.filter((item) => !item.done).length };
  for (const boardId of boards) {
    const { written, result } = await syncBoard(db, env, {
      tenantId: args.tenantId,
      boardId,
      ceremonyId: session.id,
      meetingId: meeting.id,
      summary: meeting.summary,
      generatedAt: meeting.summaryGeneratedAt ? meeting.summaryGeneratedAt.toISOString() : null,
    });
    if (written) totals.written += 1;
    if (written && result) {
      totals.placed += result.placed;
      totals.updated += result.updated;
      totals.removed += result.removed;
    }
  }
  return { status: 'synced', boards: boards.length, ...totals };
}

/**
 * The same write-back, keyed by the MEETING whose minutes were just written. Null when
 * the meeting is not a ceremony's companion — an ordinary meeting has no card to update.
 */
export async function syncMinutesForMeeting(
  db: Db,
  env: Env,
  args: { tenantId: number; meetingId: string },
): Promise<MinutesToCanvasOutcome | null> {
  const [session] = await db
    .select({ id: ceremonySessions.id })
    .from(ceremonySessions)
    .where(scopedToTenant(ceremonySessions, args.tenantId, eq(ceremonySessions.meetingId, args.meetingId)))
    .limit(1);
  if (!session) return null;
  return syncCeremonyMinutesToCanvas(db, env, { tenantId: args.tenantId, ceremonyId: session.id });
}
