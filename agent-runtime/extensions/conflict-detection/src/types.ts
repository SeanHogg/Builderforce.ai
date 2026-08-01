/**
 * Conflict Detection Types
 * Core type definitions for the conflict detection system
 */

export type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';

export type ConflictStatus = 'detected' | 'acknowledged' | 'resolved' | 'dismissed';

export interface StakeholderRequest {
  requestId: string;
  stakeholderId: string;
  stakeholderName: string;
  teamId: string;
  teamName: string;
  priority: PriorityLevel;
  reviewWindowId: string;
  submittedAt: string;
  versionId: string;
}

export interface ConflictLabel {
  type: 'request' | 'stakeholder' | 'team' | 'review-window';
  value: string;
  displayName: string;
}

export interface ConflictAlert {
  id: string;
  status: ConflictStatus;
  ruleId: string;
  labels: ConflictLabel[];
  conflictingRequests: StakeholderRequest[];
  summary: string;
  detectedAt: string;
  detectedBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
  priorityVersionIds: string[];
}

export interface ConflictRule {
  id: string;
  name: string;
  description: string;
  detect: (requests: StakeholderRequest[]) => ConflictAlert[];
}

export interface ConflictDetectionResult {
  conflicts: ConflictAlert[];
  processedRequests: number;
  timestamp: string;
}

export interface ListConflictsQuery {
  status?: ConflictStatus;
  teamId?: string;
  stakeholderId?: string;
  reviewWindowId?: string;
  limit?: number;
  offset?: number;
}

export interface ResolveConflictRequest {
  conflictId: string;
  resolution: 'acknowledged' | 'resolved' | 'dismissed';
  resolvedBy: string;
  resolutionNotes?: string;
}
