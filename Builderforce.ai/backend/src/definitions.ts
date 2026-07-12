/**
 * Dashboard Type Definitions for Backend
 * Local definitions (in lieu of unresolvable @builderforce/shared)
 */

/** Metrics summary for dashboard */
export interface MetricsSummary {
  totalApprovedPriorities: number;
  openSignOffs: number;
  pendingSignOffs: number;
  overdueSignOffs: number;
  activeConflicts: number;
  overdueEscalations: number;
  lastUpdated: string;
}

/** Project-specific metrics */
export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  priorityMetrics: PriorityMetrics;
  signOffMetrics: SignOffMetrics;
  conflictMetrics: ConflictMetrics;
  escalationMetrics: EscalationMetrics;
}

/** Priority metrics for a project */
export interface PriorityMetrics {
  totalApproved: number;
  pendingReview: number;
  totalAssigned: number;
}

/** Sign-off metrics for a project */
export interface SignOffMetrics {
  open: number;
  pending: number;
  overdue: number;
  lastSignOffDate: string;
}

/** Conflict metrics for a project */
export interface ConflictMetrics {
  active: number;
  thisWeek: number;
  types: string[];
}

/** Escalation metrics for a project */
export interface EscalationMetrics {
  overdue: number;
  pending: number;
  thisMonth: number;
}

/** Dashboard data transfer object */
export interface DashboardDTO {
  summary: MetricsSummary;
  projects: ProjectMetrics[];
}

/** Filter options for dashboard */
export type TimePeriod =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_year'
  | 'custom';

export interface DashboardFilters {
  projectIds?: string[];
  timePeriod: TimePeriod;
  timeRange?: { start: string; end: string };
  stakeholderIds?: string[];
}

/** Weekly digest content */
export interface WeeklyDigest {
  digestId: string;
  generatedAt: string;
  recipients: string[];
  content: string;
  metrics: DigestMetrics;
}

/** Digest metrics summary */
export interface DigestMetrics {
  totalOpenSignOffs: number;
  pendingEscalations: number;
  topConflicts: Array<{
    id: string;
    title: string;
    priority: string;
    severity: string;
  }>;
  urgentActionItems: Array<{
    id: string;
    title: string;
    priority: string;
    targetDate: string;
  }>;
}

/** Digest filter window definition */
export interface DigestWindow {
  start: string;
  end: string;
  windowName: string;
}

/** Configuration for weekly digest */
export interface WeeklyDigestConfig {
  enabled: boolean;
  digestWindow: DigestWindow;
  distributionList: {
    requiredApprovers: string[];
    informedPartyEmails: string[];
    slackChannels: string[];
  };
  template: DigestTemplate;
  maxLength: number;
}

/** Digest template */
export interface DigestTemplate {
  subject: string;
  bodyFormat: 'markdown' | 'plain' | 'html';
  sections: {
    summary: string;
    topConflicts: string;
    urgentItems: string;
  };
}

/** Distribution method type */
export type DistributionMethod = 'email' | 'slack' | 'both';

/** Type aliases for backward compatibility */
export type PriorityMetricsType = PriorityMetrics;
export type SignOffMetricsType = SignOffMetrics;
export type ConflictMetricsType = ConflictMetrics;
export type EscalationMetricsType = EscalationMetrics;

/** Priority metrics type for query results */
export interface PriorityMetrics {
  totalApproved: number;
  pendingReview: number;
  totalAssigned: number;
}

/** Sign-off metrics type for query results */
export interface SignOffMetrics {
  open: number;
  pending: number;
  overdue: number;
  lastSignOffDate: string;
}

/** Conflict metrics type for query results */
export interface ConflictMetrics {
  active: number;
  thisWeek: number;
  types: string[];
}

/** Escalation metrics type for query results */
export interface EscalationMetrics {
  overdue: number;
  pending: number;
  thisMonth: number;
}

/** Union type for all metric types */
export type MetricsSummaryType =
  | PriorityMetrics
  | SignOffMetrics
  | ConflictMetrics
  | EscalationMetrics;