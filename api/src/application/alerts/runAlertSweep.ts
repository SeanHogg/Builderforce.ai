/**
 * Alert sweep — the scheduled evaluator for user-defined threshold alert rules.
 *
 * Runs on the daily cron. For every ENABLED alert rule it computes the observed
 * value (via {@link evaluateMetric}, which reuses the existing metric collectors),
 * stamps last_evaluated_at, and — when the comparator trips AND the cooldown has
 * elapsed — raises an alert_event and notifies the team over the shared Slack +
 * email channels (the same approvalNotifier helpers approvals/questions use).
 *
 * Best-effort + isolated: every per-tenant / per-alert step is wrapped so one
 * failing rule (or one tenant's bad data) can never abort the rest of the sweep,
 * and a notification failure never blocks the event row being written.
 */

import { and, eq } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { alerts, alertEvents, type AlertMetric } from '../../infrastructure/database/schema';
import { evaluateMetric } from './metricEvaluators';
import {
  sendSlackNotification,
  sendEmailNotification,
  getManagerEmails,
} from '../approval/approvalNotifier';
import type { Env } from '../../env';

export type Comparator = 'gt' | 'lt' | 'gte' | 'lte';

/** Pure comparator predicate — does `value <comparator> threshold` hold? Unknown
 *  comparators are treated as no-match (a rule never fires on a bad operator). */
export function comparatorMatches(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case 'gt':  return value > threshold;
    case 'lt':  return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    default:    return false;
  }
}

/** Has the rule's cooldown elapsed since it last fired? Null lastTriggeredAt =
 *  never fired = eligible. Pure for unit testing. */
export function cooldownElapsed(lastTriggeredAt: Date | null, cooldownHours: number, now: number): boolean {
  if (lastTriggeredAt == null) return true;
  return now - lastTriggeredAt.getTime() >= Math.max(0, cooldownHours) * 3_600_000;
}

/** Human-readable comparator phrase for the alert message. */
const COMPARATOR_PHRASE: Record<Comparator, string> = {
  gt: 'is above', lt: 'is below', gte: 'is at or above', lte: 'is at or below',
};

/** Friendly metric labels for the message copy. */
const METRIC_LABEL: Record<AlertMetric, string> = {
  token_spend_usd:          'Token spend (USD)',
  token_spend_pct_of_cap:   'Token usage (% of cap)',
  cost_per_merged_pr_usd:   'Cost per merged PR (USD)',
  dora_change_failure_rate: 'DORA change-failure rate (%)',
  dora_lead_time_hours:     'DORA lead time (hours)',
  ai_effectiveness_score:   'AI effectiveness score',
  eval_drift:               'Eval drift (drifting groups)',
};

/** Build the alert message a fired rule carries (Slack/email + event row). */
export function buildAlertMessage(
  name: string,
  metric: AlertMetric,
  comparator: string,
  observed: number,
  threshold: number,
): string {
  const label = METRIC_LABEL[metric] ?? metric;
  const phrase = COMPARATOR_PHRASE[comparator as Comparator] ?? comparator;
  return `Alert "${name}": ${label} ${phrase} the threshold (observed ${round(observed)}, threshold ${round(threshold)}).`;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Notify the team that an alert fired. Slack + email, both best-effort, both
 * gated on the rule's notify flags AND the env being configured. Returns which
 * channels were actually attempted (for the event's notified_* flags).
 */
export async function notifyAlert(
  env: Env,
  db: Db,
  args: { tenantId: number; message: string; notifySlack: boolean; notifyEmail: boolean },
): Promise<{ slack: boolean; email: boolean }> {
  let slack = false;
  let email = false;
  const link = `${env.APP_URL ?? 'https://builderforce.ai'}/alerts`;

  if (args.notifySlack && env.SLACK_APPROVAL_WEBHOOK_URL) {
    await sendSlackNotification(env.SLACK_APPROVAL_WEBHOOK_URL, `:rotating_light: ${args.message}\nView alerts: ${link}`);
    slack = true;
  }
  if (args.notifyEmail && env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
    const emails = await getManagerEmails(db, args.tenantId);
    if (emails.length > 0) {
      const html = `<p>${escapeHtml(args.message)}</p><p><a href="${link}">View alerts</a></p>`;
      await sendEmailNotification(env.RESEND_API_KEY, env.NOTIFICATION_EMAIL_FROM, emails, '[Builderforce] Alert triggered', html);
      email = true;
    }
  }
  return { slack, email };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Evaluate every enabled alert rule across all tenants and fire the ones that
 * trip. Called from the daily cron branch in index.ts.
 */
export async function runAlertSweep(env: Env): Promise<void> {
  const db = buildDatabase(env);
  const now = Date.now();

  const rules = await db.select().from(alerts).where(eq(alerts.enabled, true));

  for (const rule of rules) {
    try {
      const { value } = await evaluateMetric(db, env, {
        tenantId: rule.tenantId,
        metric: rule.metric as AlertMetric,
        scopeKind: rule.scopeKind,
        projectId: rule.projectId,
        teamId: rule.teamId,
        windowDays: rule.windowDays,
      });

      // Always record that we looked.
      await db.update(alerts).set({ lastEvaluatedAt: new Date(now) }).where(eq(alerts.id, rule.id));

      if (value == null) continue; // uncomputable scope → skip (never fire on a gap)
      if (!comparatorMatches(value, rule.comparator, rule.threshold)) continue;
      if (!cooldownElapsed(rule.lastTriggeredAt, rule.cooldownHours, now)) continue;

      const message = buildAlertMessage(rule.name, rule.metric as AlertMetric, rule.comparator, value, rule.threshold);

      let notified = { slack: false, email: false };
      try {
        notified = await notifyAlert(env, db, {
          tenantId: rule.tenantId,
          message,
          notifySlack: rule.notifySlack,
          notifyEmail: rule.notifyEmail,
        });
      } catch (err) {
        console.error(`[cron:alerts] notify failed alert=${rule.id}`, err);
      }

      await db.insert(alertEvents).values({
        alertId: rule.id,
        tenantId: rule.tenantId,
        metric: rule.metric,
        observedValue: value,
        threshold: rule.threshold,
        comparator: rule.comparator,
        message,
        notifiedSlack: notified.slack,
        notifiedEmail: notified.email,
      });

      await db.update(alerts).set({ lastTriggeredAt: new Date(now) }).where(eq(alerts.id, rule.id));
    } catch (err) {
      console.error(`[cron:alerts] alert=${rule.id} tenant=${rule.tenantId} failed`, err);
    }
  }
}
