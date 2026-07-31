/**
 * Conflict Rule Specification — Formal Rule Definition
 *
 * Per PRD Section 1 - Conflict Detection Engine:
 * "Implement a specific rule: Detect when two distinct stakeholders submit
 * requests that assign different P0 priorities to the same team within the
 * same review window."
 *
 * This file formally specifies that rule with complete constraints.
 */

import type { ConflictRule } from './types.js';
import { PRIORITY_LEVELS, type PriorityLevel } from './types.js';

/**
 * CONFLICT_RULE_SPEC — Formal Specification
 *
 * Name: team-p0-multi-stakeholder-conflict
 * Rule Logic:
 *   IF   stakeholder_1 != stakeholder_2
 *   AND  priority(request_1) == P0
 *   AND  priority(request_2) == P0
 *   AND  team(request_1) == team(request_2)
 *   AND  review_window(request_1) overlaps review_window(request_2)
 *   THEN generate ConflictAlert
 *
 * This corresponds to the scenario where:
 * - Two distinct stakeholders both set P0 for the same team
 *   (implicitly conflicting because one team's P0 bandwidth is limited)
 * - OR one stakeholder's P0 conflicts with another's P0 on same team
 *
 * Note on "different P0 priorities": interpreted as "distinct requests
 * (different items) that both claim P0 for the same team in same window"
 * — i.e. competing P0s. Alternative reading ("different priority levels
 * where at least one is P0") is supported via config but defaults to P0-vs-P0.
 */
export const CONFLICT_RULE_SPEC: ConflictRule = {
  name: 'team-p0-multi-stakeholder-conflict',
  description:
    'Detects when two distinct stakeholders submit requests assigning conflicting P0 priorities to the same team within the same review window. ' +
    'Formally: IF stakeholder_1 <> stakeholder_2 AND priority(req1)=P0 AND priority(req2)=P0 AND team(req1)=team(req2) AND reviewWindow(req1) OVERLAPS reviewWindow(req2) THEN ConflictAlert. ' +
    'This prevents resource double-booking for a single team at P0 within one review cycle.',

  severityLevels: [
    {
      level: 'critical',
      condition: 'P0 vs P0 conflict on same team within same review window',
      threshold: 1,
    },
    {
      level: 'high',
      condition: 'P0 vs P1 conflict on same team within same review window',
      threshold: 2,
    },
    {
      level: 'medium',
      condition: 'Multiple high-priority assignments exceeding team capacity',
      threshold: 3,
    },
  ],

  stakeholderConstraints: {
    mustBeDistinct: true,
    maxConcurrentRequestsPerStakeholder: 10,
  },

  priorityConstraints: {
    minThreshold: 'P0',
    maxThreshold: 'P0',
    exactMatch: true,
  },

  teamConstraints: {
    allowMultipleTeams: false,
    teamScope: 'single-team',
  },

  windowConstraints: {
    defaultDays: 7,
    maxWindowDays: 30,
    allowOverlap: true,
  },
};

/**
 * Alternative / extended rule spec that also captures P0-vs-P1 cross conflicts
 * Useful for broader prioritization governance
 */
export const CONFLICT_RULE_SPEC_EXTENDED: ConflictRule = {
  name: 'team-p0-vs-any-conflict',
  description:
    'Extended rule: detects P0 vs P0 conflicts AND P0 vs P1 conflicts when stakeholders differ for same team within same review window.',
  severityLevels: [
    { level: 'critical', condition: 'P0 vs P0 same team same window', threshold: 1 },
    { level: 'high', condition: 'P0 vs P1 same team same window', threshold: 1 },
  ],
  stakeholderConstraints: {
    mustBeDistinct: true,
    maxConcurrentRequestsPerStakeholder: 20,
  },
  priorityConstraints: {
    minThreshold: 'P0',
    maxThreshold: 'P1',
    exactMatch: false,
  },
  teamConstraints: {
    allowMultipleTeams: false,
    teamScope: 'single-team',
  },
  windowConstraints: {
    defaultDays: 7,
    maxWindowDays: 30,
    allowOverlap: true,
  },
};

/**
 * Priority ordering helper - P0 highest
 */
export function comparePriorities(a: PriorityLevel, b: PriorityLevel): number {
  const order: Record<PriorityLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (order[a] ?? 999) - (order[b] ?? 999);
}

/**
 * Check if a given priority is at or above a threshold (e.g. P0 <= threshold)
 */
export function isPriorityAtOrAbove(priority: PriorityLevel, threshold: PriorityLevel): boolean {
  return comparePriorities(priority, threshold) <= 0;
}

/**
 * Validate a raw request object before conflict detection
 */
export function validateRequestsForConflictDetection(
  rawRequests: any[],
  thresholdDays: number = 7
): any[] {
  if (!Array.isArray(rawRequests)) {
    throw new Error('requests must be an array');
  }
  if (rawRequests.length === 0) {
    return [];
  }

  return rawRequests.filter((req) => {
    // Required fields per rule
    if (!req.stakeholderId) return false;
    if (!req.teamId) return false;
    if (!req.priority) return false;
    if (!PRIORITY_LEVELS.includes(req.priority as PriorityLevel)) return false;
    return true;
  });
}

/**
 * Review window helpers
 */
export interface ReviewWindow {
  start: Date;
  end: Date;
}

export function parseReviewWindow(request: {
  reviewWindowStart?: string;
  reviewWindowEnd?: string;
  versionId?: string;
  createdAt?: string;
}): ReviewWindow | null {
  if (request.reviewWindowStart && request.reviewWindowEnd) {
    return {
      start: new Date(request.reviewWindowStart),
      end: new Date(request.reviewWindowEnd),
    };
  }
  return null;
}

export function windowsOverlap(w1: ReviewWindow, w2: ReviewWindow): boolean {
  return w1.start.getTime() <= w2.end.getTime() && w2.start.getTime() <= w1.end.getTime();
}
