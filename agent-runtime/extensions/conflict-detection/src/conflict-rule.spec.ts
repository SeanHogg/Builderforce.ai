/**
 * Conflict Rule Specification — Formal Rule Definition
 *
 * Per PRD:
 * "Detect when two distinct stakeholders submit requests that assign
 * different P0 priorities to the same team within the same review window."
 */

import type { ConflictRule } from './types.js';
import { PRIORITY_LEVELS, type PriorityLevel } from './types.js';

// ── Rule Specs ────────────────────────────────────────────────────────────────

export const CONFLICT_RULE_SPEC: ConflictRule = {
  name: 'team-p0-multi-stakeholder-conflict',
  description:
    'Detects when two distinct stakeholders submit requests assigning conflicting P0 priorities to the same team within the same review window. ' +
    'Formally: IF stakeholder_1 <> stakeholder_2 AND priority(req1)=P0 AND priority(req2)=P0 AND team(req1)=team(req2) AND reviewWindow(req1) OVERLAPS reviewWindow(req2) THEN ConflictAlert. ' +
    'This prevents resource double-booking for a single team at P0 within one review cycle.',

  severityLevels: [
    { level: 'critical', condition: 'P0 vs P0 conflict on same team within same review window', threshold: 1 },
    { level: 'high', condition: 'P0 vs P1 conflict on same team within same review window', threshold: 2 },
    { level: 'medium', condition: 'Multiple high-priority assignments exceeding team capacity', threshold: 3 },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function comparePriorities(a: PriorityLevel, b: PriorityLevel): number {
  const order: Record<PriorityLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (order[a] ?? 999) - (order[b] ?? 999);
}

export function isPriorityAtOrAbove(priority: PriorityLevel, threshold: PriorityLevel): boolean {
  return comparePriorities(priority, threshold) <= 0;
}

export function validateRequestsForConflictDetection(rawRequests: unknown[], _thresholdDays?: number): unknown[] {
  if (!Array.isArray(rawRequests)) {
    throw new Error('requests must be an array');
  }
  if (rawRequests.length === 0) return [];
  return (rawRequests as Array<Record<string, unknown>>).filter((req) => {
    if (!req || typeof req !== 'object') return false;
    if (!(req as { stakeholderId?: unknown }).stakeholderId) return false;
    if (!(req as { teamId?: unknown }).teamId) return false;
    if (!(req as { priority?: unknown }).priority) return false;
    if (!PRIORITY_LEVELS.includes((req as { priority: PriorityLevel }).priority)) return false;
    return true;
  });
}

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

export function evaluateAgainstRule(_r1: unknown, _r2: unknown): boolean {
  // Contract-preserving placeholder — rule evaluation itself lives in the service.
  // Retained because older tests may import it.
  return true;
}
