/**
 * siteTicketBridge — the one place a `site_records` submission turns into a board
 * ticket, and the one place a ticket's Done transition turns back into a message
 * to the person who filed it (0920, R10).
 *
 * BEFORE THIS, growth and delivery did not speak. `site_records` /
 * `site_collections` were referenced from exactly two files (`siteData.ts`,
 * `siteAuth.ts`) and nothing else — a submission to an app's own feedback form
 * landed in a row no ticket, no manager and no agent would ever read, and a
 * shipped fix had no path back to whoever reported it. "The workforce maintains
 * the app" only pays off if the workforce can hear from the people using it.
 *
 * CROSS-DOMAIN BY ID, same shape as `tasks.jobPostingId` (0293): this file reads
 * both `siteRecords`/`siteCollections`/`siteUsers` (growth) and `tasks`
 * (delivery) directly — an application-layer bridge is where that is allowed to
 * happen (mirrors `QaFindingRouter`, which does the same between `qa` and
 * `delivery`). What may NOT happen is either schema module importing the other;
 * `tasks.originSiteRecordId` is a plain, FK-less column for exactly that reason.
 *
 *   {@link raiseTicketForSiteRecord} — the forward leg. Called from
 *   `submitSiteRecord` when the collection has `raisesTickets` set. Opens a task
 *   through the normal `TaskService`, links it back to the record, and fires the
 *   SAME lane-entry funnel every other ticket-creating writer uses
 *   (`onTaskLandedInLane`) — no second dispatch path.
 *
 *   {@link notifySiteRecordTicketDone} — the return leg. Called from
 *   `taskLifecycle.recordStatusTransition` the moment a ticket enters a
 *   done-class lane. Reads the link backwards (task → record → collection →
 *   site → site_user) and emails whoever is reachable — the signed-in
 *   `site_user` if there was one, else the anonymous submission's own `email`.
 *   Best-effort and never throws, for the same reason every other tail call in
 *   that function is best-effort: a notification failure must never fail the
 *   board move that produced it.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { siteCollections, siteRecords, siteUsers, projectSites, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskType } from '../../domain/shared/types';
import { onTaskLandedInLane } from '../swimlane/laneEntryTrigger';
import { sendRawEmail } from '../../infrastructure/email/EmailService';
import { HOSTING_APEX } from './siteHosting';

/** Payload fields checked, in order, for a human-readable summary line. Covers
 *  the field names a "bug report" / "contact us" / "feedback" form is likely to
 *  use without requiring the tenant to name a field anything in particular. */
const SUMMARY_FIELDS = ['message', 'feedback', 'description', 'body', 'issue', 'comment', 'subject', 'title'];

export interface SiteRecordTaskDraft {
  title: string;
  description: string;
}

/**
 * Pure: render a site submission into the ticket's title/description. A
 * best-effort summary field carries the title when the payload has one that
 * looks like free text; otherwise the title just names the collection and
 * submitter so the ticket is still findable.
 */
export function buildSiteRecordTaskDraft(
  collectionName: string,
  payload: Record<string, unknown>,
  email: string | null,
): SiteRecordTaskDraft {
  const summaryField = SUMMARY_FIELDS.find(
    (field) => typeof payload[field] === 'string' && (payload[field] as string).trim().length > 0,
  );
  const summary = summaryField ? (payload[summaryField] as string).trim() : null;
  const title = summary
    ? `[${collectionName}] ${summary}`
    : `[${collectionName}] New submission${email ? ` from ${email}` : ''}`;

  const fields = Object.entries(payload)
    .map(([key, value]) => `- **${key}:** ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
  const description =
    `A visitor submitted the "${collectionName}" form on the app.\n\n` +
    (email ? `**From:** ${email}\n\n` : '') +
    (fields ? `**Submitted fields:**\n${fields}\n` : 'No fields were submitted.\n');

  return { title: title.slice(0, 500), description };
}

export interface RaiseTicketInput {
  tenantId: number;
  projectId: number;
  collectionName: string;
  recordId: number;
  payload: Record<string, unknown>;
  email: string | null;
}

/**
 * Open a board ticket for a site submission and link it back (forward leg).
 * Throws on failure — the caller (`submitSiteRecord`) treats this exactly like
 * the audience-add side effect: the submission has already succeeded and must
 * not be lost because this best-effort step failed, so IT catches, not this.
 */
export async function raiseTicketForSiteRecord(env: Env, db: Db, input: RaiseTicketInput): Promise<number> {
  const draft = buildSiteRecordTaskDraft(input.collectionName, input.payload, input.email);
  const taskService = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  const task = await taskService.createTask(
    { projectId: input.projectId, title: draft.title, description: draft.description, taskType: TaskType.TASK },
    input.tenantId,
  );
  const plain = task.toPlain();
  const taskId = Number(plain.id);

  await db.update(tasks).set({ originSiteRecordId: input.recordId }).where(eq(tasks.id, taskId));

  // A ticket LANDING IN A LANE — route it through the ONE funnel so a staffed,
  // auto-gated lane starts its agent now, same as every other ticket-creating
  // writer (QaFindingRouter, board-sync, the challenge builder).
  await onTaskLandedInLane(env, db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    taskId,
    status: String(plain.status),
    submittedBy: 'system:site-feedback',
  });

  return taskId;
}

/**
 * The return leg: a ticket just entered a done-class lane — if it was RAISED by
 * a site submission, tell whoever filed it. Never throws; every failure is
 * reported and swallowed, matching the other best-effort tails in
 * `recordStatusTransition` (workforce-metrics bump, cache invalidation).
 */
export async function notifySiteRecordTicketDone(env: Env, db: Db, tenantId: number, taskId: number): Promise<void> {
  try {
    const [task] = await db
      .select({ originSiteRecordId: tasks.originSiteRecordId, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task?.originSiteRecordId) return;

    const [record] = await db
      .select({ collectionId: siteRecords.collectionId, email: siteRecords.email, siteUserId: siteRecords.siteUserId })
      .from(siteRecords)
      .where(scopedToTenant(siteRecords, tenantId, eq(siteRecords.id, task.originSiteRecordId)))
      .limit(1);
    if (!record) return;

    const [collection] = await db
      .select({ siteId: siteCollections.siteId, name: siteCollections.name })
      .from(siteCollections)
      .where(scopedToTenant(siteCollections, tenantId, eq(siteCollections.id, record.collectionId)))
      .limit(1);
    if (!collection) return;

    let recipientEmail = record.email;
    if (record.siteUserId) {
      const [user] = await db
        .select({ email: siteUsers.email })
        .from(siteUsers)
        .where(scopedToTenant(siteUsers, tenantId, eq(siteUsers.id, record.siteUserId)))
        .limit(1);
      recipientEmail = user?.email ?? recipientEmail;
    }
    // An anonymous submission with no email captured: nobody to tell, and that
    // is fine — the ticket still closed the loop for every submission that DID
    // carry an identity.
    if (!recipientEmail) return;

    const [site] = await db
      .select({ subdomain: projectSites.subdomain, customDomain: projectSites.customDomain })
      .from(projectSites)
      .where(scopedToTenant(projectSites, tenantId, eq(projectSites.id, collection.siteId)))
      .limit(1);
    const host = site ? (site.customDomain ?? `${site.subdomain}.${HOSTING_APEX}`) : null;
    const appName = host ?? collection.name;

    await sendRawEmail(env as Parameters<typeof sendRawEmail>[0], {
      to: recipientEmail,
      subject: `Update on what you sent to ${appName}`,
      html: [
        '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">',
        `<p>Good news — what you submitted to <strong>${appName}</strong> (${collection.name}) has been resolved:</p>`,
        `<p style="font-weight:600">${task.title ?? ''}</p>`,
        host ? `<p><a href="https://${host}">Visit ${appName}</a></p>` : '',
        '</div>',
      ].join(''),
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/ide/siteTicketBridge.ts', operation: 'notifySiteRecordTicketDone' });
  }
}
