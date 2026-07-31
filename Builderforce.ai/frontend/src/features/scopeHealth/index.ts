/**
 * Scope Health feature barrel export.
 *
 * Import the dashboard component, hook, or types from here:
 *
 *   import { ScopeHealthDashboard } from '@/features/scopeHealth';
 *   import { useScopeHealth } from '@/features/scopeHealth';
 *   import type { Task, ScopeCreepScore, ... } from '@/features/scopeHealth';
 */

export { ScopeHealthDashboard } from './ScopeHealthDashboard';
export type {
  ScopeHealthDashboardProps,
} from './ScopeHealthDashboard';

export { useScopeHealth } from './hooks/useScopeHealth';
export type {
  UseScopeHealthParams,
} from './hooks/useScopeHealth';

export type {
  Task,
  CalculationMode,
  TimeWindow,
  Period,
  BaselineInfo,
  Epic,
  EpicStatus,
  RatioStatus,
  CreepStatus,
  ScopeCreepScore,
  NewVsCompletedRatio,
  EpicCompletion,
  ScopeHealthScore,
  ScopeHealthConfig,
  DrillDownItem,
} from './types';
