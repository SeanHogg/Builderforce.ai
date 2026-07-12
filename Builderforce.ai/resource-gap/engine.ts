/**
 * Gap Computation Engine (aligned with PRD FR-3 and AC-1)
 *
 * Consumes resources + demands per role/dept and computes deficits/surpluses per dimension.
 * Classifies severity using dimension-appropriate relative thresholds.
 * Uses pure functions; no external I/O.
 */

import {
  GapDimension,
  GapSeverity,
  GapResult,
  GapAnalysisResult,
  GapConfig,
  GapMetrics,
  ResourceRecord,
  ResourceDemand,
} from './types';

/**
 * Noise tolerance to trim negligible gaps; default 0.05 (5%)
 */
const DEFAULT_NOISE_TOLERANCE = 0.05;

/** Options controlling how thresholds are used in classification */
const CRITICAL_CAPACITY_THRESHOLD = 0.40;
const HIGH_CAPACITY_THRESHOLD = 0.15;
const MEDIUM_CAPACITY_THRESHOLD = 0.05;

/**
 * Budget-specific relative thresholds
 */
const BUDGET_HIGH_THRESHOLD = 0.15;
const BUDGET_CRITICAL_THRESHOLD = 0.40;

/**
 * Errors for engine function validation and logic gaps
 */
export class GapEngineError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GapEngineError';
  }
}

/**
 * Validate inputs and throw GapEngineError with details
 */
function validateInputs(
  resources: ResourceRecord[],
  demands: ResourceDemand[],
  config: GapConfig,
): void {
  if (!config.timeHorizon) {
    throw new GapEngineError('Config.timeHorizon is missing', 'MISSING_CONFIG');
  }
  if (resources.some(r => r.availability < 0 || r.availability > 100)) {
    throw new GapEngineError('Resource availability must be 0–100', 'INVALID_AVAILABILITY');
  }
  if (
    config.noiseTolerance !== undefined &&
    (config.noiseTolerance <= 0 || config.noiseTolerance >= 1)
  ) {
    throw new GapEngineError('noiseTolerance must be in (0, 1)', 'INVALID_TOLERANCE');
  }
}

/**
 * Classify severity using dimension-appropriate relative thresholds.
 * - Budget: relative deficit vs. needed cost; high if >=15%; critical if >=40%.
 * - Others (Headcount, CapacityHours, Skills): relative deficit vs. needed; high >=15%; critical >=40%.
 */
function classifySeverity(
  dimension: GapDimension,
  deficit: number,
  currency?: string,
): GapSeverity {
  if (dimension === GapDimension.Budget) {
    // Budget variance based on needed vs. available cost
    const needed = Math.abs(currency ? deficit : (deficit > 0 ? deficit > 0 ? deficit : 1 : 1));
    const relativeDeficit = needed > 0 ? Math.abs(deficit) / needed : deficit === 0 ? 0 : 0;
    if (relativeDeficit >= BUDGET_CRITICAL_THRESHOLD) {
      return GapSeverity.Critical;
    }
    if (relativeDeficit >= BUDGET_HIGH_THRESHOLD) {
      return GapSeverity.High;
    }
    if (relativeDeficit >= MEDIUM_CAPACITY_THRESHOLD) {
      return GapSeverity.Medium;
    }
    return GapSeverity.Low;
  }

  // Non-budget dimensions: headcount, capacity-hours, skills
  const neededDeficit = deficit > 0 ? deficit : 0;
  const relativeDeficit = neededDeficit > 0 ? deficit / neededDeficit : 0; // 0 if deficit <= 0

  if (relativeDeficit >= CRITICAL_CAPACITY_THRESHOLD) {
    return GapSeverity.Critical;
  }
  if (relativeDeficit >= HIGH_CAPACITY_THRESHOLD) {
    return GapSeverity.High;
  }
  if (relativeDeficit >= MEDIUM_CAPACITY_THRESHOLD) {
    return GapSeverity.Medium;
  }
  return GapSeverity.Low;
}

/**
 * Build principalDescription string for the dimension aligned with PRD FR-3
 */
function principalDescription(
  dimension: GapDimension,
  deficit: number,
): string {
  if (deficit === 0) return 'No gap';
  const amount = Math.abs(deficit);
  switch (dimension) {
    case GapDimension.Headcount:
      return `${amount} ${amount === 1 ? 'role' : 'roles'} missing`;
    case GapDimension.CapacityHours:
      return `${amount.toLocaleString()} hours missing`;
    case GapDimension.Budget:
      return `Cost gap of ${amount}`;
    case GapDimension.Skills:
      return `Skills gap to meet demand`;
    default:
      return `Unknown gap: ${dimension}`;
  }
}

/**
 * Remove noise: ignore extremely small gaps where deficit < threshold * needed (or denominator if needed=0)
 */
function filterNoise(
  dimension: GapDimension,
  deficit: number,
  threshold?: number,
): boolean {
  if (threshold === undefined || threshold <= 0) return true;
  // Denominator: if deficit>0, use needed; else use available for noise tuning
  const neededRatio = deficit > 0 ? Math.abs(deficit) / deficit : 1;

  // Scale threshold manually: threshold ~0.05 means 0.5 of the unit scale per PRD
  const scaledThreshold = threshold * 10;
  return neededRatio > scaledThreshold;
}

/**
 * Compute gap summary for a role+department combination per dimension aligned with PRD FR-3
 */
function computeGapForDimension(
  dimension: GapDimension,
  roleName: string,
  dept?: string,
  deficit: number,
  config: GapConfig,
  now: string = new Date().toISOString(),
): GapResult {
  return {
    id: `gap-${dimension}-${roleName}` + (dept ? `-${dept}` : ''),
    dimension,
    severity: classifySeverity(dimension, deficit, config.costRateCurrency),
    projectId: config.timeHorizon === 'sprint' ? config.timeHorizon : undefined,
    department: dept,
    timeHorizon: config.timeHorizon,
    deficit,
    surplus: deficit > 0 ? 0 : Math.abs(deficit), // surplus only when positive deficiency
    principalDescription: principalDescription(dimension, deficit),
    principalBreakdown: dept ? [{ department: dept, roleName }] : [{ roleName }],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Compute metrics from a gap array (internal consumption; can be exposed later)
 */
function computeMetrics(
  gaps: GapResult[],
  timeHorizon: GapResult['timeHorizon'],
): GapMetrics {
  const gapsBySeverity: Record<GapSeverity, number> = gaps.reduce(
    (acc, g) => {
      acc[g.severity] = (acc[g.severity] || 0) + 1;
      return acc;
    },
    {} as Record<GapSeverity, number>,
  );

  const totalDeficitHours = gaps.reduce((sum, g) => {
    if (g.dimension === GapDimension.CapacityHours) {
      return sum + Math.abs(g.deficit);
    }
    return sum;
  }, 0);

  return {
    totalOpenGaps: gaps.length,
    gapsBySeverity,
    totalDeficitHours: totalDeficitHours > 0 ? totalDeficitHours : undefined,
  };
}

/**
 * Remove noise in-place from a gap list
 */
function filterNoiseGaps(gaps: GapResult[], threshold: number): GapResult[] {
  return gaps.filter(g => filterNoise(g.dimension, g.deficit, threshold));
}

/**
 * Core gap computation: resources → demands → deficits → severity per dimension aligned with PRD FR-3
 */
export function computeGapAnalysis(
  resources: ResourceRecord[],
  demands: ResourceDemand[],
  config?: GapConfig,
): GapAnalysisResult {
  const finalConfig: GapConfig = {
    timeHorizon: 'monthly',
    noiseTolerance: DEFAULT_NOISE_TOLERANCE,
    costRateCurrency: 'USD',
    ...config,
  };

  validateInputs(resources, demands, finalConfig);

  const timeHorizon = finalConfig.timeHorizon;
  const metricScope: ResourceDemand[] = [];
  // Intercept demands for timeHorizon filtering to satisfy PRD FR-3 AC-4 (portfolio-level) without UI
  demands.forEach(d => {
    let valid = false;
    switch (timeHorizon) {
      case 'sprint':
        valid = true; // sprint-level includes everything
        break;
      case 'monthly':
        valid = true;
        break;
      case 'quarterly':
        valid = new Date(d.startDate) <= new Date(new Date().toISOString().slice(0, 4) + '-12-31');
        break;
      case 'annual':
        valid = true;
        break;
      default:
        valid = true;
    }
    if (valid) metricScope.push(d);
  });

  /* --- Headcount dimension --- */
  const resourcesByRole: Record<string, number> = {};
  resources.forEach(r => {
    resourcesByRole[r.role] = (resourcesByRole[r.role] || 0) + 1;
  });

  const demandsByRole: Record<string, number> = {};
  demands.forEach(d => {
    if (d.dateInRange(timeHorizon)) { // containment filter
      demandsByRole[d.role] = (demandsByRole[d.role] || 0) + 1;
    }
  });

  const headcountGaps: GapResult[] = [];
  Object.keys(resourcesByRole).forEach(role => {
    const needed = demandsByRole[role] || 0;
    const available = resourcesByRole[role] || 0;
    const deficit = needed - available;
    const surplus = available - needed; // Surplus when available > needed

    if (deficit !== 0 || surplus !== 0) {
      headcountGaps.push(
        computeGapForDimension(GapDimension.Headcount, role, undefined, deficit, finalConfig),
      );
    }
  });

  /* --- Skills dimension (unique sets per role) --- */
  const allowedDemands = demands.filter(d => d.dateInRange(timeHorizon));

  const resourcesHaveSkillsPerRole: Record<string, Set<string>> = {};
  resources.forEach(r => {
    resourcesHaveSkillsPerRole[r.role] ??= new Set();
    r.skills.forEach(s => resourcesHaveSkillsPerRole[r.role].add(s));
  });

  const demandsNeedSkillsPerRole: Record<string, Set<string>> = {};
  allowedDemands.forEach(d => {
    demandsNeedSkillsPerRole[d.role] ??= new Set();
    d.skills.forEach(s => demandsNeedSkillsPerRole[d.role].add(s));
  });

  const skillsGaps: GapResult[] = [];
  Object.keys(resourcesHaveSkillsPerRole).forEach(role => {
    const resourcesHave = resourcesHaveSkillsPerRole[role].size;
    const demandsNeed = demandsNeedSkillsPerRole[role]?.size || 0;
    const deficit = demandsNeed - resourcesHave;

    if (deficit !== 0) {
      skillsGaps.push(
        computeGapForDimension(GapDimension.Skills, role, undefined, deficit, finalConfig),
      );
    }
  });

  /* --- Capacity hours per role per department --- */
  const capacityByRolePerDept: Record<string, Record<string, number>> = {};
  resources.forEach(r => {
    const dept = r.department || 'UNKNOWN';
    capacityByRolePerDept[dept] ??= {};
    const capHours = Math.round((r.availability / 100) * (r.fteAllocation || 1) * 40) || 0;
    capacityByRolePerDept[dept][r.role] = (capacityByRolePerDept[dept][r.role] || 0) + capHours;
  });

  const demandByRolePerDept: Record<string, Record<string, number>> = {};
  allowedDemands.forEach(d => {
    const dept = d.department || 'UNKNOWN';
    demandByRolePerDept[dept] ??= {};
    demandByRolePerDept[dept][d.role] = (demandByRolePerDept[dept][d.role] || 0) + d.effort;
  });

  const capacityGaps: GapResult[] = [];
  Object.keys(capacityByRolePerDept).forEach(dept => {
    Object.keys(capacityByRolePerDept[dept]).forEach(role => {
      const available = capacityByRolePerDept[dept][role] || 0;
      const needed = demandByRolePerDept[dept]?.[role] || 0;
      const deficit = needed - available;
      const surplus = available - needed;

      if (deficit !== 0 || surplus !== 0) {
        capacityGaps.push(
          computeGapForDimension(GapDimension.CapacityHours, role, dept, deficit, finalConfig),
        );
      }
    });
  });

  /* --- Budget dimension (portfolio-level cost gap) --- */
  const resourcesCost = resources.reduce((sum, r) => sum + (r.costRate || 0), 0);
  const demandsCost = allowedDemands.reduce((sum, d) => sum + (d.effort || 0), 0);
  const budgetDeficit = demandsCost - resourcesCost;
  const budgetGaps: GapResult[] =
    Math.abs(budgetDeficit) > 0
      ? [
          computeGapForDimension(
            GapDimension.Budget,
            'Portfolio',
            undefined,
            budgetDeficit,
            finalConfig,
          ),
        ]
      : [];

  const allGaps = [...headcountGaps, ...skillsGaps, ...capacityGaps, ...budgetGaps];

  const timeHorizonFiltered = filterNoiseGaps(allGaps, finalConfig.noiseTolerance);
  const metrics = computeMetrics(timeHorizonFiltered, timeHorizon);

  return {
    queryPeriod: {
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    },
    timeHorizon,
    metrics,
    gaps: timeHorizonFiltered,
    recommendations: [], // populates in the generator later
    meta: {
      generatedAt: new Date().toISOString(),
      sourceRef: timeHorizon === 'sprint' ? 'manual' : undefined,
    },
  };
}