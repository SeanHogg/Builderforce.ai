/**
 * Type definitions — Conflict Detection Rules and Alerts
 *
 * Per PRD:
 * - Conflict Alert DTO structure
 * - Conflict Detection API request/response
 * - Conflict Rule Spec
 */

// ── Priority / Status / Severity ─────────────────────────────────────────────

export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export const PRIORITY_LEVELS: readonly PriorityLevel[] = ['P0', 'P1', 'P2', 'P3'];

export type ConflictStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';
export type ConflictSeverity = 'critical' | 'high' | 'medium' | 'low';

// ── Core Entities ─────────────────────────────────────────────────────────────

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
  team: Team;
  priority1: PriorityLevel;
  priority2: PriorityLevel;
}

/**
 * Opaque, length-delimited conflict deduplication key.
 * base64url-encoded JSON (`k1`  = key) or compact delimited form;
 * must not be broken by `split('__')` on ids that themselves contain `__`.
 */
export type ConflictKeyString = string;

export interface ConflictKey {
  stakeholderId1: string;
  stakeholderId2: string;
  teamId: string;
  versionId?: string;
}

// ── Conflict Alert DTO (exposed via API + OpenAPI) ───────────────────────────

/**
 * Conflict Alert DTO
 *
 * Requirements per PRD:
 * - Labeling: conflicting items, involved stakeholders, detection date
 * - Summarization: reasoning behind conflict
 * - Attachment: to relevant priority version(s)
 * - Visibility: via API to all team members
 */
export interface ConflictAlert {
  /** Unique alert ID — equals the canonical deduplication key. */
  id: string;
  /** Structured view of the deduplication key. */
  key: ConflictKey;
  /** Human-readable title labeling conflicting team/priorities. */
  title: string;
  /** Detailed description with labeling per PRD. */
  description: string;
  /** Concise reasoning summary explaining rule violation. */
  summary: string;
  /** Severity classification. */
  severity: ConflictSeverity;
  /** ISO 8601 detection timestamp — labeling requirement. */
  detectedAt: string;
  /** Workflow status. */
  status: ConflictStatus;
  /** Structured conflicting priorities with stakeholder details. */
  conflictingPriorities: ConflictingPriorities;
  /** List of involved stakeholders — labeling requirement. */
  stakeholders: Stakeholder[];
  /** Attached priority version(s) — per attachment requirement. */
  versionIds: string[];
  /** Source request IDs that triggered the conflict. */
  sourceRequestIds: string[];
  /** Number of unique conflicting source requests. */
  conflictCount: number;
  /** Optional resolution note (when resolved/dismissed/acknowledged). */
  resolutionNote?: string;
  /** User who resolved the conflict. */
  resolvedBy?: string;
  /** ISO 8601 resolution timestamp. */
  resolvedAt?: string;
}

// ── API DTOs ──────────────────────────────────────────────────────────────────

export interface DetectConflictsRequest {
  requests: PriorityRequest[];
  /** Scope detection to specific priority version / review window. */
  versionId?: string;
  /** Override default review window size in days. */
  windowThresholdDays?: number;
}

export interface DetectConflictsResponse {
  success: boolean;
  conflicts: ConflictAlert[];
  duplicatesFound: number;
  error?: string;
  timestamp?: string;
}

export interface ListConflictsQuery {
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

// ── Rule Spec Types ───────────────────────────────────────────────────────────

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
