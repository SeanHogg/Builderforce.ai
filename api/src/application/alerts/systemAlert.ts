import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Raise a SYSTEM alert — one the platform fires on its own evidence (a containment stop,
 * a spend spike, a run cost outlier, a run anomaly), not a user-defined threshold rule.
 *
 * Same lifecycle and the same channels as a rule firing: one `alert_events` row (with no
 * `alert_id`) plus the shared Slack + email notify (`notifyAlert`). What a system alert
 * adds is a COOLDOWN keyed on (tenant, metric, subject): a rule carries its own
 * `last_triggered_at`, a system alert has no rule row, so the event log itself is the
 * cooldown record — "did this subject already fire this metric inside the window?".
 *
 * Best-effort end to end: a failed read, notify or insert is reported and swallowed, so a
 * caller on a run's hot path (the containment stop) can never fail because of it.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { alertEvents } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { HOUR_MS } from '../../domain/shared/time';
import { notifyAlert } from './runAlertSweep';

/** The system-alert metrics this module raises (`alert_events.metric`, varchar(40)). */
export const SYSTEM_ALERT_METRICS = {
  containmentStop: 'containment_stop',
  spendSpike: 'cost_daily_spend_spike',
  runCostOutlier: 'cost_run_outlier',
  runAnomaly: 'run_anomaly',
  evalDrift: 'eval_drift',
} as const;
export type SystemAlertMetric = (typeof SYSTEM_ALERT_METRICS)[keyof typeof SYSTEM_ALERT_METRICS];

export interface SystemAlert {
  tenantId: number;
  metric: SystemAlertMetric;
  message: string;
  observedValue?: number | null;
  threshold?: number | null;
  /** What the alert is ABOUT, when it is about one thing (a run): kind + ref. */
  subjectKind?: 'object' | 'tenant' | null;
  subjectRef?: string | null;
  severity?: 'low' | 'medium' | 'high';
  /** Suppress a repeat for the same (tenant, metric, subject) inside this window. */
  cooldownHours: number;
}

export type SystemAlertOutcome = 'raised' | 'cooldown' | 'failed';

async function firedWithinCooldown(db: Db, a: SystemAlert, now: number): Promise<boolean> {
  const since = new Date(now - Math.max(0, a.cooldownHours) * HOUR_MS);
  const [prior] = await db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(scopedToTenant(alertEvents, a.tenantId, and(
      eq(alertEvents.metric, a.metric),
      a.subjectRef ? eq(alertEvents.subjectRef, a.subjectRef) : isNull(alertEvents.subjectRef),
      gte(alertEvents.createdAt, since),
    )))
    .orderBy(desc(alertEvents.createdAt))
    .limit(1);
  return prior != null;
}

export async function raiseSystemAlert(env: Env, db: Db, a: SystemAlert, now: number = Date.now()): Promise<SystemAlertOutcome> {
  try {
    if (await firedWithinCooldown(db, a, now)) return 'cooldown';
    let notified = { slack: false, email: false };
    try {
      notified = await notifyAlert(env, db, { tenantId: a.tenantId, message: a.message, notifySlack: true, notifyEmail: true });
    } catch (error) {
      reportCaughtError(error, { source: 'application/alerts/systemAlert.ts', operation: 'raiseSystemAlert', context: { details: { metric: a.metric, tenantId: a.tenantId } } });
    }
    await db.insert(alertEvents).values({
      tenantId: a.tenantId,
      metric: a.metric,
      observedValue: a.observedValue ?? null,
      threshold: a.threshold ?? null,
      message: a.message,
      notifiedSlack: notified.slack,
      notifiedEmail: notified.email,
      subjectKind: a.subjectKind ?? null,
      subjectRef: a.subjectRef ?? null,
      severity: a.severity ?? 'medium',
    });
    return 'raised';
  } catch (error) {
    reportCaughtError(error, { source: 'application/alerts/systemAlert.ts', operation: 'raiseSystemAlert', context: { details: { metric: a.metric, tenantId: a.tenantId } } });
    return 'failed';
  }
}
