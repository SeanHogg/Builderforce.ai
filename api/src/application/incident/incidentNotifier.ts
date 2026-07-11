/**
 * incidentNotifier — fan an incident page out to Teams + Slack + email, and log each
 * delivery on the incident timeline.
 *
 * Reuses the house outbound senders (approvalNotifier: Slack webhook, Resend email)
 * and adds MS Teams via the Incoming-Webhook MessageCard sender. Recipients are
 * resolved from assignee-encoded member refs:
 *   • 'u:<userId>'          → the user's email
 *   • 'contact:<id>'        → the business contact's email + their Teams webhook
 *   • 'c:<agentRef>'        → no external channel (the agent is steered via dispatch,
 *                             so this is a timeline note only)
 *
 * Everything is best-effort and no-ops when the relevant env/credential is unbound —
 * exactly like the approval notifier.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { users, businessContacts, incidentEvents } from '../../infrastructure/database/schema';
import { sendSlackNotification, sendTeamsNotification, sendEmailNotification, getManagerEmails } from '../approval/approvalNotifier';
import type { Db } from '../../infrastructure/database/connection';

interface NotifierEnv {
  SLACK_APPROVAL_WEBHOOK_URL?: string;
  TEAMS_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL_FROM?: string;
  APP_URL?: string;
}

export interface IncidentSummary {
  id: string;
  title: string;
  severity: string;
  status: string;
  affectedSystem: string | null;
}

const SEVERITY_COLOR: Record<string, string> = { sev1: 'D7263D', sev2: 'F46036', sev3: 'F4B400', sev4: '2E86DE' };

/** Split member refs into email recipients + Teams webhook URLs (from contacts). */
async function resolveTargets(
  db: Db,
  tenantId: number,
  memberRefs: string[],
): Promise<{ emails: string[]; teamsWebhooks: string[]; labels: string[] }> {
  const userIds: string[] = [];
  const contactIds: string[] = [];
  const labels: string[] = [];
  for (const ref of memberRefs) {
    if (ref.startsWith('u:')) userIds.push(ref.slice(2));
    else if (ref.startsWith('contact:')) contactIds.push(ref.slice('contact:'.length));
    // 'c:<agentRef>' has no external channel.
  }
  const emails: string[] = [];
  const teamsWebhooks: string[] = [];
  if (userIds.length) {
    const rows = await db.select({ email: users.email, name: users.displayName }).from(users).where(inArray(users.id, userIds));
    for (const r of rows) { if (r.email) emails.push(r.email); labels.push(r.name ?? r.email ?? 'user'); }
  }
  if (contactIds.length) {
    const rows = await db.select().from(businessContacts)
      .where(and(eq(businessContacts.tenantId, tenantId), inArray(businessContacts.id, contactIds)));
    for (const r of rows) {
      if (r.email) emails.push(r.email);
      if (r.teamsId && /^https?:\/\//.test(r.teamsId)) teamsWebhooks.push(r.teamsId);
      labels.push(r.name);
    }
  }
  return { emails: [...new Set(emails)], teamsWebhooks: [...new Set(teamsWebhooks)], labels };
}

export interface NotifyIncidentArgs {
  tenantId: number;
  incident: IncidentSummary;
  /** On-call / target member refs to page (u:/contact:/c:). */
  memberRefs: string[];
  /** Escalation level this page corresponds to (0 = initial). */
  level?: number;
  notifyTeams?: boolean;
  notifySlack?: boolean;
  notifyEmail?: boolean;
  /** Extra context line (e.g. "Escalation L2 — unacknowledged for 30m"). */
  note?: string;
}

/**
 * Page an incident to the resolved targets across the enabled channels and record a
 * 'notified' timeline event per channel. Returns the channels actually delivered on.
 */
export async function notifyIncident(env: NotifierEnv, db: Db, args: NotifyIncidentArgs): Promise<string[]> {
  const { incident } = args;
  const link = `${env.APP_URL ?? 'https://builderforce.ai'}/incidents/${incident.id}`;
  const sev = incident.severity.toUpperCase();
  const system = incident.affectedSystem ? ` · ${incident.affectedSystem}` : '';
  const title = `[${sev}] Incident: ${incident.title}`;
  const body = `${args.note ? args.note + '\n' : ''}Status: ${incident.status}${system}\n${link}`;

  const { emails, teamsWebhooks, labels } = await resolveTargets(db, args.tenantId, args.memberRefs);
  const delivered: string[] = [];
  const target = labels.length ? labels.join(', ') : 'on-call';
  const level = args.level ?? 0;

  const logEvent = (channel: string, tgt: string) =>
    db.insert(incidentEvents).values({
      tenantId: args.tenantId, incidentId: incident.id, kind: 'notified',
      actorRef: 'system', channel, target: tgt.slice(0, 255), level,
      message: `Paged ${tgt} via ${channel}`,
    });

  // Teams — the global channel webhook plus any contact-specific webhooks.
  if (args.notifyTeams !== false) {
    const teamsUrls = [...(env.TEAMS_WEBHOOK_URL ? [env.TEAMS_WEBHOOK_URL] : []), ...teamsWebhooks];
    for (const url of teamsUrls) {
      await sendTeamsNotification(url, title, body, SEVERITY_COLOR[incident.severity] ?? 'D7263D');
      delivered.push('teams');
    }
    if (teamsUrls.length) await logEvent('teams', target);
  }

  // Slack — the shared incident/approval webhook.
  if (args.notifySlack !== false && env.SLACK_APPROVAL_WEBHOOK_URL) {
    await sendSlackNotification(env.SLACK_APPROVAL_WEBHOOK_URL, `:rotating_light: *${title}*\n${body}`);
    delivered.push('slack');
    await logEvent('slack', target);
  }

  // Email — resolved recipients, falling back to managers/owners when none resolved.
  if (args.notifyEmail !== false && env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
    const to = emails.length ? emails : await getManagerEmails(db, args.tenantId);
    if (to.length) {
      const html = `<p><strong>${title}</strong></p>${args.note ? `<p>${args.note}</p>` : ''}<ul><li>Status: ${incident.status}</li>${incident.affectedSystem ? `<li>System: ${incident.affectedSystem}</li>` : ''}</ul><p><a href="${link}">Open the incident</a></p>`;
      await sendEmailNotification(env.RESEND_API_KEY, env.NOTIFICATION_EMAIL_FROM, to, title, html);
      delivered.push('email');
      await logEvent('email', to.join(', '));
    }
  }

  return delivered;
}
