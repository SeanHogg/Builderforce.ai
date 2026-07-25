/**
 * ceremonyNotifier — tell the humans a ceremony is LIVE and they should join.
 *
 * Before this, a scheduled ceremony opened in silence. `runDueCeremonies` created the
 * session and re-armed the cron; the only way to learn your standup had started was to
 * already be looking at the Ceremonies tab, which is exactly the tab you are not looking
 * at when you are about to miss a standup. The attendance record this now produces would
 * have been a record of people never told to come.
 *
 * CHANNELS — deliberately two, not four:
 *   • per-human, via the canonical {@link notify} helper: a durable in-app row ALWAYS,
 *     plus email when `NOTIFY_EMAIL_URL` is bound. That is the product's existing
 *     per-recipient email seam, so this adds no second way to mail a user (a
 *     notify-then-Resend fan-out would double-send for any tenant that configured both).
 *   • one team ping to the Slack webhook, when bound.
 *
 * Both are best-effort and each is a no-op when unconfigured; a notification failure
 * must never prevent a ceremony from opening. Guarded by `ceremony_sessions.notified_at`
 * and `ceremony_participants.notified_at` so a sweep that re-examines a live session can
 * never ping the same room twice.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { ceremonyParticipants, ceremonySessions } from '../../infrastructure/database/schema';
import { notify } from '../notifications/notify';
import { sendSlackNotification } from '../approval/approvalNotifier';
import { isHumanSeat } from './ceremonyAttendance';

/** Deep link to the live round table for a project. */
export function ceremonyLink(env: Env, projectId: number): string {
  return `${resolveAppBaseUrl(env)}/projects?tab=ceremonies&project=${projectId}`;
}

export interface CeremonyInviteResult {
  /** Humans who received an in-app notification (and email, when bound). */
  notified: number;
  /** True when this call was the one that stamped `notified_at` on the session. */
  firstFanOut: boolean;
}

/**
 * Invite every human on a live session's roster to join it.
 *
 * Idempotent twice over: the session-level `notified_at` stamp short-circuits a repeat
 * call, and the per-participant query only selects seats whose own `notified_at` is
 * still null, so a partially-completed fan-out resumes rather than restarting.
 */
export async function notifyCeremonyOpened(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    projectName?: string | null;
    sessionId: string;
    kind: string;
    /** Already-stamped sessions are skipped unless the caller forces a re-send. */
    force?: boolean;
  },
): Promise<CeremonyInviteResult> {
  const now = new Date();

  // Claim the fan-out. The conditional UPDATE is the guard: two concurrent sweep ticks
  // race here, and only the one that actually flips a row from null proceeds.
  const claimed = args.force
    ? [{ id: args.sessionId }]
    : await db
        .update(ceremonySessions)
        .set({ notifiedAt: now, updatedAt: now })
        .where(and(eq(ceremonySessions.id, args.sessionId), isNull(ceremonySessions.notifiedAt)))
        .returning({ id: ceremonySessions.id });
  if (claimed.length === 0) return { notified: 0, firstFanOut: false };

  const seats = await db
    .select({
      id: ceremonyParticipants.id,
      memberKind: ceremonyParticipants.memberKind,
      memberRef: ceremonyParticipants.memberRef,
      memberName: ceremonyParticipants.memberName,
    })
    .from(ceremonyParticipants)
    .where(and(eq(ceremonyParticipants.sessionId, args.sessionId), isNull(ceremonyParticipants.notifiedAt)));

  const humans = seats.filter((s) => isHumanSeat(s.memberKind) && s.memberRef);
  const link = ceremonyLink(env, args.projectId);
  const where = args.projectName ? ` on ${args.projectName}` : '';
  const label = args.kind === 'planning' ? 'Planning' : 'Standup';

  let notified = 0;
  for (const h of humans) {
    try {
      await notify(db, env, {
        userId: h.memberRef,
        tenantId: args.tenantId,
        kind: `ceremony.${args.kind}.started`,
        title: `${label} is starting${where}`,
        body: `Your ${args.kind}${where} is live now. Join the round table: ${link}`,
        ref: args.sessionId,
      });
      await db
        .update(ceremonyParticipants)
        .set({ notifiedAt: now, updatedAt: now })
        .where(eq(ceremonyParticipants.id, h.id));
      notified += 1;
    } catch (err) {
      // Per-recipient isolation: one bad user row must not cost everyone else their invite.
      console.error(`[ceremony:notify] invite failed session=${args.sessionId} user=${h.memberRef}`, err);
    }
  }

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    await sendSlackNotification(
      env.SLACK_APPROVAL_WEBHOOK_URL,
      `:alarm_clock: *${label} is starting${where}* — ${humans.length} invited.\nJoin: ${link}`,
    );
  }

  return { notified, firstFanOut: true };
}

/**
 * Tell an absent owner that their ticket changed hands, AFTER the fact.
 *
 * This is not optional politeness. A reassignment happens while someone is away, which
 * means the person it affects is by construction the one person who did not see it
 * happen — so the notification is the only thing that stops "the manager may reassign
 * stale work" from being indistinguishable from work quietly vanishing off a board.
 */
export async function notifyReassignedAway(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    userId: string;
    sessionId: string;
    kind: string;
    taskKey: string | null;
    taskTitle: string | null;
    agentName: string;
    idleHours: number;
  },
): Promise<void> {
  const ticket = args.taskKey ?? args.taskTitle ?? `task ${args.sessionId}`;
  await notify(db, env, {
    userId: args.userId,
    tenantId: args.tenantId,
    kind: 'ceremony.task.reassigned',
    title: `${ticket} was picked up by ${args.agentName}`,
    body:
      `You weren't at the ${args.kind} and ${ticket} had been idle for about ${args.idleHours}h, ` +
      `so it was handed to ${args.agentName} to keep moving. ` +
      `Take it back any time: ${ceremonyLink(env, args.projectId)}`,
    ref: args.sessionId,
  }).catch((err) => {
    console.error(`[ceremony:notify] reassignment notice failed user=${args.userId}`, err);
  });
}
