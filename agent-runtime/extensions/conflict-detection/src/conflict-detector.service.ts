/**
 * Conflict Detection Engine
 *
 * Implements the core conflict detection logic per PRD:
 * - Rule: Detect when two DISTINCT stakeholders submit requests that assign
 *   DIFFERENT P0 priorities to the SAME TEAM within the SAME REVIEW WINDOW
 * - Handles deduplication (prevent duplicate alerts for identical conflicts)
 * - Generates labeling, summary, and attaches alerts to priority versions
 */

import type {
  PriorityRequest,
  ConflictAlert,
  DetectConflictsRequest,
  DetectConflictsResponse,
  ConflictRule,
} from './types.js';
import {
  ConflictAlertFactory,
  generateConflictKey,
  parseConflictKey,
} from './conflict-alert.entity.js';
import {
  CONFLICT_RULE_SPEC,
  validateRequestsForConflictDetection,
} from './conflict-rule.spec.js';

/**
 * In-memory store for deduplication — in production backed by DB.
 * Key: conflict key string -> alert
 */
const conflictStore = new Map<string, ConflictAlert>();

export function clearConflictStore() {
  conflictStore.clear();
}

export function getConflictStore() {
  return conflictStore;
}

/**
 * Conflict Detection Service
 */
export class ConflictDetectionService {
  private rule: ConflictRule = CONFLICT_RULE_SPEC as ConflictRule;

  /**
   * Detect conflicts in a batch of priority requests
   * Implements PRD rule: two distinct stakeholders, different P0 pri, same team, same window
   */
  detectConflicts(request: DetectConflictsRequest): DetectConflictsResponse {
    try {
      const requests = validateRequestsForConflictDetection(
        request.requests,
        request.windowThresholdDays ?? this.rule.windowConstraints.defaultDays
      );

      if (requests.length < 2) {
        return { success: true, conflicts: [], duplicatesFound: 0 };
      }

      // Group requests by team AND by review window proximity
      const teamGroups = this.groupRequestsByTeamAndWindow(requests, request.windowThresholdDays);

      const newConflicts: ConflictAlert[] = [];
      let duplicatesFound = 0;

      for (const teamId of Object.keys(teamGroups)) {
        const teamRequests = teamGroups[teamId];

        // Only consider P0 requests per PRD rule
        // The spec says "assigning different P0 priorities" - means both are P0
        // but requesting different things (implicit conflict) OR P0 vs P0
        const p0Requests = teamRequests.filter((r) => r.priority === 'P0');

        if (p0Requests.length < 2) {
          continue;
        }

        // Need at least 2 DISTINCT stakeholders
        const stakeholderMap = new Map<string, PriorityRequest[]>();
        for (const req of p0Requests) {
          const sid = req.stakeholderId;
          if (!stakeholderMap.has(sid)) {
            stakeholderMap.set(sid, []);
          }
          stakeholderMap.get(sid)!.push(req);
        }

        const distinctStakeholders = Array.from(stakeholderMap.keys());
        if (distinctStakeholders.length < 2) {
          continue; // Same stakeholder, no conflict per rule
        }

        // Generate all distinct stakeholder pairs
        for (let i = 0; i < distinctStakeholders.length; i++) {
          for (let j = i + 1; j < distinctStakeholders.length; j++) {
            const sid1 = distinctStakeholders[i];
            const sid2 = distinctStakeholders[j];

            const reqs1 = stakeholderMap.get(sid1)!;
            const reqs2 = stakeholderMap.get(sid2)!;

            // For each pair of requests from different stakeholders, check if same review window
            for (const r1 of reqs1) {
              for (const r2 of reqs2) {
                if (!this.isInSameReviewWindow(r1, r2, request.windowThresholdDays)) {
                  continue;
                }

                const conflictKey = generateConflictKey(sid1, sid2, teamId, request.versionId);

                if (conflictStore.has(conflictKey)) {
                  duplicatesFound++;
                  continue;
                }

                // Create alert with full labeling, summary, detection date, attachment
                const alert = ConflictAlertFactory.createAlert(
                  {
                    id: r1.stakeholderId,
                    name: r1.stakeholder.name || r1.stakeholderId,
                    role: r1.stakeholder.role,
                    email: r1.stakeholder.email,
                  } as any,
                  {
                    id: r2.stakeholderId,
                    name: r2.stakeholder.name || r2.stakeholderId,
                    role: r2.stakeholder.role,
                    email: r2.stakeholder.email,
                  } as any,
                  {
                    id: teamId,
                    name: r1.team.name || r2.team.name || teamId,
                    organization: r1.team.organization,
                  } as any,
                  teamId,
                  r1.priority,
                  r2.priority,
                  [r1.id, r2.id],
                  request.versionId
                );

                // Ensure detection date is set
                alert.detectedAt = new Date().toISOString();

                conflictStore.set(conflictKey, alert);
                newConflicts.push(alert);
              }
            }
          }
        }
      }

      return {
        success: true,
        conflicts: newConflicts,
        duplicatesFound,
      };
    } catch (error) {
      return {
        success: false,
        conflicts: [],
        duplicatesFound: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if two requests are in the same review window
   * Uses reviewWindowStart/End if present, otherwise createdAt proximity
   */
  private isInSameReviewWindow(
    r1: any,
    r2: any,
    windowThresholdDays?: number
  ): boolean {
    const threshold = windowThresholdDays ?? this.rule.windowConstraints.defaultDays;

    // If explicit review windows exist, check overlap
    if (r1.reviewWindowStart && r1.reviewWindowEnd && r2.reviewWindowStart && r2.reviewWindowEnd) {
      const start1 = new Date(r1.reviewWindowStart).getTime();
      const end1 = new Date(r1.reviewWindowEnd).getTime();
      const start2 = new Date(r2.reviewWindowStart).getTime();
      const end2 = new Date(r2.reviewWindowEnd).getTime();
      // Windows overlap if one starts before the other ends
      return start1 <= end2 && start2 <= end1;
    }

    // Otherwise use versionId as window proxy - same versionId = same window
    if (r1.versionId && r2.versionId) {
      return r1.versionId === r2.versionId;
    }

    // Fallback: createdAt proximity within threshold days
    const createdDiff = Math.abs(new Date(r1.createdAt).getTime() - new Date(r2.createdAt).getTime());
    const thresholdMs = threshold * 24 * 60 * 60 * 1000;
    return createdDiff <= thresholdMs;
  }

  /**
   * Group requests by team
   */
  private groupRequestsByTeamAndWindow(
    requests: any[],
    _windowThresholdDays?: number
  ): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};

    for (const req of requests) {
      const teamId = req.teamId || 'unknown';
      if (!grouped[teamId]) {
        grouped[teamId] = [];
      }
      grouped[teamId].push(req);
    }

    return grouped;
  }

  /**
   * Get all stored conflicts (for list API)
   */
  listConflicts(query: {
    status?: string;
    versionId?: string;
    teamId?: string;
    stakeholderId?: string;
    severity?: string;
  }): ConflictAlert[] {
    let result = Array.from(conflictStore.values());

    if (query.status && query.status !== 'all') {
      result = result.filter((c) => c.status === query.status);
    }
    if (query.versionId) {
      result = result.filter((c) => c.versionIds.includes(query.versionId!));
    }
    if (query.teamId) {
      result = result.filter((c) => c.key.teamId === query.teamId);
    }
    if (query.stakeholderId) {
      result = result.filter((c) =>
        c.stakeholders.some((s) => s.stakeholderId === query.stakeholderId)
      );
    }
    if (query.severity) {
      result = result.filter((c) => c.severity === query.severity);
    }

    // Sorted by detection date desc
    return result.sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }

  getConflictById(id: string): ConflictAlert | undefined {
    return conflictStore.get(id) || Array.from(conflictStore.values()).find((c) => c.id === id);
  }

  resolveConflict(
    id: string,
    action: 'acknowledged' | 'resolved' | 'dismissed',
    note?: string,
    resolverUserId?: string
  ): ConflictAlert | null {
    const existing = this.getConflictById(id);
    if (!existing) return null;

    const updated: ConflictAlert = {
      ...existing,
      status: action as any,
      resolutionNote: note,
      resolvedBy: resolverUserId,
      resolvedAt: new Date().toISOString(),
    };

    // Update in store by key
    const key = generateConflictKey(
      existing.key.stakeholderId1,
      existing.key.stakeholderId2,
      existing.key.teamId,
      existing.key.versionId
    );
    conflictStore.set(key, updated);
    // Also index by id for direct lookup
    if (key !== id) conflictStore.set(id, updated);

    return updated;
  }

  getActiveRule(): ConflictRule {
    return this.rule;
  }

  updateRule(rule: ConflictRule): ConflictRule {
    this.rule = rule;
    return this.rule;
  }
}

// Singleton instance
export const conflictDetectionService = new ConflictDetectionService();
