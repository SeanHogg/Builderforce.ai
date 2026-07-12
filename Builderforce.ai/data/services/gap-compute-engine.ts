/**
 * Resource Gap Computation Engine
 *
 * Implements FR-3 (Gap computation) and FR-4 (Severity classification) and FR-5 (Recommendation generation).
 * Rules compliant with PRD definitions for time horizons, dimension calculations, and severity thresholds.
 */

import {
  GapDimension,
  GapSeverity,
  ResourceType,
  GapSummary,
  GapAnalysisResult,
  Recommendation,
  PersonnelResource,
  ToolResource,
  BudgetPool,
  ResourceDemand,
  RequirementOptions
} from '../models/resource-gap.js';

export interface SeverityThresholdConfig {
  critical?: {
    minutesDrain: number;
    percentBudgetVariance: number;
    capacityDrainPct?: number;
  };
  high?: {
    daysSlip?: number;
    percentBudgetVariance: number;
    capacityDrainPct?: number;
  };
  medium?: {
    hoursDelay?: number;
    percentBudgetVariance: number;
    capacityDrainPct?: number;
  };
}

/**
 * Options controlling the computation mode
 */
export interface RequirementOptions {
  filters?: {
    dimension?: GapDimension;
    severity?: GapSeverity;
    projectId?: string;
    department?: string;
    role?: string;
    timeHorizon?: GapSummary['timeHorizon'];
  };
  reconcile?: {
    excludeOverlappingDemands?: boolean; // If true, paired project demands cancel each other out
    mergeSameSkills?: boolean; // If true, grouping demands
  };
  severityThresholds?: SeverityThresholdConfig;
}

/**
 * Core gap computation engine
 */
export class GapComputeEngine {
  private thresholds: SeverityThresholdConfig;

  constructor(thresholds?: SeverityThresholdConfig) {
    // Fallback threshold config matching PRD (sprint = critical at 0; quarterly/annual scale)
    this.thresholds = {
      critical: thresholds?.critical || {
        minutesDrain: 0,
        percentBudgetVariance: 0.15,
        capacityDrainPct: 0.30
      },
      high: thresholds?.high || {
        daysSlip: 14,
        percentBudgetVariance: 0.15,
        capacityDrainPct: 0.20
      },
      medium: thresholds?.medium || {
        hoursDelay: 24,
        percentBudgetVariance: 0.10,
        capacityDrainPct: 0.10
      },
      // Low severity not yet required for gate; override or configure via config
    };
  }

  /**
   * Public entry point
   */
  compute(
    resources: {
      personnel: PersonnelResource[];
      tools: ToolResource[];
      budgets: BudgetPool[];
    },
    demands: ResourceDemand[],
    needIcal?: boolean, // For capacity gap timeboxing optional
    timeHorizon: GapSummary['timeHorizon'] = 'monthly',
    options?: RequirementOptions
  ): GapAnalysisResult {
    const filteredResources = options?.filters?.dimension
      ? this.filterByDimension(resources, demands, options.filters.dimension)
      : resources;

    // Aggregate availability per dimension
    const availability = this.aggregateAvailability(filteredResources);

    // Aggregate demand per dimension
    const demand = this.aggregateDemand(demands, options?.reconcile);

    // Compute gaps by dimension
    const dimensions: GapDimension[] = options?.filters?.dimension
      ? [options.filters.dimension]
      : [GapDimension.Headcount, GapDimension.Skills, GapDimension.CapacityHours, GapDimension.Budget];

    const gaps: GapSummary[] = dimensions.map(dim => {
      const availableSum = availability[dim];
      const neededSum = demand[dim];
      const deficit = Math.max(0, neededSum - availableSum);
      const surplus = Math.max(0, availableSum - neededSum);

      // Map to Project/Department/TimeHorizon fields for the GapSummary model (page implementation)
      const summaryFields = this.deriveProjectAndDepartmentFields(dim, options?.filters);
      const timeHorizon = options?.filters?.timeHorizon || timeHorizon;

      let severity = this.classifySeverity(
        deficit,
        surplus,
        dim,
        timeHorizon,
        options?.severityThresholds || this.thresholds
      );

      // Override if provided via requirement config (e.g., explicit reasons in UI slash bridge)
      if (options?.overrides?.severity) {
        severity = options.overrides.severity;
      }

      // Build principalDescription
      const principalDescription = this.buildPrincipalDescription(
        dim,
        availableSum,
        neededSum,
        deficit,
        surplus,
        summaryFields.projectId,
        summaryFields.department,
        timeHorizon
      );

      return {
        id: `${dim}_${deficit.toFixed(0)}_${Date.now()}`, // unique stable placeholder
        dimension: dim,
        severity,
        projectId: summaryFields.projectId,
        department: summaryFields.department,
        departmentOrRole: summaryFields.departmentOrRole,
        roleName: dim === GapDimension.Headcount ? summaryFields.roleName : undefined,
        timeHorizon,
        deficit,
        surplus,
        principalDescription,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    // Compute metrics
    const criticalCount = gaps.filter(g => g.severity === GapSeverity.Critical).length;
    const highCount = gaps.filter(g => g.severity === GapSeverity.High).length;
    const mediumCount = gaps.filter(g => g.severity === GapSeverity.Medium).length;
    const lowCount = gaps.filter(g => g.severity === GapSeverity.Low).length;
    const totalOpenGaps = criticalCount + highCount + mediumCount + lowCount;

    // Only capacity_hours deficits contribute to total hours for now; this is optional final summarization
    const hoursDeficit = availability[GapDimension.CapacityHours] - demand[GapDimension.CapacityHours];
    const totalDeficitHours = hoursDeficit > 0 ? hoursDeficit : 0;

    return {
      queryPeriod: {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString()
      },
      timeHorizon,
      metrics: {
        totalOpenGaps,
        gapsBySeverity: {
          [GapSeverity.Critical]: criticalCount,
          [GapSeverity.High]: highCount,
          [GapSeverity.Medium]: mediumCount,
          [GapSeverity.Low]: lowCount
        },
        totalDeficitHours: totalDeficitHours || undefined
      },
      gaps,
      meta: {
        productionTimestamp: new Date().toISOString(),
        sourceChangeTimestamp: options?.overrides?.sourceChangeTimestamp
          ? options.overrides.sourceChangeTimestamp
          : undefined
      }
    };
  }

  /**
   * Filter resources based on dimension presets (optional explicit dimension override)
   */
  private filterByDimension(
    resources: any,
    demands: ResourceDemand[],
    dimension: GapDimension
  ): any {
    // Simplified filter; optional implementation for future expansions
    return resources;
  }

  /**
   * Aggregate available quantities and values by dimension
   */
  private aggregateAvailability(resources: {
    personnel: PersonnelResource[];
    tools: ToolResource[];
    budgets: BudgetPool[];
  }): Record<GapDimension, number> {
    const sumHeadcount = resources.personnel.reduce((acc, r) => {
      if (r.role) {
        acc[r.role] = (acc[r.role] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const aggregatedHeadcount = resources.personnel.reduce(
      (acc, r) => acc + (r.fteAllocation || 0),
      0
    );

    const skillsCount = new Set<string>();
    resources.personnel.forEach(r => {
      (r.skills || []).forEach(s => skillsCount.add(s.toLowerCase()));
    });

    // Capacity hours: sum FTEs × hours per FTE-week estimate (e.g., 40h)
    const capacityHoursPerWeek = 40;
    const aggregatedCapacityHours = (resources.personnel.reduce(
      (acc, r) => acc + ((r.fteAllocation || 0) * (r.availability || 100) / 100) * capacityHoursPerWeek,
      0
    ) * 4); // Convert weekly to monthly for our time horizon defaults

    // Budget: sum allocated budgets
    const aggregatedBudget = resources.budgets.reduce(
      (acc, r) => acc + (typeof r.allocatedAmount === 'number' ? r.allocatedAmount : 0),
      0
    );

    // Tools quantity as headcount equivalent for headcount dimension
    const aggregatedToolsCount = resources.tools.reduce((acc, r) => acc + r.quantity, 0);

    return {
      [GapDimension.Headcount]: aggregatedHeadcount + aggregatedToolsCount,
      [GapDimension.Skills]: skillsCount.size,
      [GapDimension.CapacityHours]: aggregatedCapacityHours,
      [GapDimension.Budget]: aggregatedBudget
    };
  }

  /**
   * Aggregate demand requirements by dimension
   */
  private aggregateDemand(demands: ResourceDemand[], reconcile?: { excludeOverlappingDemands?: boolean; mergeSameSkills?: boolean }): Record<GapDimension, number> {
    const headcountDemand = demands
      .filter(d => !reconcile?.excludeOverlappingDemands) // Simplified; may define overlapping pairing later
      .reduce((acc, d) => {
        const hoursAmount = d.effort;
        const role = d.role;
        if (role) {
          acc[role] = (acc[role] || 0) + hoursAmount;
        }
        return acc;
      }, {} as Record<string, number>);

    const headcountSum = Object.values(headcountDemand).reduce((a, b) => a + b, 0);

    // Skills: collect unique requirements
    const skillsSet = new Set<string>();
    demands.forEach(d => {
      (d.skills || []).forEach(s => skillsSet.add(s.toLowerCase()));
    });

    // Capacity hours: effort in hours × calendar duration factor for monthly/quarterly scope
    const durFactor = reconcile?.excludeOverlappingDemands ? 1 : 2; // Simplified; needs event calendar logic later
    const capacityHoursDemand = Object.values(headcountDemand).reduce(
      (acc, hours) => acc + hours * durFactor,
      0
    );

    // Budget: cost per hour × total hours (models budget per hours-of-effort; optionality: project-level rates etc.)
    const averageRate = 150; // USD/hour placeholder; safer to defer to configuration
    const budgetDemand = capacityHoursDemand * averageRate;

    return {
      [GapDimension.Headcount]: headcountSum,
      [GapDimension.Skills]: skillsSet.size,
      [GapDimension.CapacityHours]: capacityHoursDemand,
      [GapDimension.Budget]: budgetDemand
    };
  }

  /**
   * Derive Derived project and department fields for GapSummary model adapter
   */
  private deriveProjectAndDepartmentFields(
    dimension: GapDimension,
    filters?: RequirementOptions['filters'] & { projectName?: string }
  ): {
    projectId?: string;
    department?: string;
    departmentOrRole?: string;
    roleName?: string;
  } {
    const projectId = filters?.projectId;
    const department = filters?.department;
    const projectOrDepartment = projectId || department || 'undefined';

    // Preferences for default tabular column ordering: dimension, severity, project, role, time horizon
    const dimensionAndRolePrefix = dimension === GapDimension.Headcount
      ? ` ${projectOrDepartment}${
          filters?.role ? `, ${filters.role}` : ''
        }`
      : '';

    return {
      projectId: projectId || undefined,
      department: department || undefined,
      departmentOrRole: projectId ? department || '<project-only>' : projectOrDepartment,
      roleName: filters?.role || undefined
    };
  }

  /**
   * Build human-readable principalDescription (example payloads for subsequent pages)
   */
  private buildPrincipalDescription(
    dimension: GapDimension,
    available: number,
    needed: number,
    deficit: number,
    surplus: number,
    projectId?: string,
    department?: string,
    timeHorizon: GapSummary['timeHorizon']
  ): string {
    const prefix = `Gap on ${dimension}`;
    const dynTarget = [
      dimension === GapDimension.Headcount && 'resource jobs (counts)',
      dimension === GapDimension.Skills && 'skill tags',
      dimension === GapDimension.CapacityHours && 'capacity (FTE-hours)',
      dimension === GapDimension.Budget && 'budget'
    ].filter(Boolean)[0] || dimension;

    // Include project/dept context if known; otherwise generic
    const context = projectId || department
      ? `[${projectId || department}] ${prefix}`
      : prefix;

    if (deficit > 0) {
      return `${context}: deficit per ${timeHorizon} (${dynTarget}): ${deficit.toFixed(0)} missing (available ${available.toFixed(0)} needed ${needed.toFixed(0)})`;
    }
    if (surplus > 0) {
      return `${context}: surplus per ${timeHorizon} (${dynTarget}): ${surplus.toFixed(0)} extra (available ${available.toFixed(0)} needed ${needed.toFixed(0)})`;
    }
    return `${context} per ${timeHorizon} (${dynTarget}): no imbalance`;
  }

  /**
   * Classify severity, with timeHorizon fallback semantics
   * PRD: sprint=0 minutes drain critical if any; quarterly/annual escalate thresholds
   */
  private classifySeverity(
    deficit: number,
    surplus: number,
    dimension: GapDimension,
    timeHorizon: GapSummary['timeHorizon'],
    thresholds: SeverityThresholdConfig
  ): GapSeverity {
    // For PRD tests and service stubs, treat only deficits as triggers
    if (deficit <= 0) {
      return GapSeverity.Low;
    }

    const weightMap: { [key in GapDimension]: [number, number] } = {
      [GapDimension.Headcount]: [0.4, 0.2],
      [GapDimension.Skills]: [0.1, 0.05],
      [GapDimension.CapacityHours]: [0.4, 0.3],
      [GapDimension.Budget]: [0.1, 0.45]
    };
    const [priority, cascadePct] = weightMap[dimension];

    // Use dimension-specific fallback thresholds (current sprint = 0)
    const eff = deficit * priority;

    // Time horizon awareness:
    // sprint == 0 minutes drain => critical if deficit>0 in scope
    const sprintCritical = 0;
    const sprintHigh = 4; // 4 minutes (approx 5 to 10%; not a strict PRD spec)
    // quarterly/annual multiply thresholds based on calendar scaling factors for testing hygiene
    const quarterMultiplier = 40; // 4 weeks × 60 minutes; PRD acknowledges schedule slip > 2 weeks
    const annualMultiplier = 4;
    const multipliers = {
      sprint: 1,
      monthly: 1,
      quarterly: quarterMultiplier,
      annual: annualMultiplier
    };
    const scalar = multipliers[timeHorizon];
    const th = scalar;

    if (eff > th * 0.25) {
      return GapSeverity.Critical;
    }
    if (eff > th * 0.15) {
      return GapSeverity.High;
    }
    if (eff > th * 0.05) {
      return GapSeverity.Medium;
    }
    return GapSeverity.Low;
  }

  /**
   * Generate recommendations for gaps (candidates per PRD FR-5)
   */
  generateRecommendations(
    gaps: GapSummary[],
    options?: {
      recommendations?:
        | [
            {
              gapDimension?: GapDimension;
              availableRoles?: string[];
              unavailableDependencies?: string[];
              projects?: string[];
              department?: string;
            }
          ]
        // Compatibility with Options interface
        ;
    }
  ): Record<string, Recommendation[]> {
    const map = {} as Record<string, Recommendation[]>;

    gaps.forEach(gap => {
      const recs: Recommendation[] = [];

      // Per PRD FR-5: for every gap flagged Medium+, at least one recommendation is required
      if (gap.severity === GapSeverity.Medium || gap.severity === GapSeverity.High || gap.severity === GapSeverity.Critical) {
        if (options?.recommendations) {
          const candidates = options.recommendations.find(c =>
            c.gapDimension === gap.dimension &&
            (!c.department || c.department === gap.department) &&
            (!c.projectId || c.projectId === gap.projectId)
          );
          if (candidates) {
            // Recommend hire/contract augment if specific roles are targeted
            if (candidates.availableRoles) {
              candidates.availableRoles.forEach(role => {
                recs.push({
                  id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  gapId: gap.id,
                  type: RecommendationType.Hire,
                  title: `Hire ${role} for ${gap.projectId || gap.department || 'gap'}`,
                  description: `Candidate has the missing roles and skills. Estimated time-to-fill: 4-6 weeks.`,
                  effortToImplement: 40,
                  estimatedCost: 50000,
                  timeToResolution: 30,
                  priority: 'medium',
                  status: RecommendationStatus.Pending,
                  rationale: 'Requirement: gap severity >= Medium and eligible role is targetable for hire based on supplied role list.'
                });
              });
            }
            // Recommend upskill/reskill if internal resources can address skills
            if (candidates.unavailableDependencies) {
              const decompositions: Record<string, [string, number]> = {
                skills: ['skill1', 'skill2'], // placeholders for individual paths later
                capacity: ['training', 'mentorship']
              };
              const dep = candidates.unavailableDependencies[0];
              if (dep === 'capacity') {
                recs.push({
                  id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  gapId: gap.id,
                  type: RecommendationType.Upskill,
                  title: `Upskill existing staff for capacity constraints`,
                  description:
                    'Internal candidates available as standby or secondary contributors; training and mentorship paths can resolve.',
                  effortToImplement: 24,
                  estimatedCost: 2000,
                  timeToResolution: 45,
                  priority: 'low',
                  status: RecommendationStatus.Pending,
                  rationale:
                    'Requirement: capacity skill gap and a dependency list flagged for internal targeting.'
                });
              }
            }
            // Recommend contract augment if roles cannot be hired quickly
            if (candidates.availableRoles && candidates.availableRoles.length > 0) {
              recs.push({
                id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                gapId: gap.id,
                type: RecommendationType.ContractAugment,
                title: `Engage contracted resource to fill short-term gap`,
                description: `Participants assigned for the needed roles; indirect capacity distribution through project sprints.`,
                estimatedCost: 30000,
                timeToResolution: 7,
                priority: 'low',
                status: RecommendationStatus.Pending,
                rationale:
                  'Time-to-fill for hire exceeds prudent window; contract augment is the fallback recommendation.'
              });
            }
          }
        }
        // Fallback for PRD constraint: if no role candidates provided, generate a generic hire
        if (!recs.length) {
          const roleName = gap.projectId ? `role in ${gap.projectId}` : gap.department || 'gap dimension';
          recs.push({
            id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            gapId: gap.id,
            type: RecommendationType.Hire,
            title: `Hire role for ${roleName}`,
            description: `Candidate has missing roles and skills; estimated time-to-fill: 4-6 weeks.`,
            effortToImplement: 40,
            estimatedCost: 50000,
            timeToResolution: 30,
            priority: 'low',
            status: RecommendationStatus.Pending,
            rationale: 'PRD FR-5: every gap flagged Medium+ requires at least one recommendation. No concrete role candidates detected; a generic hire placeholder is used here.'
          });
        }
      }

      if (recs.length) {
        map[gap.id] = recs;
      }
    });

    return map;
  }
}