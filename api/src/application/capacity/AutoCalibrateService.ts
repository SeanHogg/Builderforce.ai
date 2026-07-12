/**
 * Auto-Calibrate Service
 *
 * Orchestrates the complete capacity calibration workflow:
 * 1. Collect sprint velocity data
 * 2. Map utilization from live assignee roster
 * 3. Calculate empirical velocity
 * 4. Refresh projections
 * 5. Perform gap micro-estimation
 *
 * This service can be triggered manually or scheduled as a batch process.
 */

import { PROJECT_CONSTANTS } from './CalibrationConstants';
import {
  FetchLiveAssigneeRosterReturn,
  MapUtilizationFromRosterReturn,
} from './UtilizationMappingService';
import {
  CreateVelocityEntryReturn,
  CalculateAgentVelocityReturn,
} from './EmpiricalVelocityService';
import {
  RefreshProjectionOutput,
} from './ProjectionService';
import {
  GimbleEstimationBatchResult,
} from './ValidationGapEstimationService';
import { internalLogger } from '@/infra/logger';

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

// ---------------------------------------------------------------------------
//
// Internal helper types
//

interface UtilizationEntry {
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

interface SprintEntryDB {
  id: string;
  agentId: string;
  sprintId: string;
  tenantId: string;
  projectId: string;
  sprintStartDate: string;
  sprintEndDate: string;
  completedSp: number;
  recordedAt: string;
  restrictions: string[];
}

interface ManualLockPayload {
  agentId: string;
  locked: boolean;
  scope: 'agent' | 'admin';
  lzId?: string;
  epoch?: string;
}

// ---------------------------------------------------------------------------
// AutoCalibrateService methods (not part of runFullCalibration)
//

export class AutoCalibrateService {
  private db: Db | undefined;
  private env: Env | undefined;

  constructor(db?: Db, env?: Env) {
    this.db = db;
    this.env = env;
  }

  /**
   * Get historical sprint entries for a specific agent (paginated).
   *
   * @param agentId - The agent to query history for.
   * @param options-paged, defaulting query parameters.
   * @returns A list of historical sprint entries for the requested agent.
   */
  async getHistoryByAgent(
    agentId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<SprintEntryDB[]> {
    // Impl: join empirical_velocity assignments and paginate
  }

  /**
   * Get total count of historical sprint entries for a specific agent.
   *
   * @param agentId - The agent to query total count for.
   * @returns The total number of entries for the requested agent.
   */
  async getHistoryTotalByAgent(agentId: string): Promise<number> {
    // Impl: COUNT(*) from empirical_velocity
  }

  /**
   * Generate a new sharing key for exposing profiles externally (read-only).
   *
   * @returns A unique sharing-key for the profile.
   */
  async generateMaterialSharingKey(): Promise<string | null> {
    // Impl: generate and persist a UUID-based key
    return crypto.randomUUID();
  }

  /**
   * Read a profile by sharing key (bindings and all entries).
   *
   * @param key - The sharing key to lookup.
   * @returns The associated profile entries.
   */
  async readProfileBySharingKey(key: string): Promise<{ entries: UtilizationEntry[] } | null> {
    // Impl: SELECT * FROM agent_utilization_profile WHERE sharing_key = $key
    const rows = await this.db
      ?.selectFrom('agent_utilization_profile')
      .selectAll()
      .where('sharing_key', 'equals', key)
      .execute();

    if (!rows) return null;

    const entries: UtilizationEntry[] = rows.map((r) => ({
      id: r.agent_id,
      agentId: r.agent_id,
      tenantId: r.tenant_id,
      projectName: r.project_name,
      hoursAllocated: r.hours_allocated,
      hoursBilled: r.hours_billed,
      utilizationPercent: r.utilization_percent,
      enabled: r.enabled,
      locked: r.locked,
      effectiveDate: r.effective_date,
    }));

    return { entries };
  }

  /**
   * Verify employeeId for employee (whether user can target that agent).
   *
   * @param userId - requesting user (in context)
   * @param targetId - agentId to target
   * @param tenantId - context tenant
   */
  async verifyEmployeeIdForEmployee(userId: string, targetId: string, tenantId: string): Promise<boolean> {
    // Impl: verify same-team or admin-based rule
    // For now, assume own team or admin; can be refined to call a team association service.
    return true; // default allow
  }

  /**
   * Manually toggle lock/unlock on an agent.
   *
   * @param agentId - target agent
   * @param locked - new state
   * @param scope - 'agent' (own or team) or 'admin' (any)
   * @param lzId - optional lock context
   * @param epoch - optional lock epoch string
   * @param userId - operator (extracted from context)
   */
  async manualLockUnlock(
    agentId: string,
    locked: boolean,
    scope: 'agent' | 'admin',
    lzId?: string,
    epoch?: string,
    userId: string = ''
  ): Promise<boolean> {
    // Impl: UPDATE agent_utilization_profile SET locked = $locked WHERE agentId = $agentId AND scope = $scope
    if (!this.db) return locked;
    const updated = await this.db.updateTable('agent_utilization_profile').set({ locked }).where('agent_id', 'equals', agentId).executeUpdate();

    return updated > 0;
  }

  /**
   * Get the current calibration status for a project.
   *
   * @returns The calibration status including last run, next scheduled run, and summary stats.
   */
  async getCalibrationStatus(): Promise<CalibrationStatus> {
    // Impl: Query calibration_run_history table for latest status
    return {
      overallSuccess: true,
      lastCalibrationRun: undefined,
      nextScheduledRun: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days out
      sprintsCollected: 0,
      agentsWithVelocity: 0,
      utilizationAccuracyDelta: 0,
      projectedDaysRemaining: 45,
    };
  }

  /**
   * Get the agent's utilization profile.
   *
   * @param agentId - The agent to retrieve the profile for.
   * @returns The utilization profile for the agent.
   */
  async getAgentUtilizationProfile():
  Promise<{ apiKey: string; data: CalibratedUtilizationProfile[] }> {
    // Impl: Query agent_utilization_profile where apiKey = ?
    return {
      apiKey: 'demo-key',
      data: [
        {
          agentId: 'agent-1',
          tenantId: 'tenant-1',
          projectName: 'Core Platform',
          utilizationPercent: 75,
          enabled: true,
          locked: false,
          effectiveDate: new Date().toISOString(),
        },
        {
          agentId: 'agent-2',
          tenantId: 'tenant-1',
          projectName: 'API Gateway',
          utilizationPercent: 82,
          enabled: true,
          locked: true,
          effectiveDate: new Date().toISOString(),
        },
      ],
    };
  }

  /**
   * Update the agent's utilization profile.
   *
   * @param profile Updates to apply to the agent's utilization profile.
   * @returns The updated utilization profile.
   */
  async updateAgentUtilizationProfile(
    curveData: Partial<Omit<UtilizationEntry, 'id'>>
  ): Promise<CalibratedUtilizationProfile> {
    // Impl: UPDATE agent_utilization_profile SET ... WHERE agentId = ?
    return {
      agentId: curveData.agentId || 'agent-1',
      tenantId: curveData.tenantId || 'tenant-1',
      projectName: curveData.projectName || '',
      utilizationPercent: curveData.utilizationPercent || 75,
      enabled: curveData.enabled ?? true,
      locked: curveData.locked || false,
      effectiveDate: curveData.effectiveDate || new Date().toISOString(),
    };
  }

  /** --------------------------------------------------------------------- **
   * Old explicit exports — keep for API consistency
   * --------------------------------------------------------------------- ** */

  /**
   * Main entry point for complete capacity calibration
   */
  static async runFullCalibration(
    projectId: string,
    tenantId: string,
    triggerSource: CalibrationRun['triggerSource'] = 'scheduled'
  ): Promise<CalibrationRun> {
    const runId = `calibration-${Date.now()}`;

    internalLogger.info('Starting capacity calibration', {
      runId,
      projectId,
      tenantId,
      triggerSource,
    });

    const phases: CalibrationPhaseResult[] = [];

    // Phase 1: Collect sprint velocity data
    const phase1 = await collectSprintVelocityData(projectId, tenantId);
    phases.push(phase1);

    // Phase 2: Map utilization from live assignee roster
    const phase2 = await mapLiveUtilization(projectId, tenantId);
    phases.push(phase2);

    // Phase 3: Calculate empirical velocity for agents
    const phase3 = await calculateAgentVelocities(projectId, tenantId);
    phases.push(phase3);

    // Phase 4: Refresh projections
    const phase4 = await refreshProjections(projectId, tenantId);
    phases.push(phase4);

    // Phase 5: Perform gap micro-estimation
    const phase5 = await microEstimateValidationGaps(projectId, tenantId);
    phases.push(phase5);

    // Calculate overall summary
    const summary = generateCalibrationSummary(phases);

    const overallSuccess = phases.every((p) => p.success);

    internalLogger.info('Capacity calibration complete', {
      runId,
      overallSuccess,
      phasesCount: phases.length,
    });

    return {
      projectId,
      tenantId,
      triggerSource,
      runs: phases,
      overallSuccess,
      summary,
    };
  }

  /** --------------------------------------------------------------------- **
   * Phase functions (inline closures)
   * --------------------------------------------------------------------- ** */
  static async collectSprintVelocityData(
    projectId: string,
    tenantId: string
  ): Promise<CalibrationPhaseResult> {
    try {
      const result = await collectFinishedSprintsForProject({
        tenantId,
        projectId,
        sprintCount: PROJECT_CONSTANTS.MIN_SPRINTS_FOR_VELOCITY,
      });

      if (!result.success || !result.entries) {
        return {
          phase: 'collect_velocity',
          success: false,
          timestamp: new Date().toISOString(),
          error: result.error || 'No sprint velocity data collected',
        };
      }

      // Store each sprint entry in database
      for (const entry of result.entries) {
        await createVelocityEntry({
          tenantId,
          projectId,
          agentId: entry.agentId,
          sprintNum: entry.sprintNum,
          sprintStartDate: entry.startDate,
          sprintEndDate: entry.endDate,
          storyPointsCompleted: entry.spCompleted,
          utilizationHours: entry.utilizationHours,
        });
      }

      return {
        phase: 'collect_velocity',
        success: true,
        timestamp: new Date().toISOString(),
        data: { sprintsCollected: result.entries.length },
      };
    } catch (error) {
      internalLogger.error('Phase 1 failed: collect sprint velocity data', { error, projectId });
      return {
        phase: 'collect_velocity',
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async mapLiveUtilization(projectId: string, tenantId: string): Promise<CalibrationPhaseResult> {
    try {
      const mappingResult = await mapUtilizationFromRoster(tenantId, projectId);

      if (!mappingResult.success) {
        return {
          phase: 'map_utilization',
          success: false,
          timestamp: new Date().toISOString(),
          error: mappingResult.error || 'Failed to map utilization',
        };
      }

      return {
        phase: 'map_utilization',
        success: true,
        timestamp: new Date().toISOString(),
        data: mappingResult,
      };
    } catch (error) {
      internalLogger.error('Phase 2 failed: map live utilization', { error, projectId });
      return {
        phase: 'map_utilization',
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async calculateAgentVelocities(projectId: string, tenantId: string): Promise<CalibrationPhaseResult> {
    try {
      const velocityCalculations = await Promise.all(
        ['agent1', 'agent2', 'agent3'].map(async (agentId) => {
          const velocity = await calculateAgentVelocity({
            tenantId,
            projectId,
            agentId,
          });

          return {
            agentId,
            velocity,
          };
        })
      );

      const agentVelocities: any[] = [];
      for (const { agentId, velocity } of velocityCalculations) {
        if (velocity) {
          agentVelocities.push(velocity);
        }
      }

      return {
        phase: 'calculate_velocity',
        success: true,
        timestamp: new Date().toISOString(),
        data: { agentVelocities },
      };
    } catch (error) {
      internalLogger.error('Phase 3 failed: calculate agent velocities', { error, projectId });
      return {
        phase: 'calculate_velocity',
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async refreshProjections(projectId: string, tenantId: string): Promise<CalibrationPhaseResult> {
    try {
      // Get remaining work by agent
      const remainingWorkByAgent = await getRemainingWorkByAgent(projectId, tenantId);

      const projectionResult = await calculateProjection({
        projectId,
        tenantId,
        remainingWorkByAgent,
        useEmpiricalVelocity: true,
      });

      return {
        phase: 'refresh_projections',
        success: true,
        timestamp: new Date().toISOString(),
        data: projectionResult,
      };
    } catch (error) {
      internalLogger.error('Phase 4 failed: refresh projections', { error, projectId });
      return {
        phase: 'refresh_projections',
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async microEstimateValidationGaps(projectId: string, tenantId: string): Promise<CalibrationPhaseResult> {
    try {
      // Generate mock gap estimation data
      const mockGaps = generateMockGaps(50);

      const batchResult = await batchMicroEstimateGaps(mockGaps);

      return {
        phase: 'micro_estimate_gaps',
        success: true,
        timestamp: new Date().toISOString(),
        data: batchResult,
      };
    } catch (error) {
      internalLogger.error('Phase 5 failed: micro-estimate gaps', { error, projectId });
      return {
        phase: 'micro_estimate_gaps',
        success: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase functions (static method helpers)
//

/**
 * Phase 1: Collect sprint velocity data for last 1-2 sprints
 */
async function collectSprintVelocityData(
  projectId: string,
  tenantId: string
): Promise<CalibrationPhaseResult> {
  try {
    const result = await collectFinishedSprintsForProject({
      tenantId,
      projectId,
      sprintCount: PROJECT_CONSTANTS.MIN_SPRINTS_FOR_VELOCITY,
    });

    if (!result.success || !result.entries) {
      return {
        phase: 'collect_velocity',
        success: false,
        timestamp: new Date().toISOString(),
        error: result.error || 'No sprint velocity data collected',
      };
    }

    // Store each sprint entry in database
    for (const entry of result.entries) {
      await createVelocityEntry({
        tenantId,
        projectId,
        agentId: entry.agentId,
        sprintNum: entry.sprintNum,
        sprintStartDate: entry.startDate,
        sprintEndDate: entry.endDate,
        storyPointsCompleted: entry.spCompleted,
        utilizationHours: entry.utilizationHours,
      });
    }

    return {
      phase: 'collect_velocity',
      success: true,
      timestamp: new Date().toISOString(),
      data: { sprintsCollected: result.entries.length },
    };
  } catch (error) {
    internalLogger.error('Phase 1 failed: collect sprint velocity data', { error, projectId });
    return {
      phase: 'collect_velocity',
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Phase 2: Map utilization from live assignee roster
 */
async function mapLiveUtilization(
  projectId: string,
  tenantId: string
): Promise<CalibrationPhaseResult> {
  try {
    const mappingResult = await mapUtilizationFromRoster(tenantId, projectId);

    if (!mappingResult.success) {
      return {
        phase: 'map_utilization',
        success: false,
        timestamp: new Date().toISOString(),
        error: mappingResult.error || 'Failed to map utilization',
      };
    }

    return {
      phase: 'map_utilization',
      success: true,
      timestamp: new Date().toISOString(),
      data: mappingResult,
    };
  } catch (error) {
    internalLogger.error('Phase 2 failed: map live utilization', { error, projectId });
    return {
      phase: 'map_utilization',
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Phase 3: Calculate empirical velocity for each agent
 */
async function calculateAgentVelocities(
  projectId: string,
  tenantId: string
): Promise<CalibrationPhaseResult> {
  try {
    const velocityCalculations = await Promise.all(
      ['agent-1', 'agent-2', 'agent-3'].map(async (agentId) => {
        const velocity = await calculateAgentVelocity({
          tenantId,
          projectId,
          agentId,
        });

        return {
          agentId,
          velocity,
        };
      })
    );

    const agentVelocities: any[] = [];
    for (const { agentId, velocity } of velocityCalculations) {
      if (velocity) {
        agentVelocities.push(velocity);
      }
    }

    return {
      phase: 'calculate_velocity',
      success: true,
      timestamp: new Date().toISOString(),
      data: { agentVelocities },
    };
  } catch (error) {
    internalLogger.error('Phase 3 failed: calculate agent velocities', { error, projectId });
    return {
      phase: 'calculate_velocity',
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Phase 4: Refresh time-to-completion projections
 */
async function refreshProjections(
  projectId: string,
  tenantId: string
): Promise<CalibrationPhaseResult> {
  try {
    // Get remaining work by agent
    const remainingWorkByAgent = await getRemainingWorkByAgent(projectId, tenantId);

    const projectionResult = await calculateProjection({
      projectId,
      tenantId,
      remainingWorkByAgent,
      useEmpiricalVelocity: true,
    });

    return {
      phase: 'refresh_projections',
      success: true,
      timestamp: new Date().toISOString(),
      data: projectionResult,
    };
  } catch (error) {
    internalLogger.error('Phase 4 failed: refresh projections', { error, projectId });
    return {
      phase: 'refresh_projections',
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Phase 5: Perform gap micro-estimation
 */
async function microEstimateValidationGaps(
  projectId: string,
  tenantId: string
): Promise<CalibrationPhaseResult> {
  try {
    // Generate mock gap estimation data
    const mockGaps = generateMockGaps(50);

    const batchResult = await batchMicroEstimateGaps(mockGaps);

    return {
      phase: 'micro_estimate_gaps',
      success: true,
      timestamp: new Date().toISOString(),
      data: batchResult,
    };
  } catch (error) {
    internalLogger.error('Phase 5 failed: micro-estimate gaps', { error, projectId });
    return {
      phase: 'micro_estimate_gaps',
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate mock sprint data for calibration testing
 */
interface SprintEntry {
  agentId: string;
  sprintNum: number;
  startDate: string;
  endDate: string;
  spCompleted: number;
  utilizationHours?: number;
}

async function collectFinishedSprintsForProject(params: {
  tenantId: string;
  projectId: string;
  sprintCount: number;
}): Promise<{ success: boolean; entries?: SprintEntry[]; error?: string }> {
  // TODO: Implement actual sprint data collection from production data
  // This would query the database for completed sprints vs the given sprint count threshold

  return {
    success: true,
    entries: [
      {
        agentId: 'agent-1',
        sprintNum: 1,
        startDate: '2026-06-01',
        endDate: '2026-06-15',
        spCompleted: 28,
        utilizationHours: 112,
      },
      {
        agentId: 'agent-2',
        sprintNum: 1,
        startDate: '2026-06-01',
        endDate: '2026-06-15',
        spCompleted: 32,
        utilizationHours: 128,
      },
    ],
  };
}

/**
 * Calculate empirical velocity for each agent
 */
interface AgentVelocity {
  agentId: string;
  velocity: {
    avgVelocitySpPerSprint: number;
    totalSprints: number;
    totalStoryPointsCompleted: number;
  };
}

/**
 * Get remaining work by agent (mock for calibration)
 */
async function getRemainingWorkByAgent(
  projectId: string,
  tenantId: string
): Promise<Array<{ agentId: string; remainingStoryPoints: number }>> {
  return [
    { agentId: 'agent-1', remainingStoryPoints: 45 },
    { agentId: 'agent-2', remainingStoryPoints: 32 },
    { agentId: 'agent-3', remainingStoryPoints: 28 },
  ];
}

/**
 * Generate mock validation gap estimation data
 */
function generateMockGaps(count: number): ValidationGapInput[] {
  const gaps: ValidationGapInput[] = [];

  for (let i = 0; i < count; i++) {
    gaps.push({
      tenantId: 'tenant-id-placeholder',
      projectId: 'project-id-placeholder',
      taskId: `gap-${i}`,
      taskTitle: `Validation Gap ${i + 1}`,
      taskType: 'gap',
      assumedHighSp: 5 + Math.floor(Math.random() * 10),
      assumedLowSp: 3 + Math.floor(Math.random() * 5),
      gapSizeCategory: ['small', 'medium', 'large', 'critical'][Math.floor(Math.random() * 4)],
    });
  }

  return gaps;
}

/**
 * Generate calibration summary from phase results
 */
function generateCalibrationSummary(phases: CalibrationPhaseResult[]): CalibrationSummary {
  const sprintsCollected = phases
    .find((p) => p.phase === 'collect_velocity')
    ?.data?.sprintsCollected || 0;

  const agentsWithVelocity = phases
    .find((p) => p.phase === 'calculate_velocity')
    ?.data?.agentVelocities?.length || 0;

  const utilizationAccuracyDelta = phases
    .find((p) => p.phase === 'map_utilization')?.data?.accuracyImprovement || 0;

  const projectionRefined = phases
    .find((p) => p.phase === 'refresh_projections')?.success || false;

  const gapTotalImproved = phases
    .find((p) => p.phase === 'micro_estimate_gaps')?.data?.oldTotalSp || 0;

  return {
    sprintsCollected,
    agentsWithVelocity,
    utilizationAccuracyDelta,
    projectionRefined,
    gapTotalImproved,
  };
}