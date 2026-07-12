/**
 * Capacity Estimation TypeScript Type Definitions
 * 
 * Core type definitions for empirical velocity calibration, utilization mapping,
 * projection calculations, and validation gap micro-estimation.
 */

/**
 * Sprint completion data from delivery analysis
 */
export interface SprintEntry {
  /**
   * Unique identifier for the sprint number
   */
  sprintNum: number;

  /**
   * Start date of the sprint (ISO 8601)
   */
  sprintStartDate: string;

  /**
   * End date of the sprint (ISO 8601)
   */
  sprintEndDate: string;

  /**
   * Total story points completed in this sprint (sum across all agents)
   */
  totalStoryPoints_completed: number;

  /**
   * Total utilized hours across all agents in this sprint
   */
  utilizationHours: number;

  /**
   * Timestamp when this data point was aggregated
   */
  timestamp: string;
}

/**
 * Entity-backed measured capacity value
 */
export interface MeasuredCapacity {
  /**
   * Unique identifier for this capacity measurement
   */
  capacityId: string;

  /**
   * Project this capacity belongs to
   */
  projectId: string;

  /**
   * Time window this capacity applies to
   */
  windowStart: string;
  windowEnd: string;

  /**
   * Method used to calculate this value
   */
  calculationMethod: 'assumed' | 'empirical';

  /**
   * Calculated value (story points or hours)
   */
  value: number;

  /**
   * Timestamp of calculation
   */
  timestamp: string;
}

/**
 * Per-agency allocation with metrics
 */
export interface PerAgentCapacity {
  /**
   * Project
   */
  projectId: string;

  /**
   * Tenant
   */
  tenantId: string;

  /**
   * Project key
   */
  projectKey: string;

  /**
   * Agent ID
   */
  agentId: string;

  /**
   * Agent display name
   */
  agentName?: string;

  /**
   * Project Key/Group (builderforce/llm)
   */
  projectKey_group?: string;

  /**
   * Enqueue limit
   */
  enqueueLimit?: number;

  /**
   * Core throughput (hours)
   */
  coreThroughput?: number;

  /**
   * Total throughput (hours)
   */
  totalThroughput?: number;

  /**
   * Story points per sprint (empirical velocity)
   */
  sp_per_sprint?: number;

  /**
   * Story points per sprint (estimated mean)
   */
  sp_per_sprint_estimated_mean?: number;

  /**
   * Additional story points per sprint
   */
  sp_per_sprint_slope?: number;

  /**
   * Utilization hours
   */
  utilization_hours?: number;

  /**
   * SP / sprint (efficiency)
   */
  sp_per_sprint_efficiency?: number;

  /**
   * SP / sprint (efficiency) (estimated)
   */
  sp_per_sprint_efficiency_estimated_mean?: number;

  /**
   * Agency utilization hours
   */
  agency_utilization_hours?: number;

  /**
   * Projected hour capacity
   */
  PROJECT_beh_capacity_hours?: number;

  /**
   * Within-group SP / sprint (efficiency)
   */
  sp_per_sprint_efficiency_within_group?: number;

  /**
   * Detailed measurements (list of measurements)
   */
  measurements?: MeasuredCapacity[];

  /**
   * Confidence level
   */
  confidenceLevel?: 'high' | 'medium' | 'low';

  /**
   * Confidence score
   */
  confidenceScore?: number;
}

/**
 * Validation Gap micro-estimation input
 */
export interface ValidationGapInput {
  taskId: string;
  taskTitle: string;
  taskType: 'task' | 'epic' | 'gap';
  assumedHighSp: number;
  assumedLowSp: number;
  gapSizeCategory: 'small' | 'medium' | 'large' | 'critical';
  complexityScore?: number; // 1-10 (lower = more complex)
}

/**
 * Validation gap estimation result
 */
export interface ValidationGapEstimate {
  id: string;
  taskId: string;
  microSpEstimate: number;
  estimatedRangeMinSp: number;
  estimatedRangeMaxSp: number;
  estimationMethod: 'micro_estimation';
  confidenceLevel: 'high' | 'medium' | 'low';
  notes?: string;
}

/**
 * Gap micro-estimation batch result
 */
export interface GapMicroEstimationBatchResult {
  gapsAnalyzed: number;
  totalMicroSpEstimate: number;
  gapSummary: Array<{
    taskId: string;
    taskTitle: string;
    type: string;
    estimatedRangeMinSp: number;
    estimatedRangeMaxSp: number;
  }>;
  estimatedValue: {
    low: number; // Conservative estimate
    median: number; // Most likely value
    high: number; // Optimistic estimate
  };
}

/**
 * Command for creating a velocity entry
 */
export interface CreateVelocityEntryCommand {
  tenantId: string;
  projectId: string;
  agentId: string;
  sprintNum: number;
  sprintStartDate: string;
  sprintEndDate: string;
  storyPointsCompleted: number;
  utilizationHours?: number;
}

/**
 * Agent velocity calculation input
 */
export interface AgentVelocityInput {
  tenantId: string;
  projectId?: string;
  agentId: string;
}

/**
 * Agent velocity calculation result
 */
export interface AgentVelocityOutput {
  agentId: string;
  totalSprints: number;
  totalStoryPointsCompleted: number;
  avgVelocitySpPerSprint: number;
  confidenceScore?: number;
  confidenceLevel?: 'high' | 'medium' | 'low';
}

/**
 * Project velocity summary
 */
export interface ProjectVelocitySummary {
  projectId: string;
  tenantId: string;
  avgVelocitySpPerSprint: number;
  agentId: string;
  totalSprints: number;
  totalStoryPointsCompleted: number;
  confidenceScore?: number;
}

/**
 * Projection calculation input
 */
export interface ProjectionCalculationInput {
  projectId: string;
  tenantId: string;
  scenarioAWeight?: number;
  scenarioBWeight?: number;
  useEmpiricalVelocity?: boolean;
  remainingWorkByAgent: Array<{
    agentId: string;
    remainingStoryPoints: number;
  }>;
}

/**
 * Projected completion result
 */
export interface ProjectedCompletion {
  daysToCompletion: number;
  scenarioADelta: number;
  scenarioBDelta: number;
  scenarioADescription?: string;
  scenarioBDescription?: string;
}

/**
 * Utilization mapping configuration
 */
export interface UtilizationMappingConfig {
  useAssigneeApi: boolean;
  compareWithObservedHours?: boolean;
  confidenceThreshold?: number;
}

/**
 * Utilization mapping result
 */
export interface UtilizationMappingResult {
  success: boolean;
  agentCountMapped: number;
  assigneeApiCallStatus: 'success' | 'failed' | 'not_attempted';
  assigneeApiMessage?: string;
  assigneeApiData?: unknown;
  accuracyImprovement: number; // improvement in accuracy %
  utilizationMapping: Record<string, {
    agentId: string;
    utilizationHours: number;
    utilizationPercentage: number;
    calculatedFrom: 'assignee_api' | 'observed_hours';
  }>;
}

/**
 * Projection output
 */
export interface ProjectionOutput {
  projectId: string;
  tenantId: string;
  daysToCompletion: number;
  scenarioADelta: number;
  scenarioBDelta: number;
  confidenceLevel: 'high' | 'medium' | 'low';
}

/**
 * Assignee API health check result
 */
export interface AssigneeApiHealthResult {
  accessible: boolean;
  status: string;
  message: string;
  data?: unknown;
}

/**
 * Calibration run result
 */
export interface CalibrationRunResult {
  projectId: string;
  tenantId: string;
  triggerSource: 'manual' | 'scheduled' | 'sprint-ending' | 'user-request';
  phasesComplete: boolean;
  startedAt: string;
  completedAt: string;
  summary: CalibrationSummary;
  phases: CalibrationPhaseResult[];
}

/**
 * Calibration phase result
 */
export interface CalibrationPhaseResult {
  phase: string;
  success: boolean;
  timestamp: string;
  data?: unknown;
  error?: string;
}

/**
 * Calibration summary
 */
export interface CalibrationSummary {
  sprintsCollected: number;
  agentsWithVelocity: number;
  utilizationAccuracyDelta: number;
  projectionRefined: boolean;
  gapTotalImproved: number;
}

/**
 * Restful API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Context for assigning for capacity estimation
 */
export interface CapacityEstimationContext {
  /**
   * Project being estimated
   */
  projectId: string;

  /**
   * Current sprint number
   */
  currentSprint: number;

  /**
   * Last completed sprint
   */
  lastCompletedSprint: number;

  /**
   * Sprint rolling down/up status
   */
  sprintRolling: 'down' | 'up' | 'none';

  /**
   * Calculation method preference
   */
  calculationMethod: 'empirical' | 'assumed';

  /**
   * Analysis assumptions
   */
  assumptions: {
    minSprintsForVelocity: number;
    maxSprintsForVelocity: number;
    smoothingWindowSprints: number;
  };

  /**
   * Project window configuration
   */
  windowSpec: {
    slidingDays: number;
    minPeriodDays: number;
  };
}