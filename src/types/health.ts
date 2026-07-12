/**
 * Scope Health Dashboard Types
 *
 * Domain models for Scope Creep, New/Done Ratio, Epic Completion metrics
 */

/**
 * Calculation mode for Scope Health metrics
 */
export type MetricMode = 'item-count' | 'story-points';

/**
 * Time window for New/Done Ratio calculations
 */
export type TimeWindow = 'current-sprint' | '7-days' | '14-days' | '30-days' | 'current-quarter';

/**
 * Scope Creep Status based on the calculated score
 */
export type CreepStatus = 'green' | 'yellow' | 'red';

/**
 * Epic Health Status based on expected vs actual completion
 */
export type EpicHealthStatus = 'on-track' | 'at-risk' | 'off-track';

/**
 * Weight configuration for composite Scope Health Score
 */
export interface HealthScoreWeights {
  creepScore: number; // Default 40%
  newVsDoneRatio: number; // Default 30%
  epicCompletion: number; // Default 30%
}

/**
 * Baseline lock record
 */
export interface BaselineLock {
  id: string;
  projectId: string;
  lockedAt: Date;
  lockedBy: string;
  itemCount?: number;
  storyPointSum?: number;
  baselineItems: BaselineItem[];
  description: string;
}

/**
 * Baseline item that was locked at the start of a sprint/phase
 */
export interface BaselineItem {
  id: string;
  title: string;
  type: 'task' | 'story' | 'bug' | 'epic';
  storyPoints?: number;
  addedAt: Date;
}

/**
 * Work item from external integrations (Jira, Linear, GitHub)
 */
export interface ExternalWorkItem {
  id: string;
  title: string;
  type: 'task' | 'story' | 'bug' | 'epic';
  epicId?: string;
  status?: string;
  storyPoints?: number;
  creator?: string;
  createdAt: Date;
  completedAt?: Date;
  externalSource: 'jira' | 'linear' | 'github';
  externalKey: string;
}

/**
 * Aggregated work item for metric calculations
 */
export interface WorkItem {
  id: string;
  type: 'task' | 'story' | 'bug' | 'epic';
  title: string;
  epicId?: string;
  status: 'backlog' | 'todo' | 'ready' | 'in-progress' | 'in-review' | 'done' | 'blocked';
  storyPoints?: number;
  creator?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Scope Creep Score result
 */
export interface ScopeCreepScore {
  score: number; // Percentage (0-100)
  status: CreepStatus;
  itemsAddedAfterBaseline: number;
  baselineItemCount: number;
  baselineLockedAt: Date;
  lastChangeAt?: Date;
  trend: number[]; // Historical trend over 8 sprints/time periods
}

/**
 * New vs. Completed Work Ratio result
 */
export interface NewVsCompletedRatio {
  addedCount: number;
  addedPoints: number;
  completedCount: number;
  completedPoints: number;
  ratio: number; // Items/Points Added / Completed
  status: 'healthy' | 'warning'; // Warning if > 1.0
  window: TimeWindow;
  timeRangeStart: Date;
  timeRangeEnd: Date;
}

/**
 * Individual work item in the New/Done list
 */
export interface NewWorkItemDetail {
  id: string;
  title: string;
  type: 'task' | 'story' | 'bug';
  epicId?: string;
  epicName?: string;
  creator?: string;
  addedAt: Date;
  addedPoints?: number;
  isCompleted: boolean;
  completedAt?: Date;
}

/**
 * Epic Completion result
 */
export interface EpicCompletion {
  epicId: string;
  epicName: string;
  owner?: string;
  dueDate?: Date;
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
  completionPercentage: number;
  expectedCompletionPercentage: number;
  healthStatus: EpicHealthStatus;
  daysUntilDue?: number;
  estimate: 'items' | 'points';
}

/**
 * Epic Health Event (used in history tracking)
 */
export interface EpicHealthEvent {
  epicId: string;
  epicName: string;
  status: EpicHealthStatus;
  occurredAt: Date;
  reason?: string;
  metricValues?: Partial<Partial<EpicCompletion>>;
}

/**
 * Composite Scope Health Score result
 */
export interface ScopeHealthSummary {
  compositeScore: number; // 0-100
  weights: HealthScoreWeights;
  componentScores: {
    creepScore: number;
    newVsDoneRatio: number;
    epicCompletion: number;
  };
  lastComputedAt: Date;
  history: ScopeHealthScoreHistoryEntry[];
}

/**
 * Single entry in health history
 */
export interface ScopeHealthScoreHistoryEntry {
  timestamp: Date;
  date: string; // ISO date string
  compositeScore: number;
  creepScore?: number;
  newVsDoneRatio?: number;
  epicCompletion?: number;
  events?: Array<{
    type: 'baseline-lock' | 'sprint-boundary' | 'major-scope-addition' | 'epic-status-change';
    epicId?: string;
    description: string;
  }>;
}

/**
 * Scope Health Query Parameters
 */
export interface ScopeHealthQuery {
  projectId: string;
  mode?: MetricMode;
  timeWindow?: TimeWindow;
  includeDetails?: boolean;
  includeHistory?: boolean;
}

/**
 * Scope Health Response
 */
export interface ScopeHealthResponse {
  project: {
    id: string;
    name: string;
  };
  scores: {
    creepScore: ScopeCreepScore;
    newVsCompleted: NewVsCompletedRatio;
    epicCompletions: EpicCompletion[];
    summary: ScopeHealthSummary;
  };
  baselineLock?: BaselineLock;
  events?: EpicHealthEvent[];
}