/**
 * Capacity Estimation Type Definitions
 *
 * Common types shared by capacity-related services and routes.
 */

export interface UtilizationEntry {
  id: string;
  agentId: string;
  tenantId: string;
  projectName: string;
  hoursAllocated: number;
  hoursBilled: number;
  utilizationPercent: number;
  enabled: boolean;
  locked: boolean;
  effectiveDate: string;
}

export interface ViewModelProject {
  agentId: string;
  projectName: string;
  hoursAllocated: number;
  hoursBilled: number;
  utilizationPercent: number;
  enabled: boolean;
  locked: boolean;
  effectiveDate: string;
}

export interface CalibratedUtilizationProfile {
  agentId: string;
  tenantId: string;
  projectName: string;
  utilizationPercent: number;
  enabled: boolean;
  locked: boolean;
  effectiveDate: string;
}

export interface CalibratedProjectMapping {
  sourceProjectId: string;
  targetProjectId: string;
  projectMappings: {
    sourceProject: string;
    targetProject: string;
    mappedToTargetProject: boolean;
  }[];
}

export interface CalibrationPhaseResult {
  phase: string;
  success: boolean;
  timestamp: string;
  data: any;
  error?: string;
}

export interface CalibrationRun {
  projectId: string;
  tenantId: string;
  triggerSource: 'manual' | 'scheduled' | 'sprint-ending' | 'user-request';
  runs: CalibrationPhaseResult[];
  overallSuccess: boolean;
  summary: CalibrationSummary;
}

export interface CalibrationSummary {
  sprintsCollected: number;
  agentsWithVelocity: number;
  utilizationAccuracyDelta: number; // improvement in accuracy %
  projectionRefined: boolean;
  gapTotalImproved: number; // SP reduction from legacy estimate
}