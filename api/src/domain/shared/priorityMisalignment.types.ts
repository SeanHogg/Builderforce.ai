/**
 * Priority Misalignment Types and Interfaces
 *
 * Defines the domain model for priority misalignment detection and flagging.
 */

/**
 * Priority levels ordered from highest to lowest
 */
export enum PriorityLevel {
  URGENT = 'urgent',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/**
 * Map of priority levels to numerical weights for deviation calculations
 */
export const PriorityWeight = {
  [PriorityLevel.URGENT]: 4,
  [PriorityLevel.HIGH]: 3,
  [PriorityLevel.MEDIUM]: 2,
  [PriorityLevel.LOW]: 1,
};

/**
 * Microservice-controlled rule enums
 */
export enum MisalignmentRuleType {
  HIERARCHICAL = 'hierarchical', // Child vs parent priority
  STRATEGIC = 'strategic', // Task vs initiative/OKR priority
  DEPENDENCY = 'dependency', // Blocked task vs blocker priority
}

export enum RuleSeverity {
  WARNING = 'warning',
  ERROR = 'error',
}

/**
 * Configuration for misalignment detection rules
 */
export interface MisalignmentRule {
  id: string;
  projectId: number | null; // null = workspace-wide
  type: MisalignmentRuleType;
  enabled: boolean;
  severity: RuleSeverity;
  threshold: number; // Minimum deviation in priority levels
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of misalignment detection check
 */
export interface MisalignmentCheck {
  taskId: number;
  ruleId: string;
  type: MisalignmentRuleType;
  severity: RuleSeverity;
  detachedReason?: string; // Why the check was not performed (e.g., no parent, not linked to initiative)
  details: MisalignmentDetails;
  createdAt: Date;
}

/**
 * Detailed explanation of a misalignment
 */
export interface MisalignmentDetails {
  reason: string; // Human-readable explanation
  parentPriority?: PriorityLevel;
  childPriority: PriorityLevel;
  deviation: number; // Absolute difference in priority levels
  expected?: PriorityLevel; // What the priority SHOULD be based on rule
  actionableHint?: string; // Suggested action for user
}

/**
 * Aggregated misalignment state for a task
 */
export interface TaskMisalignmentState {
  taskId: number;
  hasMisalignment: boolean;
  ruleIds: string[];
  totalSeverity: RuleSeverity;
  issues: MisalignmentCheck[];
}

/**
 * Query parameters for misalignment checks
 */
export interface MisalignmentQuery {
  projectId?: number;
  taskId?: number;
  ruleType?: MisalignmentRuleType;
  severity?: RuleSeverity;
  enabledOnly?: boolean;
}

/**
 * Request to create/activate a new rule
 */
export interface CreateMisalignmentRuleRequest {
  projectId?: number | null;
  type: MisalignmentRuleType;
  enabled: boolean;
  threshold: number;
  description: string;
}

/**
 * Request to update an existing rule
 */
export interface UpdateMisalignmentRuleRequest {
  enabled?: boolean;
  threshold?: number;
  description?: string;
}