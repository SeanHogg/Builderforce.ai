/**
 * Type Definitions — Conflict Detection Rules and Alerts
 *
 * Per PRD:
 * - Conflict Alert DTO structure
 * - Conflict Detection API request/response
 * - Conflict Rule Spec
 */

export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export const PRIORITY_LEVELS: readonly PriorityLevel[] = ['P0', 'P1', 'P2', 'P3'] as const;

export type ConflictStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';
export type ConflictSeverity = 'critical' | 'high' | 'medium' | 'low';

// ──────────────────────────────────────────────────────────────────────────────
// Core Entities
// ──────────────────────────────────────────────────────────────────────────────

export interface Stakeholder {
  stakeholderId: string;
  stakeholderName: string;
  role?: string;
  email?: string;
}

export interface Team {
  teamId: string;
  teamName: string;
  organization?: string;
}

export interface PriorityRequest {
  id: string;
  title: string;
  description?: string;
  priority: PriorityLevel;
  stakeholderId: string;
  stakeholder: {
    name?: string;
    role?: string;
    email?: string;
  };
  teamId: string;
  team: {
    name?: string;
    organization?: string;
  };
  versionId?: string;
  reviewWindowStart?: string;
  reviewWindowEnd?: string;
  createdAt: string;
  updatedAt?: string;
  sourceSystem?: string;
}

export interface ConflictingPriorities {
  stakeholder1: Stakeholder;
  stakeholder2?: Stakeholder;
  stakeholder?: Stakeholder; // legacy alias
  team: Team;
  priority1: PriorityLevel;
  priority2: PriorityLevel;
}

export interface ConflictKey {
  stakeholderId1: string;
  stakeholderId2: string;
  teamId: string;
  versionId?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Conflict Alert DTO — Per PRD Acceptance Criteria
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Conflict Alert DTO
 *
 * Requirements (from PRD):
 * - Labeling: conflicting items, involved stakeholders, detection date
 * - Summarization: reasoning behind conflict
 * - Attachment: to relevant priority version(s)
 * - Visibility: via API to all team members
 *
 * OpenAPI schema: ConflictAlert
 */
export interface ConflictAlert {
  /** Unique alert ID (stable, derived from conflict key) */
  id: string;

  /** Stable deduplication key */
  key: ConflictKey;

  /** Human-readable title labeling conflicting team/priorities */
  title: string;

  /** Full description with labeled conflicting items, stakeholders, detection date */
  description: string;

  /** Concise reasoning summary explaining rule violation */
  summary: string;

  /** Severity classification */
  severity: ConflictSeverity;

  /** ISO 8601 detection timestamp — per labeling requirement */
  detectedAt: string;

  /** Workflow status */
  status: ConflictStatus;

  /** Structured conflicting priorities with stakeholder details */
  conflictingPriorities: ConflictingPriorities;

  /** List of involved stakeholders — labeling requirement */
  stakeholders: Stakeholder[];

  /** Attached priority version(s) — per attachment requirement */
  versionIds: string[];

  /** Source request IDs that triggered the conflict */
  sourceRequestIds: string[];

  /** Number of unique conflicting source requests */
  conflictCount: number;

  /** Optional resolution note (set when resolved/dismissed/acknowledged) */
  resolutionNote?: string;

  /** User who resolved the conflict */
  resolvedBy?: string;

  /** ISO 8601 resolution timestamp */
  resolvedAt?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// API DTOs
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /conflicts/detect — Request DTO
 */
export interface DetectConflictsRequest {
  /** Batch of priority requests to evaluate */
  requests: PriorityRequest[];
  /** Optional scope to specific priority version (defines review window) */
  versionId?: string;
  /** Override default review window size in days */
  windowThresholdDays?: number;
}

/**
 * POST /conflicts/detect — Response DTO
 */
export interface DetectConflictsResponse {
  success: boolean;
  conflicts: ConflictAlert[];
  duplicatesFound: number;
  error?: string;
}

/**
 * GET /conflicts — Query DTO (filtering by status per PRD)
 */
export interface ListConflictsQuery {
  /** Filter by status (PRD requires filtering by status) */
  status?: ConflictStatus | 'all';
  versionId?: string;
  teamId?: string;
  stakeholderId?: string;
  severity?: ConflictSeverity;
  page?: number;
  limit?: number;
}

export interface ListConflictsResponse {
  conflicts: ConflictAlert[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  timestamp: string;
}

export interface GetConflictResponse {
  success: boolean;
  conflict: ConflictAlert;
  timestamp: string;
}

/**
 * POST /conflicts/:id/resolve — Request DTO (manual resolution per PRD)
 */
export interface ResolveConflictRequest {
  action: 'acknowledge' | 'resolve' | 'dismiss';
  note?: string;
  resolverUserId?: string;
}

export interface ResolveConflictResponse {
  success: boolean;
  conflict: ConflictAlert;
  timestamp: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Rule Spec Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ConflictRule {
  name: string;
  description: string;
  severityLevels: Array<{
    level: string;
    condition: string;
    threshold?: number;
  }>;
  stakeholderConstraints: {
    mustBeDistinct: boolean;
    maxConcurrentRequestsPerStakeholder?: number;
  };
  priorityConstraints: {
    minThreshold: PriorityLevel;
    maxThreshold: PriorityLevel;
    exactMatch?: boolean;
  };
  teamConstraints: {
    allowMultipleTeams: boolean;
    teamScope?: string;
  };
  windowConstraints: {
    defaultDays: number;
    maxWindowDays: number;
    allowOverlap: boolean;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Wrapper / Common
// ──────────────────────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: any;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  details?: Record<string, any>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  timestamp: string;
}

export interface ConflictNotificationPayload {
  conflictId: string;
  title: string;
  summary: string;
  severity: ConflictSeverity;
  detectedAt: string;
  stakeholders: string[];
  versionId?: string;
  sourceSystem?: string;
}

export interface ConflictAuditEntry {
  id: string;
  conflictId: string;
  action: ConflictStatus | 'created' | 'acknowledged' | 'resolved' | 'dismissed' | 'commented';
  previousStatus?: ConflictStatus;
  newStatus?: ConflictStatus;
  actor: {
    type: 'system' | 'external' | 'internal';
    userId: string;
    username: string;
  };
  note?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}
