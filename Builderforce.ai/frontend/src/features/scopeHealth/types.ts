/**
 * Types for Scope Health feature — UI awareness model
 */

// Use minimal exported shapes; we don’t expose internal code in the PR.
export type CalculationMode = 'item_count' | 'story_points';

// Baseline info with responsibly scoped projection fields
export interface BaselineInfo {
  id: string;
  lockedAt: string; // ISO date string
  itemCount: number;
  totalStoryPoints?: number;
}

export type TimeWindow = 'current_sprint' | '7_days' | '14_days' | '30_days' | 'current_quarter';

// Period identifier (for historical analysis)
export interface Period {
  windowStart: string; // ISO date string
  windowEnd: string; // ISO date string
  label: string;
}

// Epic metadata (projection)
export interface Epic {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string; // ISO date string
  totalItems: number;
  totalStoryPoints?: number;
  completedItems: number;
  completedStoryPoints?: number;
  addedItems: number; // items created in this period
  addedStoryPoints?: number;
}

export type EpicStatus = 'on_track' | 'at_risk' | 'off_track';
export type RatioStatus = 'normal' | 'warning';
export type CreepStatus = 'green' | 'yellow' | 'red';

// Result shapes
export interface ScopeCreepScore {
  value: number; // percentage 0-100
  status: CreepStatus;
  baselineItemCount: number;
  itemsAddedPostBaseline: number;
  percentageChange: number;
}

export interface NewVsCompletedRatio {
  value: number;
  status: RatioStatus;
  addedItems: number;
  addedStoryPoints: number;
  completedItems: number;
  completedStoryPoints: number;
}

export interface EpicCompletion {
  epic: Epic;
  completionPercentage: number;
  status: EpicStatus;
  expectedCompletionPercentage: number;
  deltaPercentage: number;
}

export interface ScopeHealthScore {
  value: number;
  breakdown: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  };
  weights: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  };
}

// Configuration for calculations
export interface ScopeHealthConfig {
  calculateBy?: CalculationMode;
  defaultWindow?: TimeWindow;
  weights?: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  };
}