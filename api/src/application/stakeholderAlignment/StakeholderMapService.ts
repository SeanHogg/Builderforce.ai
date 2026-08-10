import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  stakeholderAlignmentResponses,
  stakeholderAlignmentReviews,
  stakeholderConflicts,
  stakeholderEscalations,
  stakeholderHealthProfiles,
  stakeholderMapEntries,
  stakeholderPrioritySubmissions,
  activityLog,
  projects,
  tenants,
} from '../../infrastructure/database/schema';
import { scopedToSegment, scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  STAKEHOLDER_ALIGNMENT_QUESTIONS,
  type DetectedStakeholderConflict,
  type PrioritySubmissionInput,
  type StakeholderHealthProfileInput,
  type StakeholderResponse,
  type StakeholderReviewState,
} from './stakeholderAlignment.types';

const HOUR_MS = 3_600_000;
const REVIEW_WINDOW_HOURS = 48;

export interface StakeholderMapEntryInput {
  projectId: number;
  initiativeId?: string | null;
  stakeholderRef: string;
  displayName: string;
  role: 'required_approver' | 'informed';
  teamScope?: string | null;
  priority?: string | null;
}

export interface ReviewResponseLike {
  stakeholderRef: string;
  response: StakeholderResponse;
}

export interface EscalationReminderLike {
  id: string;
  deadlineAt: Date;
  reminder24hAt: Date | null;
  reminder4hAt: Date | null;
}

export interface DueEscalationReminder {
  escalationId: string;
  kind: '24h' | '4h' | 'breached';
}

export function scoreStakeholderHealth(answers: StakeholderHealthProfileInput['answers']): number {
  return STAKEHOLDER_ALIGNMENT_QUESTIONS.reduce((score, question) => {
    const answer = answers[question.key];
    if (answer === 'yes') return score + question.weight;
    if (answer === 'unknown') return score + Math.round(question.weight / 2);
    return score;
  }, 0);
}

/** Detect different P0 choices for one team inside the same review window. */
export function detectPriorityConflicts(
  submissions: PrioritySubmissionInput[],
  now = new Date(),
  reviewWindowHours = REVIEW_WINDOW_HOURS,
): DetectedStakeholderConflict[] {
  const cutoff = now.getTime() - reviewWindowHours * HOUR_MS;
  const byTeam = new Map<string, PrioritySubmissionInput[]>();
  for (const submission of submissions) {
    if (submission.submittedAt.getTime() < cutoff) continue;
    const list = byTeam.get(submission.teamScope) ?? [];
    list.push(submission);
    byTeam.set(submission.teamScope, list);
  }

  const conflicts: DetectedStakeholderConflict[] = [];
  for (const [teamScope, teamSubmissions] of byTeam) {
    const priorityKeys = [...new Set(teamSubmissions.map((item) => item.priorityKey))].sort();
    const stakeholderRefs = [...new Set(teamSubmissions.map((item) => item.stakeholderRef))].sort();
    if (priorityKeys.length < 2 || stakeholderRefs.length < 2) continue;
    const windowKey = Math.floor(now.getTime() / (reviewWindowHours * HOUR_MS));
    const signature = `${windowKey}:${teamScope}:${priorityKeys.join('|')}:${stakeholderRefs.join('|')}`.slice(0, 255);
    conflicts.push({
      signature,
      teamScope,
      priorityKeys,
      stakeholderRefs,
      summary: `${stakeholderRefs.length} stakeholders submitted competing P0 priorities (${priorityKeys.join(', ')}) for ${teamScope}.`,
    });
  }
  return conflicts;
}

export function evaluateSignoffState(
  requiredApproverRefs: string[],
  responses: ReviewResponseLike[],
): StakeholderReviewState {
  const current = new Map(responses.map((response) => [response.stakeholderRef, response.response]));
  if (requiredApproverRefs.some((ref) => current.get(ref) === 'block')) return 'blocked';
  if (requiredApproverRefs.length > 0 && requiredApproverRefs.every((ref) => current.has(ref))) return 'approved';
  return 'in_review';
}

export function addBusinessDays(start: Date, days: number): Date {
  const value = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + 1);
    const day = value.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return value;
}

export function dueEscalationReminders(
  rows: EscalationReminderLike[],
  now = new Date(),
): DueEscalationReminder[] {
  const due: DueEscalationReminder[] = [];
  for (const row of rows) {
    const remaining = row.deadlineAt.getTime() - now.getTime();
    if (remaining <= 0) due.push({ escalationId: row.id, kind: 'breached' });
    else if (remaining <= 4 * HOUR_MS && !row.reminder4hAt) due.push({ escalationId: row.id, kind: '4h' });
    else if (remaining <= 24 * HOUR_MS && !row.reminder24hAt) due.push({ escalationId: row.id, kind: '24h' });
  }
  return due;
}

export function buildWeeklyStakeholderDigest(input: {
  approved: number;
  pending: number;
  overdue: number;
  activeConflicts: number;
  openEscalations: number;
  urgent: string[];
}): string {
  const urgent = input.urgent.slice(0, 2);
  const text = [
    `Stakeholder alignment: ${input.approved} approved, ${input.pending} pending, ${input.overdue} overdue; ${input.activeConflicts} active conflicts and ${input.openEscalations} open escalations.`,
    urgent.length ? `Urgent: ${urgent.join(' · ')}` : 'No urgent stakeholder actions.',
  ].join(' ');
  return text.slice(0, 600);
}

export class StakeholderMapService {
  constructor(private readonly db: Db) {}

  async projectExists(tenantId: number, projectId: number): Promise<boolean> {
    const [row] = await this.db.select({ id: projects.id }).from(projects)
      .where(scopedToTenant(projects, tenantId, eq(projects.id, projectId)));
    return Boolean(row);
  }

  async listMap(tenantId: number, segmentId: string, projectId: number) {
    return this.db.select().from(stakeholderMapEntries).where(and(
      eq(stakeholderMapEntries.tenantId, tenantId),
      eq(stakeholderMapEntries.segmentId, segmentId),
      eq(stakeholderMapEntries.projectId, projectId),
      eq(stakeholderMapEntries.active, true),
    )).orderBy(stakeholderMapEntries.role, stakeholderMapEntries.displayName);
  }

  async upsertMapEntry(tenantId: number, segmentId: string, input: StakeholderMapEntryInput) {
    const [row] = await this.db.insert(stakeholderMapEntries).values({
      tenantId,
      segmentId,
      projectId: input.projectId,
      initiativeId: input.initiativeId ?? null,
      stakeholderRef: input.stakeholderRef.trim(),
      displayName: input.displayName.trim(),
      role: input.role,
      teamScope: input.teamScope?.trim() || null,
      priority: input.priority?.trim() || null,
      active: true,
    }).onConflictDoUpdate({
      target: [stakeholderMapEntries.tenantId, stakeholderMapEntries.projectId, stakeholderMapEntries.stakeholderRef],
      set: {
        initiativeId: input.initiativeId ?? null,
        displayName: input.displayName.trim(),
        role: input.role,
        teamScope: input.teamScope?.trim() || null,
        priority: input.priority?.trim() || null,
        active: true,
        updatedAt: new Date(),
      },
    }).returning();
    return row;
  }

  async deactivateMapEntry(tenantId: number, segmentId: string, id: string) {
    const [row] = await this.db.update(stakeholderMapEntries)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(stakeholderMapEntries.id, id),
        eq(stakeholderMapEntries.tenantId, tenantId),
        eq(stakeholderMapEntries.segmentId, segmentId),
      )).returning();
    return row ?? null;
  }

  async saveHealthProfile(
    tenantId: number,
    segmentId: string,
    input: StakeholderHealthProfileInput,
    updatedBy?: string,
  ) {
    const score = scoreStakeholderHealth(input.answers);
    const [row] = await this.db.insert(stakeholderHealthProfiles).values({
      tenantId, segmentId, projectId: input.projectId, answers: input.answers, score, updatedBy: updatedBy ?? null,
    }).onConflictDoUpdate({
      target: [stakeholderHealthProfiles.tenantId, stakeholderHealthProfiles.projectId],
      set: { answers: input.answers, score, updatedBy: updatedBy ?? null, updatedAt: new Date() },
    }).returning();
    return row;
  }

  async getHealthProfile(tenantId: number, segmentId: string, projectId: number) {
    const [row] = await this.db.select().from(stakeholderHealthProfiles).where(scopedToSegment(
      stakeholderHealthProfiles,
      tenantId,
      segmentId,
      eq(stakeholderHealthProfiles.projectId, projectId),
    ));
    return row ?? null;
  }

  async submitPriority(
    tenantId: number,
    segmentId: string,
    projectId: number,
    input: Omit<PrioritySubmissionInput, 'submittedAt'>,
    now = new Date(),
  ) {
    const [submission] = await this.db.insert(stakeholderPrioritySubmissions).values({
      tenantId, segmentId, projectId,
      stakeholderRef: input.stakeholderRef.trim(),
      teamScope: input.teamScope.trim(),
      priorityKey: input.priorityKey.trim(),
      rationale: input.rationale?.trim() || null,
      submittedAt: now,
    }).returning();
    const conflicts = await this.detectAndPersistConflicts(tenantId, segmentId, projectId, now);
    return { submission, conflicts };
  }

  async detectAndPersistConflicts(tenantId: number, segmentId: string, projectId: number, now = new Date()) {
    const cutoff = new Date(now.getTime() - REVIEW_WINDOW_HOURS * HOUR_MS);
    const rows = await this.db.select().from(stakeholderPrioritySubmissions).where(and(
      eq(stakeholderPrioritySubmissions.tenantId, tenantId),
      eq(stakeholderPrioritySubmissions.segmentId, segmentId),
      eq(stakeholderPrioritySubmissions.projectId, projectId),
      gte(stakeholderPrioritySubmissions.submittedAt, cutoff),
    ));
    const conflicts = detectPriorityConflicts(rows.map((row) => ({
      stakeholderRef: row.stakeholderRef,
      teamScope: row.teamScope,
      priorityKey: row.priorityKey,
      rationale: row.rationale ?? undefined,
      submittedAt: row.submittedAt,
    })), now);
    for (const conflict of conflicts) {
      await this.db.insert(stakeholderConflicts).values({
        tenantId, segmentId, projectId, ...conflict,
      }).onConflictDoNothing({
        target: [stakeholderConflicts.tenantId, stakeholderConflicts.projectId, stakeholderConflicts.signature],
      });
    }
    return conflicts;
  }

  async listConflicts(tenantId: number, segmentId: string, projectId: number, status = 'open') {
    return this.db.select().from(stakeholderConflicts).where(and(
      eq(stakeholderConflicts.tenantId, tenantId),
      eq(stakeholderConflicts.segmentId, segmentId),
      eq(stakeholderConflicts.projectId, projectId),
      eq(stakeholderConflicts.status, status),
    )).orderBy(desc(stakeholderConflicts.detectedAt));
  }

  async requestSignoff(
    tenantId: number,
    segmentId: string,
    projectId: number,
    subjectRef: string,
    summary: string,
    createdBy?: string,
    now = new Date(),
  ) {
    const map = await this.listMap(tenantId, segmentId, projectId);
    const requiredApproverRefs = map.filter((entry) => entry.role === 'required_approver').map((entry) => entry.stakeholderRef);
    if (requiredApproverRefs.length === 0) throw new Error('At least one required approver must be configured');
    const [review] = await this.db.insert(stakeholderAlignmentReviews).values({
      tenantId, segmentId, projectId,
      subjectRef: subjectRef.trim(),
      summary: summary.trim(),
      requiredApproverRefs,
      status: 'in_review',
      dueAt: new Date(now.getTime() + REVIEW_WINDOW_HOURS * HOUR_MS),
      createdBy: createdBy ?? null,
    }).returning();
    return review;
  }

  async respondToSignoff(
    tenantId: number,
    segmentId: string,
    reviewId: string,
    stakeholderRef: string,
    response: StakeholderResponse,
    comment?: string,
    now = new Date(),
  ) {
    const [review] = await this.db.select().from(stakeholderAlignmentReviews).where(and(
      eq(stakeholderAlignmentReviews.id, reviewId),
      eq(stakeholderAlignmentReviews.tenantId, tenantId),
      eq(stakeholderAlignmentReviews.segmentId, segmentId),
    ));
    if (!review) return null;
    const required = review.requiredApproverRefs as string[];
    if (!required.includes(stakeholderRef)) throw new Error('Stakeholder is not a required approver');
    if (response === 'block' && !comment?.trim()) throw new Error('A blocker reason is required');

    await this.db.insert(stakeholderAlignmentResponses).values({
      tenantId, reviewId, stakeholderRef, response, comment: comment?.trim() || null, respondedAt: now,
    }).onConflictDoUpdate({
      target: [stakeholderAlignmentResponses.reviewId, stakeholderAlignmentResponses.stakeholderRef],
      set: { response, comment: comment?.trim() || null, respondedAt: now },
    });
    const responses = await this.db.select().from(stakeholderAlignmentResponses)
      .where(scopedToTenant(stakeholderAlignmentResponses, tenantId, eq(stakeholderAlignmentResponses.reviewId, reviewId)));
    const evaluated = evaluateSignoffState(required, responses.map((item) => ({
      stakeholderRef: item.stakeholderRef,
      response: item.response as StakeholderResponse,
    })));
    const status: StakeholderReviewState = evaluated === 'blocked' ? 'escalated' : evaluated;
    await this.db.update(stakeholderAlignmentReviews).set({ status, updatedAt: now })
      .where(scopedToSegment(stakeholderAlignmentReviews, tenantId, segmentId, eq(stakeholderAlignmentReviews.id, reviewId)));

    if (evaluated === 'blocked') {
      await this.db.insert(stakeholderEscalations).values({
        tenantId, segmentId, projectId: review.projectId, reviewId, level: 1,
        status: 'open', deadlineAt: addBusinessDays(now, 3),
      }).onConflictDoNothing({ target: [stakeholderEscalations.reviewId, stakeholderEscalations.level] });
    }
    return { status, responses };
  }

  async claimDueReminders(tenantId: number, now = new Date()) {
    const rows = await this.db.select().from(stakeholderEscalations)
      .where(scopedToTenant(stakeholderEscalations, tenantId, eq(stakeholderEscalations.status, 'open')));
    const reminders = dueEscalationReminders(rows, now);
    for (const reminder of reminders) {
      await this.db.update(stakeholderEscalations).set(
        reminder.kind === '24h' ? { reminder24hAt: now }
          : reminder.kind === '4h' ? { reminder4hAt: now }
            : { status: 'breached' },
      ).where(scopedToTenant(stakeholderEscalations, tenantId, eq(stakeholderEscalations.id, reminder.escalationId)));
    }
    return reminders;
  }

  async dashboard(tenantId: number, segmentId: string, projectId: number, now = new Date()) {
    const [reviews, conflicts, escalations] = await Promise.all([
      this.db.select().from(stakeholderAlignmentReviews).where(and(
        eq(stakeholderAlignmentReviews.tenantId, tenantId), eq(stakeholderAlignmentReviews.segmentId, segmentId), eq(stakeholderAlignmentReviews.projectId, projectId),
      )),
      this.listConflicts(tenantId, segmentId, projectId),
      this.db.select().from(stakeholderEscalations).where(and(
        eq(stakeholderEscalations.tenantId, tenantId), eq(stakeholderEscalations.segmentId, segmentId), eq(stakeholderEscalations.projectId, projectId), eq(stakeholderEscalations.status, 'open'),
      )),
    ]);
    const result = {
      approved: reviews.filter((review) => review.status === 'approved' || review.status === 'agreed').length,
      pending: reviews.filter((review) => ['draft', 'submitted', 'in_review'].includes(review.status)).length,
      overdue: reviews.filter((review) => ['submitted', 'in_review'].includes(review.status) && review.dueAt < now).length,
      activeConflicts: conflicts.length,
      openEscalations: escalations.length,
      urgent: [
        ...conflicts.slice(0, 2).map((conflict) => conflict.summary),
        ...reviews.filter((review) => review.dueAt < now).slice(0, 2).map((review) => `Overdue sign-off: ${review.subjectRef}`),
      ].slice(0, 2),
    };
    return { ...result, digest: buildWeeklyStakeholderDigest(result) };
  }
}

export async function runStakeholderReminderSweep(db: Db, now = new Date()) {
  const workspaces = await db.select({ id: tenants.id }).from(tenants);
  let reminderCount = 0;
  let breached = 0;
  for (const workspace of workspaces) {
    const rows = await db.select().from(stakeholderEscalations)
      .where(scopedToTenant(stakeholderEscalations, workspace.id, eq(stakeholderEscalations.status, 'open')));
    const reminders = dueEscalationReminders(rows, now);
    reminderCount += reminders.length;
    breached += reminders.filter((item) => item.kind === 'breached').length;
    for (const reminder of reminders) {
      const row = rows.find((candidate) => candidate.id === reminder.escalationId);
      if (!row) continue;
      await db.update(stakeholderEscalations).set(
        reminder.kind === '24h' ? { reminder24hAt: now }
          : reminder.kind === '4h' ? { reminder4hAt: now }
            : { status: 'breached' },
      ).where(scopedToTenant(stakeholderEscalations, workspace.id, eq(stakeholderEscalations.id, row.id), eq(stakeholderEscalations.status, 'open')));
      await db.insert(activityLog).values({
        eventKey: `stakeholder:escalation:${row.id}:${reminder.kind}`,
        tenantId: row.tenantId,
        segmentId: row.segmentId,
        projectId: row.projectId,
        actorType: 'system',
        actorRef: 'stakeholder-alignment',
        actorName: 'Stakeholder Alignment',
        verb: reminder.kind === 'breached' ? 'stakeholder.escalation_breached' : 'stakeholder.escalation_reminder',
        targetType: 'stakeholder_review',
        targetId: row.reviewId,
        summary: reminder.kind === 'breached'
          ? `Stakeholder escalation level ${row.level} missed its resolution deadline.`
          : `Stakeholder escalation level ${row.level} is due within ${reminder.kind}.`,
        metadata: { escalationId: row.id, reminder: reminder.kind, deadlineAt: row.deadlineAt.toISOString() },
        occurredAt: now,
      }).onConflictDoNothing({ target: activityLog.eventKey });
    }
  }
  return { reminders: reminderCount, breached };
}

export async function runStakeholderDigestSweep(db: Db, now = new Date()) {
  const workspaces = await db.select({ id: tenants.id }).from(tenants);
  const recipients: Array<typeof stakeholderMapEntries.$inferSelect> = [];
  for (const workspace of workspaces) {
    recipients.push(...await db.select().from(stakeholderMapEntries)
      .where(scopedToTenant(stakeholderMapEntries, workspace.id, eq(stakeholderMapEntries.active, true))));
  }
  const projectKeys = new Map<string, { tenantId: number; segmentId: string; projectId: number }>();
  for (const recipient of recipients) {
    projectKeys.set(`${recipient.tenantId}:${recipient.segmentId}:${recipient.projectId}`, recipient);
  }
  const day = now.toISOString().slice(0, 10);
  let distributed = 0;
  for (const project of projectKeys.values()) {
    const service = new StakeholderMapService(db);
    const dashboard = await service.dashboard(project.tenantId, project.segmentId, project.projectId, now);
    const projectRecipients = recipients.filter((entry) =>
      entry.tenantId === project.tenantId && entry.segmentId === project.segmentId && entry.projectId === project.projectId,
    );
    for (const recipient of projectRecipients) {
      await db.insert(activityLog).values({
        eventKey: `stakeholder:digest:${day}:${project.projectId}:${recipient.stakeholderRef}`.slice(0, 160),
        tenantId: project.tenantId,
        segmentId: project.segmentId,
        projectId: project.projectId,
        actorType: 'system',
        actorRef: 'stakeholder-alignment',
        actorName: 'Stakeholder Alignment',
        verb: 'stakeholder.digest_generated',
        targetType: 'stakeholder',
        targetId: recipient.stakeholderRef,
        targetLabel: recipient.displayName,
        summary: dashboard.digest,
        metadata: { role: recipient.role, projectId: project.projectId },
        occurredAt: now,
      }).onConflictDoNothing({ target: activityLog.eventKey });
      distributed += 1;
    }
  }
  return { projects: projectKeys.size, distributed };
}
