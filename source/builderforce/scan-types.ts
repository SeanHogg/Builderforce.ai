/**
 * Backlog Scan Types
 * Core domain models for the automated backlog scan system
 */

/**
 * Unique identifier for a scan run
 */
export type ScanId = string;

/**
 * Unique identifier for a specific work item/project
 */
export type WorkItemId = string;

/**
 * Work item status from project management tools
 */
export type WorkItemStatus =
  | 'backlog'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'cancelled'
  | 'archived';

/**
 * Project/Opportunity type classification
 */
export type OpportunityType = 'new_project' | 'growth' | 'efficiency' | 'compliance' | 'other';

/**
 * Identifier for the source of work items (Jira, Trello, etc.)
 */
export type SourceId = string;

/**
 * Schedule frequency for automated scans
 */
export type ScanFrequency =
  | 'hourly'
  | 'every_3_hours'
  | 'daily'
  | 'weekly'
  | 'monthly';

/**
 * Severity level for scan identification
 */
export type ScanSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Unique identifier for a scan schedule
 */
export type ScheduleId = string;

/**
 * Notification delivery method
 */
export type NotificationChannel = 'email' | 'slack' | 'webhook' | 'web_ui';

/**
 * Represents a single work item identified during a backlog scan
 */
export interface IdentifiedWorkItem {
  /** Source system ID (e.g., Jira ticket, Trello card) */
  id: WorkItemId;
  
  /** Source system identifier (e.g., "jira", "trello") */
  sourceId: SourceId;
  
  /** Display title */
  title: string;
  
  /** Description or summary */
  description?: string;
  
  /** Current status in source */
  status: WorkItemStatus;
  
  /** Assigned to user/agent */
  assignee?: string;
  
  /** Priority level */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  
  /** Original effort estimate (days/hours) */
  estimate?: string;
  
  /** Project or category this item belongs to */
  project?: string;
  
  /** Tags or labels */
  tags?: string[];
  
  /** Last updated timestamp */
  lastUpdated: Date;
  
  /** Creation timestamp if known */
  createdAt?: Date;
  
  /** Reputation: how strong was the identification? (0-1) */
  confidence: number;
  
  /** Fallback if not detected */
  detectedKeywords?: string[];
}

/**
 * Result of a backlog scan containing identified items
 */
export interface ScanResult {
  /** Unique scan identifier */
  scanId: ScanId;
  
  /** Timestamp when scan was executed */
  scannedAt: Date;
  
  /** Schedule ID if this was a scheduled scan */
  scheduleId?: ScheduleId;
  
  /** Total work items identified */
  totalItems: number;
  
  /** Items that are new or changed since last scan */
  newOrChangedItems: IdentifiedWorkItem[];
  
  /** Summary of findings */
  summary: {
    totalNew: number;
    highPriorityCount: number;
    byType: Record<OpportunityType, number>;
  };
  
  /** Raw items for further processing */
  rawItems: Omit<IdentifiedWorkItem, 'confidence'>[];
  
  /** Performance metrics */
  metrics: {
    durationMs: number;
    itemsProcessed: number;
    newItemsRatio: number;
  };
}

/**
 * Configuration for scan execution
 */
export interface ScanConfig {
  /** Maximum number of items to return */
  maxItems?: number;
  
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  
  /** Include only items with specific tags */
  tags?: string[];
  
  /** Filter by project/category */
  project?: string;
  
  /** Filter by status */
  status?: WorkItemStatus[];
  
  /** Stop after finding this many new items */
  stopAfterNew?: number;
}

/**
 * Scan schedule definition
 */
export interface ScanSchedule {
  /** Unique schedule identifier */
  id: ScheduleId;
  
  /** Schedule name for display */
  name: string;
  
  /** Frequency of automated execution */
  frequency: ScanFrequency;
  
  /** Cron expression for advanced control (optional) */
  cronExpression?: string;
  
  /** Time zone for schedule */
  timeZone?: string;
  
  /** Alert threshold for new items (0-100, percent) */
  alertThreshold: number;
  
  /** Channels to notify on new findings */
  notificationChannels: NotificationChannel[];
  
  /** Scope: which backlogs/targets to scan */
  scope: {
    /** UUID identifiers of projects/targets (empty = all) */
    projectIds?: string[];
    /** Custom query filter */
    filter?: string;
  };
  
  /** whether to run non-stop until maxItems reached */
  stopAfterNew?: boolean;
  
  /** Whether this schedule is active */
  active: boolean;
  
  /** Last execution timestamps */
  lastExecutedAt?: Date;
  nextScheduledAt?: Date;
  
  /** Optional schedule owner */
  owner: {
    userId: string;
    name: string;
  };
}

/**
 * Audit log entry for scan operations
 */
export interface ScanAuditLog {
  /** Unique log entry identifier */
  id: string;
  
  /** Associated scan ID */
  scanId?: ScanId;
  
  /** Associated schedule ID if batched */
  scheduleId?: ScheduleId;
  
  /** Operation performed */
  operation: 'scan_initiated' | 'scan_completed' | 'scan_failed' | 'schedule_created' | 'schedule_updated' | 'schedule_disabled' | 'notification_sent' | 'item_identified';
  
  /** User/source that performed the operation */
  userIdOrSystem: string;
  
  /** Timestamp of operation */
  timestamp: Date;
  
  /** Details about the operation */
  details: Record<string, unknown>;
  
  /** Any error encountered */
  error?: string;
  
  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configured notification recipient
 */
export interface NotificationRecipient {
  /** User ID who receives notifications */
  userId: string;
  
  /** Name for display */
  name?: string;
  
  /** Preferred channels */
  channels: NotificationChannel[];
  
  /** Alert threshold (percentage of new items to trigger) */
  threshold: number;
}