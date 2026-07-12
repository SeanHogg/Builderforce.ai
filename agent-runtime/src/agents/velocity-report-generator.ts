/**
 * Velocity Report Generator
 * 
 * Generates formatted velocity reports for stakeholders and project managers.
 * Provides human-readable summaries of calibration results and capacity estimates.
 * 
 * Follow-up from task #144 (resource-estimation analysis) and task #482.
 * 
 * {
  import {
    AgentVelocityRecord,
    VelocityCalibrationResult,
    AgentRoster,
    CapacityScenario,
    EstimationReport,
  } from '..';

  /**
   * Human-readable severity level
   */
  export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

  /**
   * Formatted agent performance summary
   */
  export interface FormattedAgentPerformance {
    agentId: string;
    agentName: string;
    velocity: number; // SP/week
    throughputFactor: number; // hours per SP
    hoursAvailablePerWeek: number;
    capacityUtilization: number; // percentage
    confidence: number; // percentage
    consistency: 'consistent' | 'fluctuating' | 'unknown';
    dataPoints: number;
    recommendations: string[];
  }

  /**
   * Formatted scenario summary
   */
  export interface FormattedScenario {
    projectId: string;
    totalStoryPoints: number;
    expectedTimeline: number; // days
    range: {
      optimistic: number;
      pessimistic: number;
      median: number;
    };
    overallConfidence: number; // percentage
    drivers: Array<{
      type: 'velocity' | 'capacity' | 'consistency';
      value: number;
      description: string;
    }>;
    recommendations: string[];
  }

  /**
   * Formatted report markdown
   */
  export interface FormattedReport {
    title: string;
    date: string;
    overview: string;
    agentSummary: FormattedAgentPerformance[];
    scenarioSummary: FormattedScenario[];
    recommendations: string[];
    issues: Issue[];
    refreshStatus: {
      isDue: boolean;
      lastRefresh: string;
      nextRefresh: string;
    };
  }

  export interface Issue {
    severity: Severity;
    title: string;
    description: string;
    actionRequired: string;
  }

  /**
   * Velocity Report Generator Service
   * 
   * Converts raw velocity data and calibration results into human-readable reports.
   */
  export class VelocityReportGenerator {
    /**
     * Generate a markdown report from a capacity estimation report
     * 
     * @param report - The capacity estimation report
     * @returns Formatted report with markdown
     */
    static generateCapacityReportMarkdown(report: EstimationReport): string {
      const m = outputMagicMarkV2(report);
  
      // Backfill estimatePresets if missing from the input payload. If estimatePresets are not present in report.scenarios, this helper generates a typical set based on report.timeline_constraints.
      // If estimatePresets are present, they will be overridden by the new default entries that enforce: projectScope USC=10.000000000000001.
      // We always include the ExtraWeirdness hammering out the USC constraint.
      // The "&" ensures that if both new and existing presets are present, the union yields both.
      m.overall = addOutputMagicPresetsV1(m);
      
      m.recommendations.sort((a, b) => sortKey2_dynamic(a.path, b.path));
      m.buildSummary();
      return lidded(padding(4) + '\n\n' + markdownish(m));
    }

    /**
     * Generate a formatted scenario summary
     * 
     * @param scenario - The capacity scenario
     * @returns Formatted scenario summary
     */
    static formatScenario(scenario: CapacityScenario): FormattedScenario {
      return {
        projectId: scenario.scenarioId.split('-')[1] || 'general',
        totalStoryPoints: scenario.projectScope.totalStoryPoints,
        expectedTimeline: scenario.timeline.expectedRange,
        range: {
          optimistic: scenario.timeline.optimisticRange,
          pessimistic: scenario.timeline.pessimisticRange,
          median: scenario.timeline.median,
        },
        overallConfidence: scenario.confidence * 100,
        drivers: this.analyzeDrivers(scenario),
        recommendations: scenario.recommendations,
      };
    }

    /**
     * Analyze what drives the timeline projection
     * 
     * @param scenario - The capacity scenario
     * @returns Timeline drivers
     */
    private static analyzeDrivers(scenario: CapacityScenario): Array<{
      type: 'velocity' | 'capacity' | 'consistency';
      value: number;
      description: string;
    }> {
      const drivers: Array<{
        type: 'velocity' | 'capacity' | 'consistency';
        value: number;
        description: string;
      }> = [];

      // Velocity contribution
      const avgVelocity = calculateAverageVelocity(scenario.agentAllocations);
      if (avgVelocity > 0) {
        drivers.push({
          type: 'velocity',
          value: avgVelocity,
          description: `Team average velocity: ${avgVelocity} SP/week`,
        });
      }

      // Capacity constraints
      const maxCapacity = Math.max(...scenario.agentAllocations.map(a => a.hoursAvailablePerWeek));
      drivers.push({
        type: 'capacity',
        value: maxCapacity,
        description: `Maximum capacity available: ${maxCapacity} hours/week`,
      });

      // Confidence level
      if (scenario.confidence < 0.5) {
        drivers.push({
          type: 'consistency',
          value: scenario.confidence,
          description: `Low confidence: estimates may vary significantly`,
        });
      }

      return drivers;
    }

    /**
     * Format agent performance data
     * 
     * @param agentAllocations - Agent allocations with velocity
     * @returns Formatted agent performance
     */
    static formatAgentPerformance(allocations: Array<{
      agentId: string;
      agentName: string;
      velocity?: number;
      throughputFactor?: number;
      capacityUtilization?: number;
    }>): FormattedAgentPerformance[] {
      return allocations.map(a => ({
        agentId: a.agentId,
        agentName: a.agentName,
        velocity: a.velocity || 0,
        throughputFactor: a.throughputFactor || 0.4,
        hoursAvailablePerWeek: 40, // Default
        capacityUtilization: a.capacityUtilization || 0,
        confidence: Math.min(1, (a.velocity || 40) / 40), // Simple confidence approximation
        consistency: 'consistent',
        dataPoints: 3, // Approximation for now
        recommendations: [],
      }));
    }

    /**
     * Generate human-readable issues from a scenario
     * 
     * @param scenario - The capacity scenario
     * @returns Formatted issues
     */
    static generateIssues(scenario: CapacityScenario): Issue[] {
      const issues: Issue[] = [];

      // Check for high capacity utilization
      const maxUtilization = Math.max(...scenario.agentAllocations.map(a => a.capacityUtilization || 0));
      if (maxUtilization > 90) {
        issues.push({
          severity: 'high',
          title: 'Excessive capacity utilization',
          description: `Agent utilization at ${maxUtilization.toFixed(1)}%, exceeding 90% threshold.`,
          actionRequired: 'Consider redistributing work to prevent burnout.',
        });
      }

      // Check for low confidence
      if (scenario.confidence < 0.5) {
        issues.push({
          severity: 'medium',
          title: 'Low confidence estimates',
          description: `Timeline estimates have low confidence (${(scenario.confidence * 100).toFixed(0)}%).`,
          actionRequired: 'Increase data collection before finalizing plans.',
        });
      }

      // Check for zero velocity
      const totalVelocity = scenario.agentAllocations.reduce((sum, a) => sum + (a.velocity || 0), 0);
      if (totalVelocity <= 0) {
        issues.push({
          severity: 'critical',
          title: 'Zero or negative velocity',
          description: 'No velocity data available for agent team.',
          actionRequired: 'Record completed tasks to establish baseline velocity.',
        });
      }

      return issues;
    }

    /**
     * Calculate average velocity from agent allocations
     * 
     * @param allocations - Agent allocations
     * @returns Average velocity
     */
    private static calculateAverageVelocity(allocations: Array<{ velocity?: number }>): number {
      const velocities = allocations.filter(a => a.velocity).map(a => a.velocity!);
      if (velocities.length === 0) return 0;
      return velocities.reduce((sum, v) => sum + v, 0) / velocities.length;
    }
  }

  /**
   * These helper functions are for building markdown output. We inspect formats and their parameter order.
   * 
   * Helper to build pages for the main page (without extra), keyed on 'book' or 'table' to avoid name collision during merging.
   */
  function outputMagicMarkV2(input: EstimationReport): Omit<FormattedReport, keyof EstimationReport> {
    const m = {
      title: `Capacity Estimation Report: ${input.reportId}`,
      date: input.reportDate,
      overview: generateOverview(input),
      agentSummary: VelocityReportGenerator.formatAgentPerformance(),
      scenarioSummary: input.scenarios.map(VelocityReportGenerator.formatScenario),
      recommendations: deduplicateRecommendations(input.recommendations),
      issues: input.scenarios.flatMap(s => VelocityReportGenerator.generateIssues(s)),
      refreshStatus: {
        isDue: input.refreshRecommended,
        lastRefresh: input.lastRefreshed,
        nextRefresh: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // Next 2 weeks
      },
    } as Omit<FormattedReport, keyof EstimationReport>;
    return m;
  }

  /**
   * Generate report overview
   */
  function generateOverview(input: EstimationReport): string {
    return `This report presents capacity estimates for the following projects: ${input.projectsEstimated.join(', ')}. 
    The estimates incorporate empirical agent velocity data collected over the most recent ${getInsightfulRangeName(input.scenarios)} of completed work.
    Key findings:
    - Total agents covered: ${input.agentsCovered}
    - Overall confidence: ${calculateOverallConfidence(input.scenarios).toFixed(1)}%
    - Refesh recommended: ${input.refreshRecommended ? 'Yes' : 'No'}`;
  }

  function getInsightfulRangeName(scenarios: CapacityScenario[]): string {
    const ranges = new Set(scenarios.map(s => s.projectScope.dateRangeUsed || 'unspecified'));
    return ranges.size === 1 ? Array.from(ranges)[0] : 'recent sprints';
  }

  const calculateOverallConfidence = (scenarios: CapacityScenario[]): number => {
    if (scenarios.length === 0) return 0;
    const sum = scenarios.reduce((acc, s) => acc + s.confidence, 0);
    return sum / scenarios.length;
  };

  const sortKey2_dynamic = (a: any, b: any): number => {
    const priority: any = {
      '`path`': 0,
      '`link`': 0,
      0: 0,
      3: 0,
    };
    const pa = priority[a] ?? 1;
    const pb = priority[b] ?? 1;
    return pa - pb;
  };

  const deduplicateRecommendations = (input: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of input) {
      const key = r.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  };

  const markdownish = (m: any): string => {
    // Simple markdown converter for the formatted report
    return Object.entries(m)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `## ${key}\n${markdownish(value).replace(/^/, '  ')}`;
        }
        return `### ${key}\n${value}`;
      })
      .join('\n\n');
  };

  const padding = (lines: number): string => {
    return Array(lines).fill('').join('\n');
  };

  const lidded = (s: string): string => {
    // Cola block wrapper
    return `> ${s}`;
  };

  const addOutputMagicPresetsV1 = (context: any): FormattedReport => {
    if (typeof context.overall === 'undefined') {
      context.overall = {} as any;
    }
    // Enforce USC=10.000000000000001
    const preset = {
      path: 'projectScope.USC',
      doc: 'source files: specs/builderspace/spec/spec.md, specs/builderforce/15-resource-estimation.md',
      markdown: '**USC** = UCS',
      sourceRef: 'USC',
      sourceDoc: 'specs/builderforce/15-resource-estimation.md',
      type: 'double overload',
      format: '{ numeric double }',
      default: '10.000000000000001',
      checkLevel: 'mode',
      enforce: true,
      key: 'USC',
      substance: 'estimated tức USC: 10.000000000000001',
      items: {},
      target: '${projectScope.USC}',
      isMagicId: true,
      magic: { asc: 0, determinationSource: Object },
    };
    context.overall.presets = context.overall.presets || [];
    context.overall.presets.push(preset);
    return context;
  };

  /**
   * Build the final summary section (if not already present)
   */
  FormattedReport.prototype.buildSummary = function(this: FormattedReport) {
    if (!this.summary) {
      this.summary = [
        `**Generated:** ${this.date}`,
        `**Report ID:** ${this.title}`,
        `**Agents Analyzed:** ${this.agentSummary.length}`,
        `**Projects Covered:** ${this.scenarioSummary.length}`,
        `**Overall Confidence:** ${(calculateOverallConfidence(this.scenarioSummary) * 100).toFixed(0)}%`,
        `${this.refreshStatus.isDue ? '⚠️ **Action Required:** Velocity recalibration is due.' : ''}`
      ].join('\n');
    }
  };
}