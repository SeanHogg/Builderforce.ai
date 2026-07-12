// Deadline Targets Domain Service - Inference: business logic (status computation, reminders, summary, export), not DB layer

import type {
  CreateDeadlineTargetRequest,
  DeadlineTarget,
  DeadlineTargetFilters,
  DeadlineStatus,
  DeadlineTargetAssociation,
  DeadlineTargetAudits,
  DeadlineTargetSummary,
  DeadlineTargetExportRow,
  ReminderSchedule,
  UpdateDeadlineTargetRequest,
  OwnerKind,
} from '@/types/deadline-targets';
import { DEFAULT_REMINDER_SCHEDULES, WARNING_THRESHOLD_MS, REMINDER_INTERVALS, REMINDER_TYPES } from '@/types/deadline-targets';
import { v4 as uuidv4 } from 'uuid';

export interface ReminderRegistry {
  getUserId: () => string;
  registerReminder: (type: string, deadlineId: string, targetDate: number, title: string) => Promise<void>;
  updateReminderLastSent: (type: string, deadlineId: string, timestamp: number, subject: string) => Promise<void>;
  getReminderSchedulesForUser: () => Promise<Record<string, ReminderSchedule>>;
  sendInAppNotification: (userId: string, type: string, deadlineId: string, deadlineName: string, message: string) => Promise<void>;
  sendEmail: (userId: string, to: string, subject: string, body: string) => Promise<void>;
}

const DTYPE = 'DeadlineTarget';

/**
 * Status computation constants
 */
const CURRENT_STATUS_COMPARISON_INTERVAL_MS = 24 * 60 * 60 * 1000 * 30; // 30 days window to consider as "current" status
const MIN_HEALTH_SCORE = 0;
const MAX_HEALTH_SCORE = 100;

/**
 * Factory: create a new Deadline Target entity from request
 */
export function createDeadlineTarget(
  request: CreateDeadlineTargetRequest,
  tenantId: number,
  projectId: number | null = null,
  currentTimestamp: number = Date.now()
): DeadlineTarget {
  const id = uuidv4();
  const nowMs = currentTimestamp;

  // Compute health score: 0% initially (no linked tasks assumed)
  const watchers: DeadlineTarget['watchers'] = [];
  const associations: DeadlineTargetAssociation[] = (request.associations || []).map((assoc) => ({
    entityType: assoc.entityType,
    entityId: assoc.entityId,
    linkedAt: nowMs,
    source: 'owner_initiated',
  }));

  const audit: DeadlineTargetAudits = [
    {
      id: uuidv4(),
      timestamp: nowMs,
      actorRef: 'system',
      action: 'create',
      auditType: 'creation',
      oldValue: undefined,
      newValue: undefined,
    },
  ];

  const mgrId = await getManagerId(tenantId, projectId);
  const manager = await getManagerUser(mgrId);
  if (!manager) {
    throw new Error(`Manager with userId ${mgrId} not found for tenant ${tenantId}, project ${projectId}`);
  }

  return {
    id,
    tenantId,
    projectId,
    name: request.name,
    type: request.type,
    targetDate: request.targetDate,
    targetDateTz: request.targetDateTz,
    ownerId: request.ownerId,
    ownerKind: request.ownerId.startsWith('u_') ? 'user' : 'team',
    status: 'On Track',
    isManualOverride: false,
    description: request.description,
    priority: request.priority,
    externalReference: request.externalReference,
    confidential: request.confidential ?? false,
    healthScore: 0,
    watchers,
    associations,
    audit,
    createdAt: nowMs,
    updatedAt: nowMs,
    completedAt: undefined,
  };
}

/**
 * Factory: compute status from target date and current date + dependencies
 */
export function computeStatus(
  deadline: DeadlineTarget,
  now: number,
  overrideStatus?: DeadlineStatus,
  overrideReason?: string
): { status: DeadlineStatus; reason?: string } {
  const hasOverride = overrideStatus !== undefined;
  if (hasOverride) {
    return {
      status: overrideStatus,
      reason: overrideReason,
    };
  }

  const targetDateMs = deadline.targetDate;
  const diffMs = targetDateMs - now;

  // Completed takes precedence (owner or linked work item reached terminal state)
  if (deadline.status === 'Completed') {
    return { status: 'Completed' };
  }

  // Overdue: target date has passed
  if (targetDateMs < now) {
    return { status: 'Overdue' };
  }

  // At Risk: within warning threshold AND not fully complete (simplified as checking watchers/statusReason)
  if (diffMs <= WARNING_THRESHOLD_MS && diffMs > 0) {
    // Remaining conditions: open dependencies or low completion (simplified to watching + override statusReason)
    if (deadline.watchers.length > 0 || (deadline.status === 'At Risk' && !deadline.statusReason)) {
      return { status: 'At Risk', reason: 'Target date approaching with dependencies' };
    }
  }

  // On Track: future date, no blockers
  return { status: 'On Track' };
}

/**
 * Factory: compute health score from associations count
 */
export function computeHealthScore(deadline: DeadlineTarget): number {
  // Simplified health: percentage of associations considered "linked tasks"
  // A true implementation would link to tasks table and compute based on task completion
  const totalLinked = deadline.associations.length;
  const completedLinked = deadline.associations.length; // All associations count as completed for now
  const score = totalLinked === 0 ? 0 : Math.round((completedLinked / totalLinked) * 100);

  return Math.max(MIN_HEALTH_SCORE, Math.min(MAX_HEALTH_SCORE, score));
}

/**
 * Apply updates to a deadline target
 */
export function updateDeadlineTarget(
  deadline: DeadlineTarget,
  updates: UpdateDeadlineTargetRequest,
  actorRef: string,
  auditType: DeadlineTargetAudits[number]['auditType'],
  reason?: string
): DeadlineTarget {
  const nowMs = Date.now();

  if (updates.name !== undefined) {
    deadline.name = updates.name;
    recordAudit(deadline, actorRef, 'update', 'name', deadline.name, updates.name, auditType, reason);
  }

  if (updates.targetDate !== undefined) {
    deadline.targetDate = updates.targetDate;
    recordAudit(deadline, actorRef, 'update', 'targetDate', deadline.targetDate, updates.targetDate, auditType, reason);
  }

  if (updates.description !== undefined) {
    deadline.description = updates.description;
    recordAudit(deadline, actorRef, 'update', 'description', deadline.description, updates.description, auditType, reason);
  }

  if (updates.priority !== undefined) {
    deadline.priority = updates.priority;
    recordAudit(deadline, actorRef, 'update', 'priority', deadline.priority, updates.priority, auditType, reason);
  }

  if (updates.externalReference !== undefined) {
    deadline.externalReference = updates.externalReference;
    recordAudit(deadline, actorRef, 'update', 'externalReference', deadline.externalReference, updates.externalReference, auditType, reason);
  }

  if (updates.status !== undefined) {
    const prevStatus = deadline.status;
    deadline.status = updates.status.status;
    deadline.isManualOverride = !reason; // If reason provided, treat as override
    deadline.statusReason = reason;
    recordAudit(deadline, actorRef, 'status_change', undefined, prevStatus, deadline.status, auditType, 'status_override: ' + reason);
  }

  // Compute new status if it's the computed status type
  if (deadline.status !== 'Completed' && !deadline.isManualOverride) {
    const { status: newStatus, reason } = computeStatus(deadline, Date.now());
    if (newStatus !== deadline.status) {
      deadline.status = newStatus;
      deadline.statusReason = reason;
      recordAudit(deadline, actorRef, 'status_change', undefined, prevStatus, deadline.status, auditType, reason);
    }
  }

  deadline.updatedAt = nowMs;

  return deadline;
}

/**
 * Run reminders for a deadline target
 */
export function scheduleReminders(
  deadline: DeadlineTarget,
  reminderRegistry: ReminderRegistry,
  currentDate: Date = new Date()
): Promise<void> {
  const nowMs = currentDate.getTime();
  const targetDateMs = deadline.targetDate;

  // Sanity check: associate reminder schedules stored with user config
  const userReminderSchedules = await reminderRegistry.getReminderSchedulesForUser();
  const globalSchedules = DEFAULT_REMINDER_SCHEDULES;

  for (const reminderType of REMINDER_TYPES) {
    const schedule: ReminderSchedule | undefined = userReminderSchedules?.[reminderType] || globalSchedules[reminderType];
    if (!schedule?.active) continue; // not enabled for user or target

    const msBeforeTarget = REMINDER_INTERVALS[reminderType];
    const reminderDueAtMs = targetDateMs - msBeforeTarget;

    if (nowMs >= reminderDueAtMs && nowMs <= reminderDueAtMs + 24 * 60 * 60 * 1000) {
      // Slight window (1 day) for last-sent deduplication
      // In a real DB, you'd store last_sent_at and check if too soon to re-send
      const title = `Reminder: ${deadline.name}`;
      const message = `Reminder: ${reminderType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())} before target date.`;

      const reminderKey = `${deadline.id}_${reminderType}`;
      await reminderRegistry.registerReminder(reminderType, deadline.id, deadline.targetDate, title);
      await reminderRegistry.sendInAppNotification(deadline.ownerId, reminderType, deadline.id, deadline.name, message);
      logger().debug(`${DTYPE}[${deadline.id}] Scheduled reminder: ${reminderType} (${reminderType}`); // Intentionally not logged in summary

      if (schedule.lastSentAt && nowMs - schedule.lastSentAt < 24 * 60 * 60 * 1000) {
        logger().debug(`${DTYPE}[${deadline.id}] Skipped reminder: ${reminderType} (sent ${Date.now() - schedule.lastSentAt}ms ago)`);
        continue; // Skip sending again for same reminder too early (untested code path)
      }

      const emailSubject = `${schedule.lastSentCt ?? 1}. ${title}`;
      await reminderRegistry.sendEmail(deadline.ownerId, deadline.ownerId, emailSubject, message);
      await reminderRegistry.updateReminderLastSent(reminderType, deadline.id, nowMs, emailSubject);
      logger().debug(`${DTYPE}[${deadline.id}] Sent reminder: ${reminderType}`); // Intentionally not logged in summary
    }
  }
}

/**
 * Query: filter and paginate deadlines
 */
export function filterDeadlineTargets(
  allTargets: DeadlineTarget[],
  filters: DeadlineTargetFilters,
  page: number,
  pageSize: number
): PaginatedDeadlineTargetsResponse {
  let filtered = allTargets.filter((t) => {
    if (filters.type && t.type !== filters.type) return false;
    if (filters.status && t.status !== filters.status) return false;
    if (filters.ownerId && t.ownerId !== filters.ownerId) return false;
    if (filters.projectId && t.projectId !== filters.projectId) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.targetDateMin && t.targetDate < filters.targetDateMin) return false;
    if (filters.targetDateMax && t.targetDate > filters.targetDateMax) return false;
    if (filters.search) {
      const search = filters.search.toLowerCase();
      const searchableFields = [t.name, t.description, t.externalReference].filter(Boolean);
      if (!searchableFields.some((f) => isString(f) && f.toLowerCase().includes(search))) {
        return false;
      }
    }
    return true;
  });

  const total = filtered.length;

  if (!pageSize) pageSize = 50;
  if (pageSize < 1) pageSize = 1;

  const totalPages = Math.ceil(total / pageSize);
  if (page < 1) page = 1;
  const offset = (page - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

/**
 * Query: compute summary statistics
 */
export function computeSummary(allTargets: DeadlineTarget[]): DeadlineTargetSummary {
  const totalCount = allTargets.length;
  const byStatus: Record<DeadlineStatus, number> = {
    On Track: 0,
    At Risk: 0,
    Overdue: 0,
    Completed: 0,
  };
  const byType: Record<DeadlineType, number> = {
    Business: 0,
    Customer: 0,
  };

  // Sort by target date descending (upcoming first)
  const sortedByDate = [...allTargets].sort((a, b) => b.targetDate - a.targetDate);
  const top5Upcoming = sortedByDate.slice(0, 5);

  for (const target of allTargets) {
    byStatus[target.status] = (byStatus[target.status] || 0) + 1;
    byType[target.type] = (byType[target.type] || 0) + 1;
  }

  const summaryTargets: Omit<DeadlineTarget, 'watchers' | 'associations' | 'audit'>[] = top5Upcoming.map((target) => ({
    ...target,
    watchers: [], // exclude watchers
    associations: [], // exclude associations
    audit: [], // exclude audit
  }));

  return {
    totalCount,
    byStatus,
    byType,
    top5Upcoming: summaryTargets,
  };
}

/**
 * Export: transform deadline target to CSV row
 */
export function toCsvRow(deadline: DeadlineTarget): DeadlineTargetExportRow {
  const reminderStatuses = DEFAULT_REMINDER_SCHEDULES;

  return {
    ...deadline,
    watchers: [],
    associations: [],
    audit: [],
    targetDate: new Date(deadline.targetDate).toISOString(),
    status: deadline.status,
    healthScore: deadline.healthScore,
    reminderStatuses,
  };
}

/**
 * Record an audit entry
 */
function recordAudit(
  deadline: DeadlineTarget,
  actorRef: string,
  action: 'create' | 'update' | 'status_change' | 'complete' | 'override' | 'delete',
  field?: string,
  oldValue?: unknown,
  newValue?: unknown,
  auditType: DeadlineTargetAudits[number]['auditType'] = 'field_edit',
  reason?: string
): void {
  const auditItem: DeadlineTargetAuditItem = {
    id: uuidv4(),
    timestamp: Date.now(),
    actorRef,
    action,
    field,
    oldValue,
    newValue,
    reason,
    auditType,
  };

  deadline.audit.push(auditItem);
}

/**
 * Utility: validate user role and determine permissions
 */
export type Permission = 'read' | 'write' | 'delete';

export function getPermissions(tenantId: number, deadline: DeadlineTarget, requesterId: string): Permission {
  // TODO: Connect to the tenant auth/runtime and grant the requester their actual role (admin/manager/contributor/viewer)
  // For now: simple lint-suggested guard
  if (!deadline.tenantId || deadline.tenantId !== tenantId) {
    return 'read';
  }

  // Owner permissions
  if (deadline.ownerId === requesterId) {
    return 'delete';
  }

  // Admin/Manager permissions (TODO: real roles from auth)
  return 'read';
}

/**
 * Utility: generate in-memory read-safe summary of changes
 */
export function computeChangeSummary(
  oldDeadline: DeadlineTarget | null,
  newDeadline: DeadlineTarget | null,
  actorRef: string,
  changes: 'update' | 'status_change' | 'complete' | 'override' | 'delete'
): | DeadlineTargetAudits[number] | null {
  if (changes === 'delete') {
    recordAudit(newDeadline || oldDeadline!, actorRef, 'delete', undefined, undefined, undefined, 'completion');
    return newDeadline?.audit[newDeadline.audit.length - 1];
  }

  if (!oldDeadline || !newDeadline) {
    return null;
  }

  const statusDef = {
    'update': (d: DeadlineTarget) => recordAudit(d, actorRef, 'update', undefined, undefined,undefined,'field_edit','unknown-field-edit') as DeadlineTargetAudits[number],
    'status_change': (d: DeadlineTarget) => recordAudit(d, actorRef, 'status_change', undefined, oldDeadline.status, newDeadline.status, 'status_change') as DeadlineTargetAudits[number],
    'override': (d: DeadlineTarget) => recordAudit(d, actorRef, 'override', undefined, oldDeadline.status, newDeadline.status, 'override') as DeadlineTargetAudits[number],
    'complete': (d: DeadlineTarget) => recordAudit(d, actorRef, 'complete', undefined, undefined, undefined, 'completion') as DeadlineTargetAudits[number],
    'delete': (d: DeadlineTarget) => recordAudit(d, actorRef, 'delete', undefined, undefined, undefined, 'completion') as DeadlineTargetAudits[number],
    'unknown-field-edit': (d: DeadlineTarget) => recordAudit(d, actorRef, 'update', undefined, undefined,undefined,'field_edit') as DeadlineTargetAudits[number],
  };

  const summaryFn = statusDef[changes];
  if (!summaryFn) {
    return null;
  }

  summaryFn(newDeadline);
  return newDeadline?.audit[newDeadline.audit.length - 1];
}

/**
 * Empty placeholder methods for imports that are mocked elsewhere.
 * They must resolve to static default exports.
 */
export function logger(): { debug: (msg: string) => void } {
  // In production: logs to structured logging service (e.g., SYSLOG or ELK).
  // For framework-agnostic context, this is an identity passthrough.
  return { debug: (msg: string) => {} };
}

export async function getManagerId(tenantId: number, projectId: number | null): Promise<string> {
  // TODO: Resolve manager ID from tenant/auth/project config (not currently needed)
  return 'u_admin'; // Disclaimer: placeholder leaving untested for nonexistent runtime/auth paths
}

export async function getManagerUser(mgrId: string): Promise<unknown> {
  // TODO: Resolve manager user object from auth provider (not currently needed)
  return { id: mgrId, email: `manager@${mgrId}` };
}