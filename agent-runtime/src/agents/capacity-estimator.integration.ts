/**
 * Capacity Estimation Integration
 * 
 * Integrates empirical agent velocity data into the resource estimation model.
 * This module replaces or refinements the initial 0.4h/SP factor with actual
 * task completion data from the velocity tracker.
 * 
 * Follow-up from task #144 (resource-estimation analysis) and task #482.
 * 
 * {
  export interface CapacityEstimationOptions {
    /**
     * Historical range to use for velocity calibration
     * - 'last-1-sprint': Last 14 days (assumed 2-week sprint)
     * - 'last-2-sprints': Last 28 days (assumed 2-week sprints)
     * - 'all-time': All available historical data
     */
    velocityRange?: 'last-1-sprint' | 'last-2-sprints' | 'all-time';
    
    /**
     * Minimum confidence threshold for using empirical data
     * Values from 0 to 1 (default 0.7)
     */
    minConfidence?: number;
    
    /**
     * Whether to use fallback velocity if calculation fails
     * (default: true - falls back to 0.4h/SP factor)
     */
    useFallback?: boolean;
    
    /**
     * Maximum fallback throughput factor (hours per SP)
     * (default: 0.5)
     */
    maxFallbackThroughput?: number;
  }

  export interface CapacityScenario {
    scenarioId: string;
    projectScope: {
      totalStoryPoints: number;
      linearRange: boolean;
      marginOfError: number; // percentage
    };
    agentAllocations: AgentAllocation[];
    timeline: TimelineProjection;
    confidence: number;
    confidenceReason: string;
    estimatedThroughputFactor: number; // hours per SP
    calculatedAt: string;
    dataPoints: number;
    dataSources: string[];
  }

  export interface AgentAllocation {
    agentId: string;
    agentName: string;
    role: string;
    hoursAvailablePerWeek: number;
    assignedStoryPoints: number;
    velocity: number; // SP per week
    throughputFactor: number; // hours per SP
    capacityUtilization: number; // percentage (0-100)
    recommendations: string[];
  }

  export interface TimelineProjection {
    optimisticRange: number; // days
    expectedRange: number; // days
    pessimisticRange: number; // days
    median: number; // days
    confidenceInterval: [number, number]; // lower, upper bounds
    basedOnBioSpeed: boolean;
  }

  export interface EstimationReport {
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
   * Capacity Estimation Integration Service
   * 
   * Provides methods to generate capacity analysis and timeline projections
   * using empirical agent velocity data.
   */
  export class CapacityEstimatorIntegration {
    private velocityTracker: AgentVelocityTracker;
    private rosterMapper: AgentRosterMapper;
    private settings: Required<CapacityEstimationOptions>;

    constructor() {
      // Import from the modules we created
      this.velocityTracker = getVelocityTracker();
      this.rosterMapper = getRosterMapper();
      
      // Initialize settings with defaults
      this.settings = {
        velocityRange: 'last-2-sprints',
        minConfidence: 0.7,
        useFallback: true,
        maxFallbackThroughput: 0.5,
      };
    }

    /**
     * Set estimation options
     * 
     * @param options - The options to configure
     */
    setOptions(options: Partial<CapacityEstimationOptions>): void {
      this.settings = {
        velocityRange: options.velocityRange || this.settings.velocityRange,
        minConfidence: options.minConfidence || this.settings.minConfidence,
        useFallback: options.useFallback ?? this.settings.useFallback,
        maxFallbackThroughput: options.maxFallbackThroughput ?? this.settings.maxFallbackThroughput,
      };
    }

    /**
     * Estimate capacity for a project based on empirical velocities
     * 
     * @param projectId - The project identifier
     * @param storyPoints - Total story points to complete
     * @param allocations - Agent assignments and their available capacity
     * @param options - Optional estimation options
     * @returns Capacity scenario with timeline projection
     */
    async estimateCapacityForProject(
      projectId: string,
      storyPoints: number,
      allocations: AgentAllocation[],
      options?: CapacityEstimationOptions
    ): Promise<CapacityScenario> {
      const optionsToUse = { ...this.settings, ...options };
      
      // Load actual agent velocities
      const velocityResults: { [agentId: string]: number } = {};
      
      for (const allocation of allocations) {
        const calibration = this.velocityTracker.calibrateVelocity(
          allocation.agentId,
          optionsToUse.velocityRange,
          4 // min 4 data points
        );

        // Check if we have sufficient confidence
        if (calibration.confidence >= optionsToUse.minConfidence) {
          velocityResults[allocation.agentId] = calibration.baseVelocity;
        } else if (optionsToUse.useFallback) {
          // Fallback to default velocity
          velocityResults[allocation.agentId] = 40; // SP/week
        } else {
          throw new Error(
            `Insufficient confidence (${calibration.confidence}) for agent ${allocation.agentId}. ` +
            `Calibration reason: ${calibration.confidenceReason}`
          );
        }
      }

      // Calculate throughput factor for each agent
      const agentAllocationsWithVelocity = allocations.map(allocation => ({
        ...allocation,
        velocity: velocityResults[allocation.agentId],
      })).map(allocation => ({
        ...allocation,
        throughputFactor: allocation.hoursAvailablePerWeek / allocation.velocity,
      }));

      // Calculate capacity timeline
      const timeline = this.calculateTimeline(
        storyPoints,
        agentAllocationsWithVelocity,
        optionsToUse.velocityRange
      );

      // Determine confidence
      const avgConfidence = Object.values(velocityResults).length > 0 
        ? Object.values(velocityResults).length / allocations.length
        : 0;

      const confidenceReason = avgConfidence >= 0.8
        ? 'High confidence - verified across multiple agents'
        : avgConfidence >= 0.5
        ? 'Medium confidence - available but varied velocities'
        : 'Low confidence - high reliance on fallback default';

      const scenarioId = `${projectId}-scenario-${Date.now()}`;

      return {
        scenarioId,
        projectScope: {
          totalStoryPoints,
          linearRange: false,
          marginOfError: Math.round((1 - avgConfidence) * 100),
        },
        agentAllocations: agentAllocationsWithVelocity,
        timeline,
        confidence: Math.round(avgConfidence * 100) / 100,
        confidenceReason,
        estimatedThroughputFactor: agentAllocationsWithVelocity[0]?.throughputFactor || 0.4,
        calculatedAt: new Date().toISOString(),
        dataPoints: agentAllocationsWithVelocity.length,
        dataSources: ['empirical-velocity-tracker'],
      };
    }

    /**
     * Generate a comprehensive capacity estimation report
     * 
     * @param projects - Array of projects to estimate
     * @param options - Optional estimation options
     * @returns Complete estimation report
     */
    async generateReport(
      projects: Array<{
        id: string;
        name: string;
        totalStoryPoints: number;
        allocations: AgentAllocation[];
      }>,
      options?: CapacityEstimationOptions
    ): Promise<EstimationReport> {
      const optionsToUse = { ...this.settings, ...options };
      
      const scenarios: CapacityScenario[] = [];
      const allRecommendations: string[] = [];
      const issues: string[] = [];

      for (const project of projects) {
        try {
          const scenario = await this.estimateCapacityForProject(
            project.id,
            project.totalStoryPoints,
            project.allocations,
            optionsToUse
          );
          
          scenarios.push(scenario);

          // Generate recommendations based on scenario
          const projectRecommendations = this.generateProjectRecommendations(scenario);
          allRecommendations.push(...projectRecommendations);

          // Check for issues
          const projectIssues = this.checkForIssues(scenario);
          issues.push(...projectIssues);
        } catch (error) {
          const errorMsg = `Failed to estimate capacity for project ${project.id}: ${error}`;
          issues.push(errorMsg);
          console.error(errorMsg);
        }
      }

      // Check if recalibration is recommended
      const refreshRecommended = this.velocityTracker.isRecalibrationDue();

      return {
        reportId: `capacity-report-${Date.now()}`,
        reportDate: new Date().toISOString(),
        projectsEstimated: projects.map(p => p.name),
        agentsCovered: scenarios.reduce((sum, s) => sum + s.dataPoints, 0),
        scenarios,
        recommendations: this.deduplicateRecommendations(allRecommendations),
        issues,
        refreshRecommended,
        lastRefreshed: this.velocityTracker.lastRefreshDate?.toISOString() || new Date().toISOString(),
      };
    }

    /**
     * Run a manual recalculation of agent velocity
     * 
     * @param agentId - The agent to recalculate (or empty string for all agents)
     * @param forceRefresh - Force refresh of velocity data
     * @returns Mapping result showing recalibration status
     */
    async runVelocityRecalculation(
      agentId: string = '',
      forceRefresh: boolean = false
    ): Promise<RosterMappingResult> {
      // Refresh the roster
      const roster = await this.rosterMapper.refreshRoster();
      
      // Get assignments to map
      let assignments = this.rosterMapper.getCachedAssignments();
      
      // If specific agent ID requested, filter assignments
      if (agentId) {
        assignments = assignments.filter(a => a.assignedTo === agentId);
      }

      // Map assignments to roster
      const mappingResult = await this.rosterMapper.mapAssignmentsToRoster(assignments, roster);

      // If rfallback mode... run calibration for each agent
      if (mappingResult.fallbackMode) {
        for (const assignment of assignments) {
          // Extract velocity data from assignment
          this.velocityTracker.addVelocityRecord({
            agentId: assignment.assignedTo,
            timestamp: assignment.assignmentDate,
            storyPoints: assignment.actualStoryPoints || assignment.estimatedStoryPoints || 0,
            actualHours: assignment.actualHours || (assignment.estimatedStoryPoints || 0) * 0.4, // Fallback calculation
            dateRangeStart: assignment.assignmentDate,
            dateRangeEnd: assignment.completionDate || new Date().toISOString(),
            taskIds: [assignment.taskId],
            metrics: { spPerHour: 0, hourlyRate: 0, consistency: 'unknown' },
          });
        }
      }

      return mappingResult;
    }

    /**
     * Get calibration status for all agents
     * 
     * @returns Array of calibration results per agent
     */
    getCalibrationStatus(): Array<{
      agentId: string;
      baseVelocity: number;
      confidence: number;
      dataPoints: number;
      recommendedRefreshDate: string;
    }> {
      // In a real implementation, this would query the velocity tracker
      // for all tracked agents. For now, we'll return empty or mock data.
      return [];
    }

    /**
     * Export estimation scenario as JSON
     * 
     * @param scenario - The scenario to export
     * @returns JSON export of the scenario
     */
    exportScenario(scenario: CapacityScenario): string {
      return JSON.stringify(scenario, null, 2);
    }

    /**
     * Export report as JSON
     * 
     * @param report - The report to export
     * @returns JSON export of the report
     */
    exportReport(report: EstimationReport): string {
      return JSON.stringify(report, null, 2);
    }

    /**
     * Calculate timeline projection based on agent allocation
     * 
     * @param storyPoints - Total story points
     * @param agentAllocations - Agent allocations with velocities
     * @param velocityRange - Historical range used for velocity calculation
     * @returns Timeline projection
     */
    private calculateTimeline(
      storyPoints: number,
      agentAllocations: AgentAllocation[],
      velocityRange: string
    ): TimelineProjection {
      if (agentAllocations.length === 0) {
        return {
          optimisticRange: 100,
          expectedRange: 100,
          pessimisticRange: 100,
          median: 100,
          confidenceInterval: [80, 120],
          basedOnBioSpeed: false,
        };
      }

      // Calculate total SP/week capacity
      const total velocity = agentAllocations.reduce((sum, a) => sum + a.velocity, 0);
      
      // Calculate SP/week based on carrying, least engaged agent
      const minVelocity = Math.min(...agentAllocations.map(a => a.velocity));
      const totalVelocityRange = total velocity - minVelocity;

      // Timeline calculation using Weibull distribution (used in original estimation)
      // Based on the 0.4h/SP factor and 1.5 factor for critical path factor
      const baseThroughputFactor = 0.4 + (0.2 * totalVelocityRange) / totalVelocity;
      const expectedThroughput = 100 / baseThroughputFactor; // days for 100 SP
      const optimisticThroughput = expectedThroughput * 0.7;
      const pessimisticThroughput = expectedThroughput * 1.3;

      const expectedDays = (storyPoints / totalVelocity) * 7; // SP/week → days
      const optimisticDays = (storyPoints / totalVelocityRange) * 7; // Using least loaded agent
      const pessimisticDays = optimisticDays * 1.5; // Conservative

      const medianDays = (optimisticDays + pessimisticDays) / 2;

      return {
        optimisticRange: Math.round(optimisticDays),
        expectedRange: Math.round(expectedDays),
        pessimisticRange: Math.round(pessimisticDays),
        median: Math.round(medianDays),
        confidenceInterval: [
          Math.round(optimisticDays),
          Math.round(pessimisticDays),
        ],
        basedOnBioSpeed: true,
      };
    }

    /**
     * Generate project-specific recommendations
     * 
     * @param scenario - The capacity scenario
     * @returns Array of recommendations
     */
    private generateProjectRecommendations(scenario: CapacityScenario): string[] {
      const recommendations: string[] = [];

      // Check for potential resource constraints
      const highlyUtilizedAgents = scenario.agentAllocations.filter(
        a => a.capacityUtilization > 85
      );

      if (highlyUtilizedAgents.length > 0) {
        recommendations.push(
          `Consider redistributing work from highly utilized agents: ${highlyUtilizedAgents.map(a => a.agentName).join(', ')}` +
          ` to maintain team velocity and reduce burn risk.`
        );
      }

      // Check for velocity variance
      const velocityVariance = scenario.agentAllocations.length > 1
        ? Math.max(...scenario.agentAllocations.map(a => a.velocity)) -
          Math.min(...scenario.agentAllocations.map(a => a.velocity))
        : 0;

      if (velocityVariance > 20) {
        recommendations.push(
          `Velocity variance detected across agents. Consider training or pairing strategies to align team performance.`
        );
      }

      // Check confidence level
      if (scenario.confidence < 0.6) {
        recommendations.push(
          `Timeline estimates have low confidence due to insufficient velocity data. ` +
          `Consider recalibrating velocity after the next sprint.`
        );
      } else if (scenario.confidence < 0.8) {
        recommendations.push(
          `Timeline estimates have medium confidence. Monitor velocity trends closely.`
        );
      }

      // Check against original 0.4h/SP assumption
      if (Math.abs(scenario.estimatedThroughputFactor - 0.4) > 0.1) {
        recommendations.push(
          `Updated throughput factor is ${scenario.estimatedThroughputFactor}h/SP, ` +
          `which differs from the assumed 0.4h/SP. This likely reflects actual agent performance`
        );
      }

      return recommendations;
    }

    /**
     * Check for issues in the capacity scenario
     * 
     * @param scenario - The capacity scenario
     * @returns Array of issues found
     */
    private checkForIssues(scenario: CapacityScenario): string[] {
      const issues: string[] = [];

      // No agent allocations
      if (scenario.agentAllocations.length === 0) {
        issues.push('No agent allocations provided for estimation.');
      }

      // All agents have zero or negligible velocity
      const totalVelocity = scenario.agentAllocations.reduce((sum, a) => sum + a.velocity, 0);
      if (totalVelocity <= 0) {
        issues.push('Total team velocity is zero or negative. Cannot calculate timeline.');
      }

      // High utilization across all agents
      const maxUtilization = Math.max(...scenario.agentAllocations.map(a => a.capacityUtilization));
      if (maxUtilization > 90) {
        issues.push('All agents are operating at extremely high capacity, increasing burn risk.');
      }

      // Low confidence
      if (scenario.confidence < 0.5) {
        issues.push(`Low confidence level (${Math.round(scenario.confidence * 100)}%) - estimates should be viewed with caution.`);
      }

      return issues;
    }

    /**
     * Deduplicate recommendations to avoid redundancy
     * 
     * @param recommendations - Array of recommendations
     * @returns Deduplicated recommendations
     */
    private deduplicateRecommendations(recommendations: string[]): string[] {
      const seen = new Set<string>();
      const deduplicated: string[] = [];

      for (const rec of recommendations) {
        if (!seen.has(rec)) {
          seen.add(rec);
          deduplicated.push(rec);
        }
      }

      return deduplicated;
    }
  }

  /**
   * Global singleton instance
   */
  export const capacityEstimatorIntegration = new CapacityEstimatorIntegration();

  /**
   * Quick helper for backward compatibility
   */
  export function getCapacityEstimator(): CapacityEstimatorIntegration {
    return capacityEstimatorIntegration;
  }
}