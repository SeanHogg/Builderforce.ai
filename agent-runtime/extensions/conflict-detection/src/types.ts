/**
 * Conflict Detection Rules and Alerts - Type Definitions
 * 
 * This module defines the data structures for conflict detection:
 * - Conflict Alert DTO
 * - Conflict Rule Spec
 * - Priority values and stakeholder data
 * - Detection results
 */

/**
 * Priority severity levels
 */
export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3' | null;

/**
 * Utility to validate priority levels
 */
export function isValidPriority(level: string): level is PriorityLevel {
  return ['P0', 'P1', 'P2', 'P3'].includes(level as PriorityLevel);
}

/**
 * Stakeholder data
 */
export interface Stakeholder {
  id: string;
  name: string;
  email: string;
  role?: string;
  userId?: string;
}

/**
 * Team identifier
 */
export interface Team {
  id: string;
  name: string;
  organization?: string;
}

/**
 * Priority request/incident record
 */
export interface PriorityRequest {
  id: string;
  title: string;
  description?: string;
  priority: PriorityLevel;
  stakeholderId: string;
  stakeholder: Partial<Stakeholder>; // Partial to allow flexible structure
  teamId: string;
  team: Partial<Team>;
  versionId?: string; // Associated priority version identifier
  reviewWindowStart?: string; // ISO 8601 date
  reviewWindowEnd?: string; // ISO 8601 date
  createdAt: string; // ISO 8601 timestamp
  updatedAt?: string;
  sourceSystem?: string; // e.g., "prioozzer", "manual-submit"
}

/**
 * Unique conflict key for deduplication
 */
export interface ConflictKey {
  stakeholderId1: string;
  stakeholderId2: string;
  teamId: string;
  versionId?: string;
}

/**
 * Conflicting priority values at the same team
 */
export interface ConflictingPriorities {
  stakeholder1: {
    stakeholderId: string;
    stakeholderName: string;
    priority: PriorityLevel;
  };
  team: {
    teamId: string;
    teamName: string;
  };
  priority1: PriorityLevel;
  priority2: PriorityLevel;
}

/**
 * Conflict Rule Specification
 * 
 * Defines the logic for detecting conflicts.
 * Current rule: "Two distinct stakeholders assign different P0 priorities to
 * the same team within the same review window."
 */
export interface ConflictRule {
  id: string;
  name: string;
  description: string;
  active: boolean;
  ruleLogic: {
    type: 'priority_mismatch_for_same_team_in_same_window';
    priorityLevel: 'P0'; // Currently only detects P0 conflicts
    windowSizeDays?: number; // Optional window size for same review period
    distinctStakeholders: true; // Must be different stakeholders
    sameTeam: true; // Same team
  };
  estimation: {
    complexity: 'low';
    performanceImpact: 'negligible';
  };
}

/**
 * Conflict alert data
 */
export interface ConflictAlert {
  id: string;
  key: ConflictKey; // For deduplication
  title: string;
  description: string;
  summary: string; // Concise explanation of the conflict
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectedAt: string; // ISO 8601 timestamp
  expiresAt?: string; // When to auto-close the alert
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  
  // Conflicting information
  conflictingPriorities: ConflictingPriorities;
  
  // Involved stakeholders (from both requests)
  stakeholders: Array<{
    stakeholderId: string;
    stakeholderName: string;
    role?: string;
  }>;
  
  // Linked version IDs
  versionIds: string[];
  
  // Manual resolution notes
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  
  // Metadata
  sourceRequestIds: string[]; // IDs of requests that triggered this conflict
  
  // Metrics
  conflictCount: number; // How many times this conflict occurred (for tracking)
}

/**
 * Conflict detection request/response DTOs
 */
export interface DetectConflictsRequest {
  requests: PriorityRequest[];
  versionId?: string; // If detecting within a specific priority version
  windowThresholdDays?: number; // Override default review window size
}

export interface DetectConflictsResponse {
  success: boolean;
  conflicts: ConflictAlert[];
  duplicatesFound: number; // Conflicts that were quieted due to deduplication
  error?: string;
}

/**
 * List conflicts request parameters
 */
export interface ListConflictsRequest {
  status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed' | 'all';
  versionId?: string;
  teamId?: string;
  stakeholderId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  page?: number;
  limit?: number;
}

/**
 * List conflicts response
 */
export interface ListConflictsResponse {
  conflicts: ConflictAlert[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Conflict resolution request
 */
export interface ResolveConflictRequest {
  alertId: string;
  action: 'acknowledge' | 'resolve' | 'dismiss';
  note?: string;
  resolverUserId?: string;
}

/**
 * Conflict resolution response
 */
export interface ResolveConflictResponse {
  success: boolean;
  alert?: ConflictAlert;
  error?: string;
}

/**
 * API route definitions
 */
export interface ConflictDetectionAPI {
  POST /detect: DetectConflictsRequest -> DetectConflictsResponse;
  GET /conflicts: ListConflictsRequest | string (id) -> ConflictAlert | ListConflictsResponse;
  POST /conflicts/:id/resolve: ResolveConflictRequest -> ResolveConflictResponse;
}

/**
 * Priority version identifier
 */
export interface PriorityVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
  displayName?: string;
}

/** Sent to builderforce.memory-core for persistence */
export type PersistableConflictAlert = Omit<ConflictAlert, 'conflictingPriorities'> & {
  conflictingPriorities: string; // JSON string
};