/**
 * Types for Scope Health feature — self-contained domain model.
 *
 * This file is the SOLE type authority for the Scope Health feature.
 * The hook (useScopeHealth.ts) and dashboard (ScopeHealthDashboard.tsx)
 * import everything from here.
 */

/* ── Core domain: Task (the work-item the metrics operate on) ─────────────── */

export interface Task {
  id: string;
  title: string;
  type?: 'task' | 'story' | 'bug' | 'epic';
  status: 'backlog' | 'todo' | 'ready' | 'in-progress' | 'in-review' | 'done' | 'blocked';
  parentTaskId?: string | number;
  storyPoints?: number;
  creator?: string;
  createdAt: string;       // ISO date string
  completedAt?: string;     // ISO date string — when the item was marked done
  updatedAt?: string;       // ISO date string
  dueDate?: string;         // ISO date string — deadline (used for epic timeline)
}

/* ── Configuration ──────────────────────────────────────────────────────── */

export type CalculationMode = 'item_count' | 'story_points';

export type TimeWindow =
  | 'current_sprint'
  | '7_days'
  | '14_days'
  | '30_days'
  | 'current_quarter';

export interface Period {
  windowStart: string; // ISO date string
  windowEnd: string;   // ISO date string
  label: string;
}

export interface BaselineInfo {
  id: string;
  lockedAt: string; // ISO date string
  itemCount: number;
  totalStoryPoints?: number;
}

/* ── Epic ───────────────────────────────────────────────────────────────── */

export interface Epic {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;        // ISO date string — deadline
  createdAt?: string;      // ISO date string — when the epic was created
  totalItems: number;
  totalStoryPoints?: number;
  completedItems: number;
  completedStoryPoints?: number;
  addedItems: number;      // items created in the current window
  addedStoryPoints?: number;
}

/* ── Status enums ───────────────────────────────────────────────────────── */

export type EpicStatus = 'on_track' | 'at_risk' | 'off_track';
export type RatioStatus = 'normal' | 'warning';
export type CreepStatus = 'green' | 'yellow' | 'red';

/* ── Metric results ─────────────────────────────────────────────────────── */

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
  /** Items added (created) in the window — for drill-down (FR-2.4). */
  addedInWindow: Task[];
  /** Items completed in the window — for drill-down (FR-2.4). */
  completedInWindow: Task[];
}

export interface EpicCompletion {
  epic: Epic;
  completionPercentage: number;
  status: EpicStatus;
  expectedCompletionPercentage: number;
  deltaPercentage: number;
}

export interface ScopeHealthScore {
  value: number; // 0–100
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

/* ── Config (exposed for embeddable / admin use) ────────────────────────── */

export interface ScopeHealthConfig {
  calculateBy?: CalculationMode;
  defaultWindow?: TimeWindow;
  weights?: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  };
}

/* ── Drill-down (FR-2.4) ───────────────────────────────────────────────── */

export interface DrillDownItem {
  id: string;
  title: string;
  type: string;
  status: Task['status'];
  storyPoints: number;
  creator: string;
  addedDate: string;
  completedDate: string;
  epicName: string;
}
