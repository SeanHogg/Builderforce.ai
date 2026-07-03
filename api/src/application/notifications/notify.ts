/**
 * Marketplace notifications.
 *
 * Writes an in-app notification row (always) and, when an email webhook is
 * configured, also fires a best-effort transactional email. ONE place every
 * marketplace event (invite/hire/interview/terminate/proposal/timecard/review/paid)
 * routes through, so the recipient always has a durable in-app feed regardless of
 * email config. Best-effort: notification failures never block the triggering action.
 */
import type { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';

type Sql = ReturnType<typeof neon<false, false>>;

export interface NotifyInput {
  userId: string;
  tenantId?: number | null;
  kind: string;
  title: string;
  body?: string | null;
  ref?: string | null;
}

/** Insert an in-app notification for the recipient (+ optional email). */
export async function notify(sql: Sql, env: Pick<Env, 'NOTIFY_EMAIL_URL' | 'NOTIFY_EMAIL_KEY'>, input: NotifyInput): Promise<void> {
  try {
    await sql`
      INSERT INTO freelancer_notifications (user_id, tenant_id, kind, title, body, ref)
      VALUES (${input.userId}, ${input.tenantId ?? null}, ${input.kind}, ${input.title.slice(0, 200)}, ${input.body ?? null}, ${input.ref ?? null})
    `;
  } catch (err) {
    console.warn('[notify] insert failed:', (err as Error)?.message);
  }
  if (env.NOTIFY_EMAIL_URL) {
    try {
      const [u] = await sql`SELECT email FROM users WHERE id = ${input.userId}` as unknown as { email: string }[];
      if (u?.email) {
        await fetch(env.NOTIFY_EMAIL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(env.NOTIFY_EMAIL_KEY ? { authorization: `Bearer ${env.NOTIFY_EMAIL_KEY}` } : {}) },
          body: JSON.stringify({ to: u.email, subject: input.title, body: input.body ?? input.title }),
        });
      }
    } catch (err) {
      console.warn('[notify] email failed:', (err as Error)?.message);
    }
  }
}
