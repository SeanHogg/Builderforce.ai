/**
 * Capacity Estimation Types
 * 
 * Empirical velocity calibration for capacity modeling after 1-2 sprints of actual throughput.
 */

export interface EmpiricalVelocityEntry {
  id: number;
  tenantId: string;
  projectId: string;
  agentId: string;
  sprintNum: number;
  sprintStartDate: string; // ISO date
  sprintEndDate: string; // ISO date
  storyPointsCompleted: number;
  utilizationHours: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentUtilizationProfile {
  id: number;
  tenantId: string;
  projectId: string;
  agentId: string;
  currentUtilizationPercent: number; // 0-100
  assumedUtilizationPercent: number | null; // legacy 0.4h/SP ≈ 40% average
  assumedSpPerHour: number | null; // ~2.5 SP per hour @ 0.4h/SP
  accuracyMarginPercent: number | null; // ±5% target accuracy
  lastUpdated: string;
  lastLiveRosterSync: string | null;
}

export interface ProjectEmpiricalVelocity {
  id: number;
  tenantId: string;
  projectId: string;
  totalSprints: number;
  avgVelocitySpPerSprint: number | null;
  minVelocitySpPerSprint: number | null;
  maxVelocitySpPerSprint: number | null;
  velocityStabilityScore: number | null; // 0.0-1.0
  updatedAt: string;
}

export interface ValidationGapEstimate {
  id: number;
  tenantId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskType: 'task' | 'epic' | 'gap';
  microSpEstimate: number;
  estimatedRangeMinSp: number;
  estimatedRangeMaxSp: number;
  estimationMethod: 'micro_estimation' | 'range_median' | 'manual';
  assumedSpEstimate?: number | null;
  assumedRangeMedianSp?: number | null;
  isMicroEstimated: boolean;
  updatedAt: string;
}

export interface SprintInterval {
  sprintNum: number;
  startDate: string;
  endDate: string;
}

export interface AgentVelocityProfile {
  agentId: string;
  agentName?: string;
  totalSprints: number;
  totalStoryPointsCompleted: number;
  avgVelocitySpPerSprint: number;
  minVelocitySpPerSprint: number;
  maxVelocitySpPerSprint: number;
  velocityStabilityScore: number;
  recentSprints: SprintInterval[];
}

export interface CapacityProjectionUpdate {
  projectId: string;
  totalEstimatedStoryPoints: number;
  daysToCompletion: number;
  scenarioADelta: number;
  scenarioBDelta: number;
  agentBuckets: AgentCapacityBucket[];
}

export interface AgentCapacityBucket {
  agentId: string;
  agentName?: string;
  remainingStoryPoints: number;
  utilizationPercent: number;
  estimatedDays: number;
}

export interface UtilizationMappingResult {
  success: boolean;
  agentCountMapped: number;
  agents: {
    agentId: string;
    currentUtilizationPercent: number;
    assumedUtilizationPercent?: number;
    accuracyImprovement: number;
  }[];
  totalUtilizationHours: number;
  assigneeApiCallStatus: 'success' | 'error';
}

/**
 * Constants for capacity estimation
 */
export const CAPACITA_CONFIG = {
  ASSUMED_MONTHLY_HOURS: 160, // standard 40h/week × 4 weeks
  ASSUMED_SP_PER_HOUR: 2.5, // based on 0.4h/SP utilization factor
  MIN_SPRINTS_FOR_VELOCITY: 1, // need at least 1 completed sprint
  VET_SPRINTS_FOR_VELOCITY: 2, // ideally 2 sprints for stable estimate
  TARGET_ACCURACY_MARGIN_PCT: 5, // ±5% target accuracy
  DEFAULT_PROJECT_SP_PER_SPRINT_RANGE: [34, 59], // current 50-gap midpoint range
  SCENARIO_A_WEIGHT: 0.6, // Scenario A weights 60% in projections
  SCENARIO_B_WEIGHT: 0.4, // Scenario B weights 40% in projections
} as const;

/**
 * Utilization ranges for validation
 */
export const UTILIZATION_RANGES = {
  HIGH: { min: 75, max: 100 },
  MID: { min: 50, max: 75 },
  LOW: { min: 25, max: 50 },
} as const;