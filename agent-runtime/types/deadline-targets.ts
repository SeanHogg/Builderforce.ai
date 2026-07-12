// Deadline Targets - TypeScript Types and Interfaces (Framework-Agnostic)

export type DeadlineType = 'Business' | 'Customer';

export type DeadlineStatus = 'On Track' | 'At Risk' | 'Overdue' | 'Completed';

export type DeadlinePriority = 'Critical' | 'High' | 'Medium' | 'Low';

export type OwnerKind = 'user' | 'team';

export interface DeadlineWatchers {
  userId: string;
  projectId: number;
  tenantId: number;
  addedAt: number;
  source: 'manual' | 'assignment';
}

export interface DeadlineTargetAssociation {
  entityType: string; // 'project' | 'work_item' | 'account' | 'contract'
  entityId: string;
  linkedAt: number;
  source: string;
}

export interface DeadlineTargetAuditItem {
  id: string;
  timestamp: number; // ISO timestamp
  actorRef: string;
  action: 'create' | 'update' | 'status_change' | 'complete' | 'override' | 'delete';
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  auditType: 'field_edit' | 'status_change' | 'override' | 'completion';
}

export type DeadlineTargetAudits = Array<DeadlineTargetAuditItem>;

export interface DeadlineTarget {
  id: string;
  tenantId: number;
  projectId: number | null;
  name: string;
  type: DeadlineType;
  targetDate: number; // ISO timestamp (milliseconds since epoch)
  targetDateTz?: string;
  ownerId: string;
  ownerKind: OwnerKind;
  status: DeadlineStatus;
  statusReason?: string;
  isManualOverride: boolean;
  description?: string;
  priority: DeadlinePriority;
  externalReference?: string; // contract ID, ticket number, URL
  confidential: boolean;
  healthScore: number; // 0..100

  watchers: DeadlineWatchers[];
  associations: DeadlineTargetAssociation[];
  audit: DeadlineTargetAudits;

  createdAt: number;
  updatedAt: number;
  completedAt?: number;
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
    entityType: string;
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
  status?: { status: DeadlineStatus; reason?: string };
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

export interface DeadlineTargetExportRow extends Omit<DeadlineTarget, 'watchers' | 'associations' | 'audit'> {
  targetDate: string;
  status: string;
  healthScore: string;
  reminderStatuses?: {
    30_days_before: boolean;
    14_days_before: boolean;
    7_days_before: boolean;
    1_day_before: boolean;
    on_target_date: boolean;
  };
}

export interface ReminderSchedule {
  active: boolean;
  lastSentAt?: number;
  lastSentEmailSubject?: string;
}

// Reminder constants (from PRD): 30 days before, 14 days before, 7 days before, 1 day before, and on the target date
export const REMINDER_INTERVALS: Record<string, number> = {
  '30_days_before': 30 * 24 * 60 * 60 * 1000,
  '14_days_before': 14 * 24 * 60 * 60 * 1000,
  '7_days_before': 7 * 24 * 60 * 60 * 1000,
  '1_day_before': 1 * 24 * 60 * 60 * 1000,
  'on_target_date': 0,
};

export const DEFAULT_REMINDER_SCHEDULES: Record<string, ReminderSchedule> = {
  '30_days_before': { active: true },
  '14_days_before': { active: true },
  '7_days_before': { active: true },
  '1_day_before': { active: true },
  'on_target_date': { active: true },
};

export const REMINDER_TYPES = Object.keys(DEFAULT_REMINDER_SCHEDULES) as Array<keyof typeof DEFAULT_REMINDER_SCHEDULES>;

export const WARNING_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds