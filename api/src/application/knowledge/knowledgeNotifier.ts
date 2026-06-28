/**
 * Knowledge notifications — tell a person when they are invited to collaborate
 * on a page, or assigned a document as training. Reuses the shared Slack/email
 * send primitives from the approval notifier so there is one delivery path.
 *
 * Both channels are best-effort and no-op when their config is unbound, so a
 * tenant without Slack/Resend configured still gets the in-app surfaces.
 */
import { eq, and, inArray } from 'drizzle-orm';
import { tenantMembers, users } from '../../infrastructure/database/schema';
import { sendSlackNotification, sendEmailNotification } from '../approval/approvalNotifier';
import type { Db } from '../../infrastructure/database/connection';

export interface KnowledgeNotifierEnv {
  SLACK_APPROVAL_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL_FROM?: string;
  APP_URL?: string;
}

/** Active-member emails for the given user ids within a tenant (scope guard). */
export async function getUserEmails(db: Db, tenantId: number, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true), inArray(tenantMembers.userId, userIds)));
  return rows.map((r) => r.email);
}

function docLink(env: KnowledgeNotifierEnv, documentId: string): string {
  return `${env.APP_URL ?? 'https://builderforce.ai'}/knowledge/${documentId}`;
}

/** Notify a single user they were invited to collaborate on a page. */
export async function notifyCollaboratorInvited(
  env: KnowledgeNotifierEnv,
  db: Db,
  args: { tenantId: number; documentId: string; title: string; userId: string; role: string },
): Promise<void> {
  const link = docLink(env, args.documentId);
  const roleWord = args.role === 'viewer' ? 'view' : 'collaborate on';

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    await sendSlackNotification(
      env.SLACK_APPROVAL_WEBHOOK_URL,
      `:page_facing_up: *You were invited to ${roleWord} a document*\n*${args.title}*\nOpen it at: ${link}`,
    );
  }
  if (env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
    const emails = await getUserEmails(db, args.tenantId, [args.userId]);
    if (emails.length > 0) {
      await sendEmailNotification(
        env.RESEND_API_KEY,
        env.NOTIFICATION_EMAIL_FROM,
        emails,
        `[Builderforce] You were invited to ${roleWord} “${args.title}”`,
        `<p>You have been invited to ${roleWord} a document.</p>
<ul><li><strong>Document:</strong> ${args.title}</li><li><strong>Access:</strong> ${args.role}</li></ul>
<p><a href="${link}">Open the document</a></p>`,
      );
    }
  }
}

/** Notify users they were assigned a document as training, with an optional due date. */
export async function notifyTrainingAssigned(
  env: KnowledgeNotifierEnv,
  db: Db,
  args: { tenantId: number; documentId: string; title: string; userIds: string[]; dueAt: Date | null },
): Promise<void> {
  const link = docLink(env, args.documentId);
  const due = args.dueAt ? ` (due ${args.dueAt.toISOString().slice(0, 10)})` : '';

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    await sendSlackNotification(
      env.SLACK_APPROVAL_WEBHOOK_URL,
      `:mortar_board: *Training assigned* — *${args.title}*${due}\nRead & acknowledge at: ${link}`,
    );
  }
  if (env.RESEND_API_KEY && env.NOTIFICATION_EMAIL_FROM) {
    const emails = await getUserEmails(db, args.tenantId, args.userIds);
    if (emails.length > 0) {
      await sendEmailNotification(
        env.RESEND_API_KEY,
        env.NOTIFICATION_EMAIL_FROM,
        emails,
        `[Builderforce] Training assigned: “${args.title}”${due}`,
        `<p>You have been assigned a document to read and acknowledge as training.</p>
<ul><li><strong>Document:</strong> ${args.title}</li>${args.dueAt ? `<li><strong>Due:</strong> ${args.dueAt.toISOString().slice(0, 10)}</li>` : ''}</ul>
<p><a href="${link}">Read &amp; acknowledge</a></p>`,
      );
    }
  }
}
