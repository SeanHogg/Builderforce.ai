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

export interface CalibrationStatus {
  overallSuccess: boolean;
  lastCalibrationRun?: CalibrationRun;
  nextScheduledRun?: string;
  sprintsCollected: number;
  agentsWithVelocity: number;
  utilizationAccuracyDelta: number;
  projectedDaysRemaining: number;
}

export interface ProjectFilter {
  tenantId: string;
  projectId?: string;
  projectNames?: string[];
}

export interface ProjectViewModel {
  projectId: string;
  projectName: string;
  agentId: string;
  hoursAllocated: number;
  hoursBilled: number;
  utilizationPercent: number;
  enabled: boolean;
  locked: boolean;
  effectiveDate: string;
}

export interface MapUtilizationFromRosterMutation {
  sourceProjectId: string;
  targetProjectId: string;
  projectMappings: {
    sourceProject: string;
    targetProject: string;
    mappedToTargetProject: boolean;
    affectedRows: number;
    errors: string[];
  }[];
  summary: {
    totalMappings: number;
    successfulMappings: number;
    failedMappings: number;
    accuracyImprovement: number;
  };
}