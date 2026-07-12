/**
 * Formal Conflict Rule Specification
 * 
 * Defines the formal specification for the conflict detection rule:
 * "Detect when two distinct stakeholders submit requests that assign
 * different P0 priorities to the same team within the same review window."
 */

import { z } from 'zod';
import type { ConflictRule } from './types.js';

/**
 * Conflict Rule Spec: Formal Definition
 */
export const CONFLICT_RULE_SPEC: ConflictRule = {
  name: 'Stakeholder-Priority Conflict Detection',
  description: 'Detect conflicts when two distinct stakeholders assign different P0 priorities to the same team within the same review window.',
  severityLevels: [
    {
      level: 'critical',
      condition: 'Both stakeholders assign P0 priority to the same team',
      threshold: 1
    },
    {
      level: 'high',
      condition: 'One stakeholder assigns P0 while another assigns P1',
      threshold: 1
    },
    {
      level: 'medium',
      condition: 'Different stakeholders assign regular priorities to same team',
      threshold: 2
    },
    {
      level: 'low',
      condition: 'Minor priority differences or no active conflicts',
      threshold: 0
    }
  ],
  stakeholderConstraints: {
    mustBeDistinct: true,
    maxConcurrentRequestsPerStakeholder: undefined // No limit for conflict detection
  },
  priorityConstraints: {
    minThreshold: 'P0' as PriorityLevel, // All conflicts must involve P0
    maxThreshold: 'P0' as PriorityLevel, // Only P0 vs P0 conflicts are critical
    exactMatch: false // P0 vs P1 or P0 vs P2 both qualify
  },
  teamConstraints: {
    allowMultipleTeams: false, // Only same team
    teamScope: 'organization-wide' // Check across all teams
  },
  windowConstraints: {
    defaultDays: 30, // 30-day review window
    maxWindowDays: 90, // Cutoff for historical data
    allowOverlap: true
  }
};

/**
 * Validation schema for requests to be evaluated for conflict detection
 */
const RequestValidationSchema = z.object({
  id: z.string().min(1, 'Request ID is required'),
  title: z.string().min(1, 'Request title is required'),
  description: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3'], { message: 'Priority must be P0, P1, P2, or P3' }),
  stakeholderId: z.string().min(1, 'Stakeholder ID is required'),
  stakeholder: z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    email: z.string().optional()
  }).required('Stakeholder details are required'),
  teamId: z.string().min(1, 'Team ID is required'),
  team: z.object({
    name: z.string().optional(),
    organization: z.string().optional()
  }).required('Team details are required'),
  versionId: z.string().optional(),
  reviewWindowStart: z.string().datetime({ message: 'Review window start must be a valid ISO 8601 datetime' }).optional(),
  reviewWindowEnd: z.string().datetime({ message: 'Review window end must be a valid ISO 8601 datetime' }).optional(),
  createdAt: z.string().datetime({ message: 'Created at must be a valid ISO 8601 datetime' }).required(),
  updatedAt: z.string().datetime().optional(),
  sourceSystem: z.string().optional()
}).refine(
  (data) => {
    // Validate window if provided
    if (data.reviewWindowStart && data.reviewWindowEnd) {
      const start = new Date(data.reviewWindowStart).getTime();
      const end = new Date(data.reviewWindowEnd).getTime();
      return start < end;
    }
    return true;
  },
  { message: 'Review window start must be before end', path: ['reviewWindowEnd'] }
);

/**
 * Validate that requests meet the criteria for conflict detection
 */
export function validateRequestsForConflictDetection(
  requests: any[],
  windowThresholdDays: number = 30
): any[] {
  const result = RequestValidationSchema.array().parse(requests);
  
  // Convert to objects and normalize
  return result.map(req => ({
    id: req.id,
    title: req.title,
    description: req.description,
    priority: req.priority as 'P0' | 'P1' | 'P2' | 'P3',
    stakeholderId: req.stakeholderId,
    stakeholder: req.stakeholder,
    teamId: req.teamId,
    team: req.team,
    versionId: req.versionId,
    reviewWindowStart: req.reviewWindowStart ? new Date(req.reviewWindowStart) : undefined,
    reviewWindowEnd: req.reviewWindowEnd ? new Date(req.reviewWindowEnd) : undefined,
    createdAt: new Date(req.createdAt),
    updatedAt: req.updatedAt ? new Date(req.updatedAt) : undefined,
    sourceSystem: req.sourceSystem
  }));
}

/**
 * Evaluate conflicting requests against the rule
 * Returns true if the rule is triggered
 */
export function evaluateAgainstRule(request: any): boolean {
  // Rule requires:
  // 1. Priority is P0
  // 2. There are at least 2 requests
  // 3. Requests are from distinct stakeholders
  // 4. Requests are for the same team
  // 5. Requests are within the same review window
  
  const priority = request.priority;
  
  // Condition 1: Priority must be P0
  if (priority !== 'P0') {
    return false;
  }
  
  // Conditions 2, 3, 4, 5 will be evaluated during batch detection
  // This function just checks the shared priority condition
  
  return true;
}

/**
 * Get rule details for display
 */
export function getRuleSpecification() {
  return {
    rule: CONFLICT_RULE_SPEC,
    schema: RequestValidationSchema,
    priorityCondition: `Rules are triggered when requests have priority '${CONFLICT_RULE_SPEC.priorityConstraints.minThreshold}'`,
    stakeholderCondition: `Rules require distinct stakeholders (max ${CONFLICT_RULE_SPEC.stakeholderConstraints.maxConcurrentRequestsPerStakeholder} per stakeholder)`,
    teamCondition: `Rules check conflicts within the same organization team`,
    windowCondition: `Review window default: ${CONFLICT_RULE_SPEC.windowConstraints.defaultDays} days (max: ${CONFLICT_RULE_SPEC.windowConstraints.maxWindowDays} days)`
  };
}

/**
 * Export other helper types
 */
export type {
  PriorityLevel,
  ConflictStatus,
  ConflictSeverity,
  Stakeholder,
  Team,
  PriorityRequest,
  ConflictingPriorities,
  ConflictKey,
  ConflictAlert,
  DetectConflictsRequest,
  DetectConflictsResponse,
  ResolveConflictRequest
};