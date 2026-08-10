import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Marketplace notifications.
 *
 * Writes an in-app notification row (always) and, when an email webhook is
 * configured, also fires a best-effort transactional email. ONE place every
 * marketplace event (invite/hire/interview/terminate/proposal/timecard/review/paid)
 * routes through, so the recipient always has a durable in-app feed regardless of
 * email config. Best-effort: notification failures never block the triggering action.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { freelancerNotifications, users } from '../../infrastructure/database/schema';

export interface NotifyInput {
  userId: string;
  tenantId?: number | null;
  kind: string;
  title: string;
  body?: string | null;
  ref?: string | null;
}

export interface NotifyResult {
  inAppDelivered: boolean;
  emailDelivered: boolean | null;
}

/** Insert an in-app notification for the recipient (+ optional email). */
export async function notify(db: Db, env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>, input: NotifyInput): Promise<NotifyResult> {
  let inAppDelivered = false;
  let emailDelivered: boolean | null = null;
  try {
    await db.insert(freelancerNotifications).values({
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body ?? null,
      ref: input.ref ?? null,
    });
    inAppDelivered = true;
  } catch (err) {
    // Deliberately non-fatal (see docblock), but the drop must not be silent:
    // this row IS the durable feed, so losing it means the recipient never learns
    // of the event by any channel. Log enough to identify which one was lost.
    reportCaughtError(err, { source: "application/notifications/notify.ts", operation: "notify", context: { logMessage: `[notify] in-app notification LOST kind=${input.kind} user=${input.userId}:`, details: (err as Error)?.message } });
  }
  if (env.NOTIFY_EMAIL_URL) {
    emailDelivered = false;
    try {
      const [u] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (u?.email) {
        await fetch(env.NOTIFY_EMAIL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(env.NOTIFY_EMAIL_KEY ? { authorization: `Bearer ${env.NOTIFY_EMAIL_KEY}` } : {}) },
          body: JSON.stringify({ to: u.email, subject: input.title, body: input.body ?? input.title }),
        });
        emailDelivered = true;
      }
    } catch (err) {
      reportCaughtError(err, { source: "application/notifications/notify.ts", operation: "notify", level: 'warning', context: { logMessage: `[notify] email failed kind=${input.kind} user=${input.userId}:`, details: (err as Error)?.message } });
    }
  }
  return { inAppDelivered, emailDelivered };
}
