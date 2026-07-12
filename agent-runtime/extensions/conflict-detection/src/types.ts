/**
 * Type Definitions
 * 
 * Core TypeScript types for the Conflict Detection Rules and Alerts system.
 */

/**
 * Priority levels for requests
 */
export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export const PRIORITY_LEVELS: readonly PriorityLevel[] = ['P0', 'P1', 'P2', 'P3'] as const;

/**
 * Conflict alert statuses
 */
export type ConflictStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

/**
 * Conflict severities
 */
export type ConflictSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Stakeholder information
 */
export interface Stakeholder {
  stakeholderId: string;
  stakeholderName: string;
  role?: string;
  email?: string;
}

/**
 * Team information
 */
export interface Team {
  teamId: string;
  teamName: string;
  organization?: string;
}

/**
 * Source request information
 */
export interface PriorityRequest {
  id: string;
  title: string;
  description?: string;
  priority: PriorityLevel;
  stakeholderId: string;
  stakeholder: Stakeholder;
  teamId: string;
  team: Team;
  versionId?: string;
  reviewWindowStart?: string;
  reviewWindowEnd?: string;
  createdAt: string;
  updatedAt?: string;
  sourceSystem?: string;
}

/**
 * Conflicting priorities representation
 */
export interface ConflictingPriorities {
  stakeholder1: Stakeholder;
  stakeholder2: Stakeholder;
  team: Team;
  priority1: PriorityLevel;
  priority2: PriorityLevel;
}

/**
 * Conflict key - unique identifier for a conflict based on involved entities
 */
export interface ConflictKey {
  stakeholderId1: string;
  stakeholderId2: string;
  teamId: string;
  versionId?: string;
}

/**
 * Conflict alert - core entity for conflict management
 */
export interface ConflictAlert {
  id: string;
  key: ConflictKey;
  title: string;
  description: string;
  summary: string;
  severity: ConflictSeverity;
  detectedAt: string;
  status: ConflictStatus;
  conflictingPriorities: ConflictingPriorities;
  stakeholders: Stakeholder[];
  versionIds: string[];
  sourceRequestIds: string[];
  conflictCount: number;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

/**
 * Conflict detection request
 */
export interface DetectConflictsRequest {
  requests: PriorityRequest[];
  versionId?: string;
  windowThresholdDays?: number;
}

/**
 * Conflict detection response
 */
export interface DetectConflictsResponse {
  success: boolean;
  conflicts: ConflictAlert[];
  duplicatesFound: number;
  error?: string;
}

/**
 * Conflict detection rule specification
 */
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

/**
 * List conflicts query parameters
 */
export interface ListConflictsQuery {
  status?: ConflictStatus;
  versionId?: string;
  teamId?: string;
  stakeholderId?: string;
  severity?: ConflictSeverity;
  page?: number;
  limit?: number;
}

/**
 * Resolve conflict request
 */
export interface ResolveConflictRequest {
  action: 'acknowledge' | 'resolve' | 'dismiss';
  note?: string;
  resolverUserId?: string;
}

/**
 * API response wrapper
 */
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

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  details?: Record<string, any>;
}

/**
 * Pagination response
 */
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

/**
 * Conflict notification payload
 */
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

/**
 * Audit log entry
 */
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