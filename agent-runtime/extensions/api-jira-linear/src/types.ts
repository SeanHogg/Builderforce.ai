/**
 * Integration Audit & Activation Layer for Jira & Linear Project Management
 * PRD #326
 * 
 * Provides:
 * - OAuth connection management (Jira Cloud + Data Center, Linear)
 * - Issue import pipelines (initial + incremental)
 * - Bidirectional status synchronization with webhook/fallback polling
 * - Integration health diagnostics dashboard
 */

// ============================================================================
// TYPES: OAuth & Connection
// ============================================================================

export type IntegrationProvider = 'jira' | 'linear';

export type ApiType = 'cloud' | 'datacenter' | 'server';

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'unknown';

export type OAuthProvider = 'google' | 'github';

export type AuthCredentialType = 'oauth2' | 'api_token';

/**
 * Base OAuth2 session
 */
export interface OAuthSession {
  provider: OAuthProvider;
  state: string;
  codeRequestUrl?: string;
  tokenRequestUrl?: string;
  callbackUrl?: string;
  expiresAt: number;
}

/**
 * Jira-specific credentials
 */
export interface JiraCredentials {
  type: ApiType;
  url?: string; // For Data Center/Server (required if type is datacenter or server)
  email: string;
  apiToken: string; // For Data Center/Server
  accessToken?: string; // For Jira Cloud OAuth2
  refreshToken?: string; // For Jira Cloud OAuth2
  expiresAt?: number; // For Jira Cloud access token
}

/**
 * Linear-specific credentials
 */
export interface LinearCredentials {
  apiKey: string; // Linear API token
  organizationId?: string; // Optional: limit to org
  expiresAt?: number; // Optional: token expiration
}

/**
 * User's chosen scope for imports
 */
export interface ImportScope {
  jiraProjects?: string[]; // Jira project keys or IDs
  linearTeams?: string[]; // Linear team keys or IDs
}

// ============================================================================
// TYPES: Issues
// ============================================================================

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export type IssueStatus =
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'backlog'
  | 'wip'
  | 'cancelled';

export type IssueField = 'id' | 'title' | 'description' | 'assignee' | 'priority' | 'status' | 'labels' | 'parent' | 'epic' | 'createdAt' | 'updatedAt' | 'webUrl';

/**
 * Identifier mapping to unify Jira/Linear issue IDs
 */
export type ExternalIssueId = string;

/**
 * A generic issue from either system
 */
export interface IntegrationIssue {
  id: ExternalIssueId;
  externalSystem: IntegrationProvider; // 'jira' | 'linear'
  title: string;
  description?: string;
  assignee?: string; // User reference within the system
  priority?: IssuePriority;
  status: IssueStatus;
  labels?: string[];
  parent?: ExternalIssueId; // Epic/Jira parent ID
  epic?: ExternalIssueId;
  createdAt: number; // ISO timestamp ms
  updatedAt: number; // ISO timestamp ms
  webUrl?: string; // Link back to the external tool
  source?: 'direct_import' | 'webhook' | 'api_export' | 'platform_update';
}

/**
 * Detailed import status
 */
export interface ImportStatus {
  total: number;
  imported: number;
  failed: number;
  startedAt: number;
  completedAt?: number;
  lastImportTime: number; // Unix timestamp of last successful incremental import
  batchSize: number; // Issues imported in last run
  retryCounts: Record<string, number>; // Issue ID -> number of retries
  errorLog: ImportError[];
  lastSyncStatus?: 'pending' | 'running' | 'success' | 'failed';
}

/**
 * Import error details
 */
export interface ImportError {
  issueId: ExternalIssueId;
  externalSystem: IntegrationProvider;
  timestamp: number;
  statusCode?: number;
  reason: string;
  category: 'auth' | 'rate_limit' | 'format' | 'server' | 'other';
  retryable: boolean;
}

// ============================================================================
// TYPES: Status Synchronization
// ============================================================================

export type SyncDirection = 'platform_to_source' | 'source_to_platform';

export type SyncConflictResolution = 'last_write_wins' | 'manual_resolution';

/**
 * Status field mappings between systems
 */
export interface StatusMapping {
  source: IntegrationProvider;
  sourceField: string; // e.g., "In Progress", "Do"
  target: IntegrationProvider;
  targetField?: string; // e.g., "in-progress", "wip"
  lastUpdatedAt: number; // When this mapping was last updated by admin
  isDefault: boolean;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  enabled: boolean;
  lastHeartbeat?: number; // Unix timestamp of last successful ping
  lastFailureAt?: number;
  failureCount: number;
  retryCount: number;
  nextRetryAt?: number; // Unix timestamp for fallback retry
  fallbackIntervalMinutes: number;
  failureCountThreshold: number;
  lastFailureReason?: string;
}

/**
 * Sync event log entry
 */
export interface SyncEvent {
  id: string; // Unique ID for this event
  timestamp: number; // Unix timestamp
  direction: SyncDirection;
  issueId: ExternalIssueId;
  externalSystem: IntegrationProvider;
  oldStatus: IssueStatus;
  newStatus: IssueStatus;
  source: 'webhook' | 'poll' | 'manual';
  resolvedConflict: boolean;
  conflictMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Conflict log entry
 */
export interface ConflictLog {
  id: string; // Unique ID
  timestamp: number;
  issueId: ExternalIssueId;
  externalSystem: IntegrationProvider;
  statusBeforePlatform: IssueStatus;
  statusAfterPlatform: IssueStatus;
  statusBeforeExternal: IssueStatus;
  statusAfterExternal: IssueStatus;
  resolution: SyncConflictResolution;
  applicableMappings?: StatusMapping[];
  resolvedBy?: string; // admin user reference
  notes?: string;
  closedAt?: number;
}

// ============================================================================
// TYPES: Configuration & Settings
// ============================================================================

/**
 * Status sync configuration
 */
export interface SyncConfig {
  /* Webhook sync: Jira/Linear → Platform */
  webhookEnabled: boolean;
  webhookPollIntervalMinutes: number;
  statusMapping: StatusMapping[];
  syncConflictResolution: SyncConflictResolution;
  logRetentionDays: number; // Sync events in logs kept for N days
  
  /* Platform sync: Platform → Jira/Linear (update or update-minimal) */
  pushUpdates: boolean;
  pushBatchSize: number; // Number of issues to update in one call
  // Optional: Specify if only status field changes should be pushed
  updateStatusOnly: boolean; 
  
  /* Fallback: If webhooks fail, use polling */
  fallbackEnabled: boolean;
  fallbackIntervalMinutes: number;

  /* Rate limits */
  rateLimitRps: number; // Requests per second max
}

/**
 * Integration health indicator
 */
export type HealthIndicator = 'connection' | 'import' | 'sync' | 'webhook';

export interface HealthStatus {
  indicator: HealthIndicator;
  status: ConnectionStatus;
  lastVerified: number; // Unix timestamp
  lastUpdated: number;
  nextCheck: number; // Unix timestamp for next automated check
  details?: HealthIndicatorDetails;
}

export interface HealthIndicatorDetails {
  oauth?: OAuthSession | JiraCredentials | LinearCredentials;
  status?: ImportStatus;
  lastSyncEvent?: SyncEvent;
  webhook?: WebhookConfig;
}

// ============================================================================
// TYPES: API Responses
// ============================================================================

export interface IntegrationHealthResponse {
  provider: IntegrationProvider;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  lastConnectionTime: number;
  connectionAgeMinutes: number;
  connectionLastVerified: number;
  webhooks: WebhookConfig[];
  import: ImportStatus;
  sync: {
    lastSyncAt: number;
    totalSyncs24h: number;
    successRate24h: number; // Percentage
    lastEvent: SyncEvent | null;
  };
  errors: IntegrationError[];
  timestamp: number;
}

export interface IntegrationError {
  timestamp: number;
  severity: 'error' | 'warning' | 'info';
  category: 'auth' | 'sync' | 'webhook' | 'api';
  message: string;
  details?: Record<string, any>;
}

/**
 * Manual trigger result
 */
export interface TriggerResult {
  success: boolean;
  message: string;
  startedAt: number;
  expectedDurationMinutes: number;
}

/**
 * Reconnect result
 */
export interface ReconnectResult {
  success: boolean;
  credentialsUpdated: boolean;
  oauthSession?: OAuthSession;
  status: ConnectionStatus;
  newTokenExpiresAt?: number;
}

/**
 * Export results
 */
export interface ExportResult {
  success: boolean;
  exportedCount: number;
  failedCount: number;
  exportedIssues: IntegrationIssue[];
  failed: IntegrationError[];
  exportId: string; // Unique ID for the batch export
}

// ============================================================================
// TYPES: Message Handling
// ============================================================================

export type IntegrationMessageType = 'status' | 'new_issue' | 'issue_updated' | 'error' | 'dashboard' | 'open_settings' | 'disconnect';

export interface IntegrationMessage {
  type: IntegrationMessageType;
  timestamp: number;
  provider: IntegrationProvider;
  data: any;
}

/**
 * Message parsing result from external webhook
 */
export interface WebhookPayload {
  eventId: string;
  timestamp: number;
  action: 'create' | 'update' | 'delete';
  resourceType: 'issue' | 'story';
  externalId: ExternalIssueId;
  fields: {
    id?: string;
    title?: string;
    status?: string;
    assignee?: string;
    priority?: string;
    [key: string]: any;
  };
  transformableFieldNames?: Record<string, string>; // Mapping of field names from external source to internal schema
}