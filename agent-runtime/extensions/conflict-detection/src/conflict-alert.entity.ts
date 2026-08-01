/**
 * Conflict Alert Entity
 * Data entity representation for conflict alerts (for persistence/API serialization)
 */

import type { ConflictAlert, ConflictStatus, ConflictLabel } from './types.js';

export { ConflictAlert, ConflictStatus, ConflictLabel };

/**
 * Create a new conflict alert entity
 */
export function createConflictAlert(
  params: Omit<ConflictAlert, 'id' | 'status' | 'detectedAt' | 'detectedBy'>
): ConflictAlert {
  return {
    id: crypto.randomUUID(),
    status: 'detected',
    detectedAt: new Date().toISOString(),
    detectedBy: 'conflict-detection-engine',
    ...params
  };
}

/**
 * Validate conflict alert structure
 */
export function validateConflictAlert(alert: unknown): alert is ConflictAlert {
  if (!alert || typeof alert !== 'object') return false;
  
  const a = alert as Record<string, unknown>;
  
  return (
    typeof a.id === 'string' &&
    typeof a.status === 'string' &&
    ['detected', 'acknowledged', 'resolved', 'dismissed'].includes(a.status) &&
    typeof a.ruleId === 'string' &&
    Array.isArray(a.labels) &&
    Array.isArray(a.conflictingRequests) &&
    typeof a.summary === 'string' &&
    typeof a.detectedAt === 'string' &&
    typeof a.detectedBy === 'string'
  );
}

/**
 * Convert alert to API response format
 */
export function toAlertResponse(alert: ConflictAlert): Record<string, unknown> {
  return {
    id: alert.id,
    status: alert.status,
    ruleId: alert.ruleId,
    labels: alert.labels,
    conflictingRequests: alert.conflictingRequests.map(req => ({
      requestId: req.requestId,
      stakeholderId: req.stakeholderId,
      stakeholderName: req.stakeholderName,
      teamId: req.teamId,
      teamName: req.teamName,
      priority: req.priority,
      reviewWindowId: req.reviewWindowId,
      submittedAt: req.submittedAt,
      versionId: req.versionId
    })),
    summary: alert.summary,
    detectedAt: alert.detectedAt,
    detectedBy: alert.detectedBy,
    resolvedAt: alert.resolvedAt,
    resolvedBy: alert.resolvedBy,
    priorityVersionIds: alert.priorityVersionIds
  };
}
