/**
 * Approval/question notification fan-out — the single place that tells humans an
 * agent has bubbled something up.
 *
 * Both entry points share this so a self-hosted approval ([approvalRoutes.ts])
 * and a cloud agent's `ask_human` question ([cloudAgentEngine.ts]) notify the
 * team identically: Slack webhook + email to every manager/owner. (Per-surface
 * delivery — the agentHost relay push, or the cloud execution stream — stays at
 * the call site, since the transport differs.)
 */
import { eq, and, or } from 'drizzle-orm';
import { tenantMembers, users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

interface NotifierEnv {
  SLACK_APPROVAL_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL_FROM?: string;
  APP_URL?: string;
}

export async function sendSlackNotification(webhookUrl: string, text: string): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => { /* best-effort */ });
}

/**
 * Post to an MS Teams Incoming Webhook. Teams' webhook expects a MessageCard (or an
 * Adaptive Card) — we send a compact MessageCard with a title + text. Best-effort,
 * mirroring the Slack sender. `themeColor` tints the card accent (e.g. severity red).
 */
export async function sendTeamsNotification(
  webhookUrl: string,
  title: string,
  text: string,
  themeColor = 'D7263D',
): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor,
      summary: title,
      title,
      text,
    }),
  }).catch(() => { /* best-effort */ });
}

export async function sendEmailNotification(
  apiKey: string,
  from: string,
  to: string[],
  subject: string,
  html: string,
): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch(() => { /* best-effort */ });
}

/** Manager/owner email addresses for a tenant — the notification recipients. */
export async function getManagerEmails(db: Db, tenantId: number): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.isActive, true),
      or(eq(tenantMembers.role, 'manager'), eq(tenantMembers.role, 'owner')),
    ));
  return rows.map((r) => r.email);
}

/**
 * Notify the team that an agent raised a new request that needs a human. One call
 * → Slack + email, both best-effort and both no-ops when their config is unbound.
 * `kind` colours the copy ('question' reads as a blocked agent asking for help;
 * 'approval' as an action awaiting sign-off).
 */
export async function notifyApprovalRequested(
  env: NotifierEnv,
  db: Db,
  args: { tenantId: number; approvalId: string; kind: string; actionType: string; description: string },
): Promise<void> {
  const link = `${env.APP_URL ?? 'https://builderforce.ai'}/approvals/${args.approvalId}`;
  const isQuestion = args.kind === 'question' || args.kind === 'feedback';
  const verb = isQuestion ? 'needs your input' : 'requires your approval';

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    const icon = isQuestion ? ':raising_hand:' : ':bell:';
    await sendSlackNotification(
      env.SLACK_APPROVAL_WEBHOOK_URL,
      `${icon} *An agent ${verb}* (${args.actionType})\n${args.description}\n` +
      `${isQuestion ? 'Answer' : 'Approve or reject'} at: ${link}`,
    );
  }

  if (env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
    const emails = await getManagerEmails(db, args.tenantId);
    if (emails.length > 0) {
      const subject = `[Builderforce] ${isQuestion ? 'An agent needs your input' : 'Approval required'}: ${args.actionType}`;
      const html = `<p>An agent ${verb}.</p>
<ul>
  <li><strong>${isQuestion ? 'Question' : 'Action'}:</strong> ${args.actionType}</li>
  <li><strong>Detail:</strong> ${args.description}</li>
</ul>
<p><a href="${link}">${isQuestion ? 'Answer the agent' : 'Review approval'}</a></p>`;
      await sendEmailNotification(env.RESEND_API_KEY, env.NOTIFICATION_EMAIL_FROM, emails, subject, html);
    }
  }
}
