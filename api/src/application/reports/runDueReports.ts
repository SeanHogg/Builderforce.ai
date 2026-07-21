/**
 * Scheduled report dispatcher — the cron consumer that makes report_schedules
 * actually fire. For each due schedule it generates the report via an injected
 * generator (so this stays a pure application-layer sweep, no presentation
 * import) and emails it to the recipients, then advances the next_run_at
 * watermark — even on failure, so a broken schedule can't retry-storm.
 *
 * Wired in the composition root (index.ts) on the frequent cron tick with
 * `buildScheduledReport` (reportRoutes) as the generator. deliveryHour is
 * hour-granular; the ~5-minute tick fires a due digest within minutes of its hour.
 */

import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { reportSchedules } from '../../infrastructure/database/schema';
import { sendReportEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../email/sendEmail';
import type { Env } from '../../env';

/** Bound the per-tick batch so one tenant with many schedules can't run away. */
const MAX_SCHEDULES_PER_TICK = 200;

export interface ScheduleRowForGen {
  reportType: string;
  tenantId: number;
  segmentId: string | null;
}

/** Injected generator: schedule → email-ready report (null = unsupported type). */
export type ScheduledReportGenerator = (
  db: Db,
  schedule: ScheduleRowForGen,
  now: Date,
) => Promise<{ subject: string; report: Record<string, unknown> } | null>;

/** Parse the JSON `recipients` text column into a list of valid-looking emails. */
export function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.includes('@')) : [];
  } catch {
    return [];
  }
}

/**
 * Next fire time strictly after `now` for a daily/weekly/monthly cadence at
 * `deliveryHour` (UTC). Pure + unit-tested. Clamps the hour to [0,23].
 */
export function computeNextRun(schedule: string, deliveryHour: number | null, now: Date): Date {
  const hour = Number.isFinite(deliveryHour) ? Math.min(23, Math.max(0, Math.floor(deliveryHour as number))) : 8;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
  if (schedule === 'monthly') {
    if (next.getTime() <= now.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  const stepDays = schedule === 'weekly' ? 7 : 1;
  while (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + stepDays);
  return next;
}

/** Select due schedules, generate + email each, advance their watermark. */
export async function runDueReports(env: Env, generate: ScheduledReportGenerator): Promise<{ processed: number }> {
  const db = buildDatabase(env);
  const now = new Date();

  const due = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.isEnabled, true), or(isNull(reportSchedules.nextRunAt), lte(reportSchedules.nextRunAt, now))))
    .limit(MAX_SCHEDULES_PER_TICK);

  for (const s of due) {
    try {
      const recipients = parseRecipients(s.recipients);
      if (recipients.length > 0) {
        const built = await generate(db, { reportType: s.reportType, tenantId: s.tenantId, segmentId: s.segmentId }, now);
        if (built) {
          // TRANSACTIONAL: someone configured this schedule, and it stops by
          // deleting the schedule rather than by unsubscribing. Per-recipient
          // locale (no request exists on a cron, so the resolver uses each
          // recipient's stored `users.locale`, then English) — one schedule can
          // therefore fan out to readers in different languages.
          for (const to of recipients) {
            await sendTransactionalEmail(
              env,
              db,
              to,
              ({ locale }) => sendReportEmail(env, to, built.subject, built.report, locale),
            );
          }
        }
      }
    } catch (err) {
      console.error('[cron:reports] generate/send failed', s.id, err);
    }
    // Advance the watermark regardless of success so a failing schedule paces out
    // (it retries on its next cadence, not every tick).
    try {
      await db
        .update(reportSchedules)
        .set({ lastRunAt: now, nextRunAt: computeNextRun(s.schedule, s.deliveryHour, now), updatedAt: now })
        .where(eq(reportSchedules.id, s.id));
    } catch (err) {
      console.error('[cron:reports] watermark update failed', s.id, err);
    }
  }

  return { processed: due.length };
}
