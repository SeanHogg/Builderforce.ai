// Deadline Targets - TypeScript Types and Interfaces

export type DeadlineType = 'Business' | 'Customer';

export type DeadlineStatus = 'On Track' | 'At Risk' | 'Overdue' | 'Completed';

export type DeadlinePriority = 'Critical' | 'High' | 'Medium' | 'Low';

export type OwnerKind = 'user' | 'team';

export interface DeadlineWatchers {
  userId: string; // external user id from identity provider
  projectId: number;
  tenantId: number;
  addedAt: number; // ISO timestamp
  source: 'manual' | 'assignment';
}

export interface DeadlineTargetAssociation {
  entityType: 'project' | 'work_item' | 'account' | 'contract';
  entityId: string; // project id or unique identifier
  linkedAt: number; // ISO timestamp
  source: 'owner_initiated' | 'system';
}

export interface DeadlineTargetAudit {
  id: string; // uuid
  timestamp: number; // ISO timestamp
  actorRef: string; // user agent ref or system
  action: 'create' | 'update' | 'status_change' | 'complete' | 'override' | 'delete';
  field?: string; // specific field changed for update actions
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string; // for status override/changes
  auditType: 'field_edit' | 'status_change' | 'override' | 'completion';
}

export interface DeadlineTarget {
  id: string; // uuid
  tenantId: number;
  projectId: number; // null for orphans
  name: string;
  type: DeadlineType;
  targetDate: number; // ISO timestamp (millisecond epoch)
  targetDateTz?: string; // optional timezone
  ownerId: string; // user id
  ownerKind: OwnerKind;
  status: DeadlineStatus;
  statusReason?: string;
  isManualOverride: boolean;
  description?: string;
  priority: DeadlinePriority;
  externalReference?: string; // e.g. contract ID, ticket number, URL
  confidential: boolean;
  healthScore: number; // computed as % of linked tasks complete

  watchers: DeadlineWatchers[];
  associations: DeadlineTargetAssociation[];
  audit: DeadlineTargetAudit[];

  createdAt: number; // ISO timestamp
  updatedAt: number; // ISO timestamp
  completedAt?: number; // ISO timestamp only if status=Completed
}

export interface CreateDeadlineTargetRequest {
  name: string;
  type: DeadlineType;
  targetDate: number;
  targetDateTz?: string;
  ownerId: string;
  description?: string;
  priority: DeadlinePriority;
  projectId?: number;
  associations?: Array<{
    entityType: CreateDeadlineTargetRequest['associations']['entityType'];
    entityId: string;
  }>;
  externalReference?: string;
  confidential?: boolean;
}

export interface UpdateDeadlineTargetRequest {
  name?: string;
  targetDate?: number;
  description?: string;
  priority?: DeadlinePriority;
  externalReference?: string;
}

export interface UpdateDeadlineTargetStatusRequest {
  status: DeadlineStatus;
  reason?: string;
}

export interface DeadlineTargetFilters {
  type?: DeadlineType;
  status?: DeadlineStatus;
  ownerId?: string;
  projectId?: number;
  priority?: DeadlinePriority;
  targetDateMin?: number;
  targetDateMax?: number;
  search?: string;
}

export interface PaginatedDeadlineTargetsResponse {
  items: DeadlineTarget[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DeadlineTargetSummary {
  totalCount: number;
  byStatus: Record<DeadlineStatus, number>;
  byType: Record<DeadlineType, number>;
  top5Upcoming: Omit<DeadlineTarget, 'watchers' | 'associations' | 'audit'>[];
}

export interface DeadlineTargetDeliverable {
  id: string;
  name: string;
  type: DeadlineType;
  targetDate: number;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  healthScore: number;
}

export interface RegisterReminderRequest {
  emailSubject: string;
  emailBody: string;
}

export interface ListRemindersResponse {
  userId: string;
  reminders: Array<{
    // Constants per PRD: 30, 14, 7, 1 day(s), and on target day
    name: '30_days_before' | '14_days_before' | '7_days_before' | '1_day_before' | 'on_target_date';
    minutesBefore: number;
    active: boolean;
    lastSentAt?: number;
    lastSentEmailSubject?: string;
  }>;
}

export interface ReminderSchedule {
  minutesBeforeTarget: number;
  active: boolean;
  lastSentAt?: number;
  lastSentEmailSubject?: string;
}

export const REMINDER_INTERVALS: Record<string, number> = {
  '30_days_before': 30 * 24 * 60 * 60 * 1000,
  '14_days_before': 14 * 24 * 60 * 60 * 1000,
  '7_days_before': 7 * 24 * 60 * 60 * 1000,
  '1_day_before': 1 * 24 * 60 * 60 * 1000,
  'on_target_date': 0,
};