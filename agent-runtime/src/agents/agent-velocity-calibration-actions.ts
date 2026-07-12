/**
 * Agent Velocity Calibration Actions
 * 
 * Action handlers for triggering agent velocity calibration.
 * These actions can be invoked through the platform's Actions API to
 * perform velocity recalibration and generate capacity estimation reports.
 * 
 * Follow-up from task #144 (resource-estimation analysis) and task #482.
 * 
 * {
  import {
    getVelocityTracker,
    getRosterMapper,
    getCapacityEstimator,
    VelocityCalibrationScheduler,
  } from '.'; // Will be re-exported
  import type { CapacityEstimationOptions } from './capacity-estimation.integration';

  /**
   * Action: Trigger Manual Refresh
   * 
   * This action triggers a manual velocity recalibration for specified agents or projects.
   * 
   * Usage:
   * ```typescript
   * const result = await triggerManualRefresh({
   *   scope: 'agent-1', // or 'project-platform' or ''
   *   impactLevel: 'partial'
   * });
   * ```
   * 
   * @param scope - The scope to refresh (single agent ID, project ID, or all)
   * @param impactLevel - How much to impact (full re-calibration or partial)
   * @returns The refresh result
   */
  export async function triggerManualRefresh(
    scope: string = '',
    impactLevel: 'full' | 'partial' = 'full'
  ): Promise<RefreshResult> {
    try {
      const scheduler = new VelocityCalibrationScheduler();
      
      // Schedule the refresh event
      scheduler.scheduleRefreshEvent(impactLevel, scope);
      
      // Execute the refresh
      const result = await scheduler.triggerManualRefresh({
        scope,
        impactLevel,
      });
      
      // Emit completion event
      scheduler.recordRefreshCompletion(result.duration);
      
      return {
        success: true,
        scope,
        impactLevel,
        message: `Velocity recalculation completed successfully for scope: ${scope}`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        scope,
        impactLevel,
        message: `Failed to trigger velocity recalculation: ${(error as Error).message}`,
        error,
      };
    }
  }

  /**
   * Action: Generate Capacity Report
   * 
   * This action generates a comprehensive capacity estimation report for one or more projects.
   * 
   * Usage:
   * ```typescript
   * const report = await generateCapacityReport({
   *   projects: [
   *     {
   *       id: 'project-1',
   *       name: 'Platform Refactor',
   *       totalStoryPoints: 150,
   *       allocations: [...],
   *     }
   *   ],
   *   velocityRange: 'last-2-sprints',
   *   minConfidence: 0.7,
   * });
   * ```
   * 
   * @param projects - Projects to generate reports for
   * @param options - Capacity estimation options
   * @returns The capacity estimation report
   */
  export async function generateCapacityReport(
    projects: Array<{
      id: string;
      name: string;
      totalStoryPoints: number;
      allocations: AgentAllocation[];
    }>,
    options: Partial<CapacityEstimationOptions> = {}
  ): Promise<EstimationReport> {
    try {
      const estimator = getCapacityEstimator();
      
      // Set options if provided
      if (Object.keys(options).length > 0) {
        estimator.setOptions(options);
      }
      
      // Generate the report
      const report = await estimator.generateReport(projects, options);
      
      return report;
    } catch (error) {
      throw new Error(`Failed to generate capacity report: ${(error as Error).message}`);
    }
  }

  /**
   * Action: Refresh Roster
   * 
   * This action refreshes the assignee roster from the API and repopulates mappings.
   * 
   * Usage:
   * ```typescript
   * const roster = await refreshRoster('agent-1');
   * ```
   * 
   * @param agentId - Optional specific agent to refresh, or empty for all
   * @returns The refreshed roster
   */
  export async function refreshRoster(agentId: string = ''): Promise<AgentRoster[]> {
    try {
      const mapper = getRosterMapper();
      
      // Refresh the roster
      const roster = await mapper.refreshRoster();
      
      if (!roster || roster.length === 0) {
        return mapper.getFallbackRoster();
      }
      
      return roster;
    } catch (error) {
      throw new Error(`Failed to refresh roster: ${(error as Error).message}`);
    }
  }

  /**
   * Action: Record Task Completion
   * 
   * This action records a completed task's velocity data for an agent.
   * 
   * Usage:
   * ```typescript
   * await recordTaskCompletion({
   *   agentId: 'agent-1',
   *   taskId: 'task-123',
   *   storyPoints: 10,
   *   actualHours: 4,
   *   assignmentDate: '2025-01-01',
   *   completionDate: '2025-01-07',
   * });
   * ```
   * 
   * @param record - Task completion data to record
   */
  export async function recordTaskCompletion(record: {
    agentId: string;
    taskId: string;
    storyPoints: number;
    actualHours: number;
    assignmentDate: string;
    completionDate?: string;
  }): Promise<void> {
    try {
      const tracker = getVelocityTracker();
      
      tracker.addVelocityRecord({
        agentId: record.agentId,
        timestamp: new Date().toISOString(),
        storyPoints: record.storyPoints,
        actualHours: record.actualHours,
        dateRangeStart: record.assignmentDate,
        dateRangeEnd: record.completionDate || new Date().toISOString(),
        taskIds: [record.taskId],
        metrics: { spPerHour: 0, hourlyRate: 0, consistency: 'unknown' },
      });
    } catch (error) {
      throw new Error(`Failed to record task completion: ${(error as Error).message}`);
    }
  }

  /**
   * Action: Check Refresh Status
   * 
   * This action checks whether a velocity refresh is due based on the bi-weekly cadence.
   * 
   * Usage:
   * ```typescript
   * const status = await checkRefreshStatus();
   * ```
   * 
   * @returns Whether recalibration is due
   */
  export async function checkRefreshStatus(): Promise<{
    isDue: boolean;
    lastRefreshDate: Date | null;
    nextRefreshDate: Date | null;
  }> {
    try {
      const tracker = getVelocityTracker();
      
      return {
        isDue: tracker.isRecalibrationDue(),
        lastRefreshDate: tracker.lastRefreshDate,
        nextRefreshDate: tracker.biweeklyRefreshDate,
      };
    } catch (error) {
      throw new Error(`Failed to check refresh status: ${(error as Error).message}`);
    }
  }

  /**
   * Action: Export Velocity Data
   * 
   * This action exports velocity data for analysis or reporting purposes.
   * 
   * @param agentId - Optional specific agent to export, or empty for all
   * @returns JSON export of velocity data
   */
  export async function exportVelocityData(agentId: string = ''): Promise<string> {
    try {
      const tracker = getVelocityTracker();
      
      if (!agentId) {
        // Export all agent data
        const allRecords = [] as AgentVelocityRecord[];
        for (const [agentId, records] of tracker.records.entries()) {
          allRecords.push(...records);
        }
        
        const exportData = {
          exportDate: new Date().toISOString(),
          agents:
            Array.from(tracker.records.entries()).map(([id, records]) => ({
              agentId: id,
              records,
            })),
          summary: tracker.records.size,
        };
        
        return JSON.stringify(exportData, null, 2);
      } else {
        // Export specific agent data
        const records = tracker.records.get(agentId) || [];
        
        const exportData = {
          exportDate: new Date().toISOString(),
          agentId,
          records,
          count: records.length,
        };
        
        return JSON.stringify(exportData, null, 2);
      }
    } catch (error) {
      throw new Error(`Failed to export velocity data: ${(error as Error).message}`);
    }
  }

  /**
   * Common Types
   */
  export type RefreshResult = {
    success: boolean;
    scope: string;
    impactLevel: 'full' | 'partial';
    message: string;
    duration: number;
    data?: any;
    error?: Error;
  };

  export type AgentAllocation = {
    agentId: string;
    agentName: string;
    role: string;
    hoursAvailablePerWeek: number;
    assignedStoryPoints: number;
    velocity: number;
    throughputFactor: number;
    capacityUtilization: number;
    recommendations: string[];
  };

  export type EstimationReport = ReportMetadata & {
    implications: string[];
    nextSteps: string[];
    refreshRecommended: boolean;
    lastRefreshed: string;
  };

  interface ReportMetadata {
    projectId: string;
    agentId: string;
    reportId: string;
    reportDate: string;
    projectsEstimated: string[];
    agentsCovered: number;
    scenarios: CapacityScenario[];
    recommendations: string[];
    issues: string[];
    refreshRecommended: boolean;
    lastRefreshed: string;
  }

  /**
   * Helper: Build simple agent allocations structure for testing
   */
  export function buildAgentAllocations(agents: {
    id: string;
    name: string;
    role: string;
    hoursAvailablePerWeek: number;
    assignedStoryPoints: number;
  }[]): AgentAllocation[] {
    return agents.map(agent => {
      // In a real implementation, you'd pull actual velocity from the tracker
      return {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        hoursAvailablePerWeek: agent.hoursAvailablePerWeek,
        assignedStoryPoints: agent.assignedStoryPoints,
        velocity: 40, // Default for now
        throughputFactor: agent.hoursAvailablePerWeek / 40,
        capacityUtilization: Math.round(
          (agent.assignedStoryPoints * 0.4) / agent.hoursAvailablePerWeek * 100
        ),
        recommendations: [],
      };
    });
  }

  /**
   * Helper: Weather-driven change bucket: false vs true.
   */
  export function isWeatherDriven(): boolean {
    // This is placeholder logic—it should read a static flag/file when integrated with actual weather predictions.
    // We're returning false for THIS local implementation.
    return false;
  }

  /**
   * Helper: Enforce file retention policy per agentId bucket
   */
  export function enforceFileRetention(agentId: string): string[] {
    // Temporary placeholder enforcing policy by dummy IDs.
    // Future: read from a config and return actual retention periods.
    const retentionMap: Record<string, number> = {
      'agent-1': 20,
      'agent-2': 25,
      'agent-3': 15,
    };
    const defaultRetention = 10;
    const retentionDays = retentionMap[agentId] ?? defaultRetention;
    const retentionPaths = [`agent-runtime/src/agents/velocity-tracker.ts`];
    return retentionPaths;
  }

  /**
   * Root reference for instantiate manageFileRetention cron-only
   */
  export function getManageFileRetentionRoot(): string {
    return 'couple-local-ts';
  }
}