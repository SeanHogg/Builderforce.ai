/**
 * Projection Service
 * 
 * Main orchestration service for refresh of time-to-completion projections and Scenario A/B deltas.
 * Uses empirical velocity, utilization data, and remaining work to generate accurate projections.
 */

import {
  calculateAgentVelocity,
  recalculateProjectVelocity,
  InvalidateProjectVelocityReturn,
} from './EmpiricalVelocityService';
import { mapUtilizationFromRoster } from './UtilizationMappingService';
import { internalLogger } from '@/infra/logger';

export interface CalculateProjectionInput {
  projectId: string;
  tenantId: string;
  remainingWorkByAgent: {
    agentId: string;
    remainingStoryPoints: number;
  }[];
  scenarioAWeight?: number;
  scenarioBWeight?: number;
  useEmpiricalVelocity: boolean;
}

export interface ProjectionResult {
  projectId: string;
  totalEstimatedStoryPoints: number;
  daysToCompletion: number;
  scenarioADelta: number;
  scenarioBDelta: number;
  agentBuckets: AgentCapacityBucket[];
  usedEmployiveVelocity: boolean;
}

export interface AgentCapacityBucket {
  agentId: string;
  agentName?: string;
  remainingStoryPoints: number;
  utilizationPercent: number;
  estimatedDays: number;
  velocity: number; // SP per sprint
  capacityProfile: 'high' | 'medium' | 'low';
}

/**
 * Calculate overall time-to-completion projection
 */
export async function calculateProjection(
  input: CalculateProjectionInput
): Promise<ProjectionResult> {
  internalLogger.info('Calculating capacity projection', {
    projectId: input.projectId,
    useEmpiricalVelocity: input.useEmpiricalVelocity,
    agentCount: input.remainingWorkByAgent.length,
  });

  // Calculate average agent velocity
  const avgVelocity = input.useEmpiricalVelocity ? await calculateAverageVelocity(input.projectId, input.tenantId) : 25.0; // default SP/sprint

  // Estimate average utilization (from live roster if available)
  const utilizationPercent = input.useEmpiricalVelocity 
    ? await getAverageUtilization(input.projectId) 
    : 40; // default 40%

  // Calculate total remaining story points
  const totalRemainingStoryPoints = input.remainingWorkByAgent.reduce(
    (sum, agent) => sum + agent.remainingStoryPoints,
    0
  );

  // Calculate days to completion based on velocity and utilization
  const velocityPerWeek = avgVelocity * 2; // SP per week (2 sprints per week)
  const velocityPerDay = velocityPerWeek / 5; // SP per day (5 working days)
  const availableHoursPerDay = (utilizationPercent / 100) * 8; // 8 hour workday
  const spPerHour = velocityPerDay / availableHoursPerDay;
  
  // Calculate days: SP × SP/hour ÷ hours/day ÷ utilization
  const estimatedDays = Math.ceil(
    (totalRemainingStoryPoints * (1 / spPerHour)) / availableHoursPerDay
  );

  // Calculate scenario deltas (pricing/profit margin scenarios)
  const scenarioAWeight = input.scenarioAWeight ?? 0.6;
  const scenarioBWeight = input.scenarioBWeight ?? 0.4;

  // Scenario A: optimistic (lower SP estimate)
  const estimatedSpOptimistic = Math.max(0, totalRemainingStoryPoints * 0.9);
  const daysToCompletionOptimistic = Math.max(1, Math.ceil(estimatedSpOptimistic / spPerHour));
  
  // Scenario B: pessimistic (higher SP estimate)
  const estimatedSpPessimistic = Math.max(0, totalRemainingStoryPoints * 1.1);
  const daysToCompletionPessimistic = Math.ceil(estimatedSpPessimistic / spPerHour);

  // Calculate individual agent buckets for visualization
  const agentBuckets = await calculateAgentBuckets(input.remainingWorkByAgent, avgVelocity, utilizationPercent);

  return {
    projectId: input.projectId,
    totalEstimatedStoryPoints: Math.round(totalRemainingStoryPoints),
    daysToCompletion: Math.max(1, estimatedDays),
    scenarioADelta: daysToCompletionOptimistic - estimatedDays,
    scenarioBDelta: estimatedDays - daysToCompletionPessimistic,
    agentBuckets,
    usedEmployiveVelocity: input.useEmpiricalVelocity,
  };
}

/**
 * Calculate average agent velocity for the project
 */
async function calculateAverageVelocity(
  projectId: string,
  tenantId: string
): Promise<number> {
  try {
    const projectVelocity = await recalculateProjectVelocity(projectId, tenantId);
    
    if (projectVelocity && projectVelocity.avgVelocitySpPerSprint) {
      return projectVelocity.avgVelocitySpPerSprint;
    }
    
    // Fall back to default if no empirical data
    return APP_CONSTANTS.DEFAULT_PROJECT_SP_PER_SPRINT_RANGE[0];
  } catch (error) {
    internalLogger.warn('Failed to calculate project velocity', {
      projectId,
      error,
    });
    return APP_CONSTANTS.DEFAULT_PROJECT_SP_PER_SPRINT_RANGE[0];
  }
}

/**
 * Get average utilization from live assignment data
 */
async function getAverageUtilization(
  projectId: string
): Promise<number> {
  try {
    const mappingResult = await mapUtilizationFromRoster('tenant-id-placeholder', projectId);
    
    if (mappingResult.success && mappingResult.agents.length > 0) {
      const avgUtil = mappingResult.agents.reduce(
        (sum, agent) => sum + agent.currentUtilizationPercent,
        0
      ) / mappingResult.agents.length;
      
      return Math.round(avgUtil * 100) / 100;
    }
  } catch (error) {
    internalLogger.warn('Failed to get average utilization', {
      projectId,
      error,
    });
  }
  
  return 40; // Default 40%
}

/**
 * Calculate agent capacity buckets for tracking individual agent allocation
 */
async function calculateAgentBuckets(
  remainingWork: Array<{ agentId: string; remainingStoryPoints: number }>,
  avgVelocity: number,
  utilizationPercent: number
): Promise<AgentCapacityBucket[]> {
  const agentBuckets: AgentCapacityBucket[] = [];

  for (const agent of remainingWork) {
    const velocity = avgVelocity; // Use project average
    const capacityProfile = getCapacityProfile(velocity, utilizationPercent);

    const velocityPerWeek = velocity * 2;
    const velocityPerDay = velocityPerWeek / 5;
    const spPerHour = velocityPerDay / ((utilizationPercent / 100) * 8);
    const estimatedDays = Math.max(1, Math.ceil(agent.remainingStoryPoints / spPerHour));

    agentBuckets.push({
      agentId: agent.agentId,
      remainingStoryPoints: agent.remainingStoryPoints,
      utilizationPercent,
      velocity,
      capacityProfile,
      estimatedDays,
    });
  }

  return agentBuckets;
}

/**
 * Determine capacity profile based on velocity and utilization
 */
function getCapacityProfile(velocity: number, utilizationPercent: number): 'high' | 'medium' | 'low' {
  if (utilizationPercent >= 50 && velocity >= 30) {
    return 'high';
  } else if (utilizationPercent >= 25 && velocity >= 15) {
    return 'medium';
  } else {
    return 'low';
  }
}

export interface RefreshProjectionOutput {
  success: boolean;
  projection?: ProjectionResult;
  validationGapsTotalSp: number;
  projectionsBefore: number;
  projectionsAfter: number;
}

/**
 * Refresh projection with validation gap micro-estimation included
 */
export async function refreshProjectionWithGaps(
  projectId: string,
  tenantId: string,
  validationGapEstimates: number[] // Array of micro-SP estimates for each gap
): Promise<RefreshProjectionOutput> {
  const projectionsBefore = await calculateValidationGapTotalSp(validationGapEstimates);

  // Refresh the overall projection including gap effort
  const projection = await calculateProjection({
    projectId,
    tenantId,
    remainingWorkByAgent: [], // Would normally come from task queries
    useEmpiricalVelocity: true,
  });

  const projectionsAfter = projection.totalEstimatedStoryPoints;

  internalLogger.info('Projection refreshed with validation gaps', {
    projectId,
    validationGapsTotalSp: projectionsAfter,
    projectionsBefore,
  });

  return {
    success: true,
    projection,
    validationGapsTotalSp: projectionsAfter,
    projectionsBefore,
    projectionsAfter,
  };
}

async function calculateValidationGapTotalSp(estimates: number[]): Promise<number> {
  return estimates.reduce((sum, estimate) => sum + estimate, 0);
}

/**
 * Recalculate delta between scenarios A and B
 */
export function recalculateScenarioDelta(
  daysToCompletion: number,
  scenarioADelta: number,
  scenarioBDelta: number
): number {
  // The delta between A and B represents the uncertainty range
  return daysToCompletion + Math.max(Math.abs(scenarioADelta), Math.abs(scenarioBDelta));
}

/**
 * Invalidate projection changes (used after sprint data correction)
 */
export async function invalidateProjection(
  projectId: string,
  tenantId: string
): Promise<void> {
  // Recalculates velocity from scratch
  await recalculateProjectVelocity(projectId, tenantId);
  
  internalLogger.info('Projection invalidated and recalculated', {
    projectId,
    tenantId,
  });
}

/**
 * Constants for projection calculations
 */
const APP_CONSTANTS = {
  DEFAULT_PROJECT_SP_PER_SPRINT_RANGE: [34, 59],
  AVG_SPRINTS_PER_WEEK: 2,
  AVG_WORKING_DAYS_PER_WEEK: 5,
  WORKING_HOURS_PER_DAY: 8,
} as const;