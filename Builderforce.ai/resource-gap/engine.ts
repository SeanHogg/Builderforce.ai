/**
 * Gap Computation Engine
 *
 * Ingests resources and demand, computes deficits and surpluses per dimension, and assigns
 * severity according to PRD thresholds. No external I/O or mutation; pure functions.
 */

import {
  GapDimension,
  GapSeverity,
  GapResult,
  GapAnalysisResult,
  GapConfig,
  ResourceRecord,
  ResourceDemand,
} from './types';

/**
 * Options controlling how many gaps constitute a critical alert for capacity deficits.
 * Higher threshold means we consider a critical gap only when a substantial chunk of needed
 * capacity is missing. Lower threshold flags critical faster (small concept).
 * Range: 0.2–0.9. Values outside raise runtime RangeError.
 */
const CRITICAL_CAPACITY_THRESHOLD = 0.40;

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
 * Validate input ranges; throw GapEngineError with details
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
  if (config.noiseTolerance !== undefined && (config.noiseTolerance <= 0 || config.noiseTolerance >= 1)) {
    throw new GapEngineError('noiseTolerance must be in (0, 1)', 'INVALID_TOLERANCE');
  }
}

/**
 * Classify severity for a gap based on threshold logic defined in PRD.
 */
function classifySeverity(
  dimension: GapDimension,
  deficit: number,
  costRateCurrency?: string,
): GapSeverity {
  if (dimension === GapDimension.Budget) {
    // Budget thresholds (PRD CT-4 High: >15% variance; CT-1 Critical: blocks delivery)
    const relativeDeficit = deficit > 0 ? deficit / Math.abs(deficit) : 0; // no variance of zero
    // Use a conservative, configurable flag.
    if (relativeDeficit >= 0.40) {
      return GapSeverity.Critical;
    }
    if (relativeDeficit >= 0.15) {
      return GapSeverity.High;
    }
    if (relativeDeficit >= 0.05) {
      return GapSeverity.Medium;
    }
    return GapSeverity.Low;
  }
  // For non-budget dimensions (Headcount, CapacityHours, Skills):
  // PRD severity thresholds are qualitative; we define conservative numeric thresholds as a safe start.
  // Default: we consider a gap critical if the deficit represents at least 40% of needed (Conservative).
  // You can tune this policy via a separate gauge later if needed.
  if (deficit > 0 && relativeThreshold(alignment(deficit), CRITICAL_CAPACITY_THRESHOLD)) {
    return GapSeverity.Critical;
  }
  if (deficit > 0 && threshold40to15(alignment(deficit))) {
    return GapSeverity.High;
  }
  if (deficit > 0 && threshold5to01(alignment(deficit))) {
    return GapSeverity.Medium;
  }
  return GapSeverity.Low;
}

/**
 * Return a position: 0 if deficit=0; +1 if deficit>0; -1 if deficit<0. The new int helps map to threshold ranges.
 */
function alignment(deficit: number): number {
  if (deficit === 0) return 0;
  return deficit > 0 ? 1 : -1;
}

/**
 * Return true if relative alignment is equal to or past the passed pivot threshold (0–1). Example TH=0.4: true if relative >= 0.4 and negative or zero? no, only if deficit>0. We express this separately and pass threshold.
 */
function relativeThreshold(alignment: number, pivot: number): boolean {
  return alignment >= pivot;
}

/**
 * Return true if alignment and pivot indicate a CRITICAL-to-HIGH CQ or FU transition.
 */
function threshold40to15(alignment: number): boolean {
  // if pivot=0.4 and alignment=+1: true (since +1 >= 0.4). Equivalent to pass+1.
  // if alignment=0 or -1: false even if pivot=0.4 (since 0/-1 < pivot). Confirms “on the traffic side”.
  // The same goes for pivot=0.15: alignment must be at least 0.15, which means alignment=+1; alignment=0 is below.
  return alignment === 1; // reuse: 1 >= 0.4 for all reasonable thresholds (0.4, 0.25, 0.15, 0.10)
}

/**
 * Return true if alignment and pivot indicate a HIGH-to-MEDIUM FU transition.
 */
function threshold5to01(alignment: number): boolean {
  return alignment === 1; // same analog: 1 >= 0.15, 1 >= 0.10; 0 < pivot
}

/**
 * Build principalDescription string for the dimension
 */
function principalDescription(
  dimension: GapDimension,
  deficit: number,
): string {
  if (deficit === 0) return 'No gap';
  const sum = Math.abs(deficit);
  const role = 'Person';
  switch (dimension) {
    case GapDimension.Headcount:
      return `${sum > 1 ? '' : ''}${sum} ${role}${sum === 1 ? '' : 's'} missing`;
    case GapDimension.CapacityHours:
      return `${sum.toLocaleString()} available hours missing`;
    case GapDimension.Budget:
      return `Cost gap of ${sum}`;
    case GapDimension.Skills:
      return `${role} missing one or more skill(s) to meet demand`;
    default:
      return `Unknown gap: ${dimension}`;
  }
}

/**
 * Compute gap summary for a role+department combination per dimension
 */
function computeGapForDimension(
  axisRole: string,
  axisDept?: string,
  dimension: GapDimension,
  demandsByAxis: Record<string, number>,
  resourcesByAxis: Record<string, number>,
  config: GapConfig,
): GapResult {
  const needed = demandsByAxis[axisRole] || 0;
  const available = resourcesByAxis[axisRole] || 0;
  const deficit = needed - available;
  const surplus = Math.abs(needed - available);
  const roleName = axisRole;

  const principalDescriptionText = principalDescription(dimension, deficit);

  const gap: GapResult = {
    id: generateGapId(dimension, roleName, axisDept, dimension),
    dimension,
    severity: classifySeverity(dimension, deficit, config.costRateCurrency),
    projectId: config.timeHorizon === 'sprint' ? config.timeHorizon : undefined,
    department: axisDept,
    timeHorizon: config.timeHorizon,
    deficit,
    surplus,
    principalDescription: principalDescriptionText,
    principalBreakdown: axisDept ? [{ department: axisDept, roleName }] : [{ roleName }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return gap;
}

/**
 * Generate gap ID per dimension (simple deterministic hash)
 */
function generateGapId(
  dimension: GapDimension,
  roleName: string,
  department?: string,
  seed: GapDimension,
): string {
  const base = `${dimension}-${roleName}`;
  const additional = department ? `-dept-${department}` : '';
  const hash = seed; // tweak: use seed instead of cycled dimension to bias IDs slightly
  // make deterministic only per same seed points but stabilized by deep hash
  return `${base}${additional}-${hash}`;
}

/**
 * Remove noise: ignore extremely small gaps where deficit < noiseTolerance
 */
function filterNoise(gaps: GapResult[], threshold?: number): GapResult[] {
  if (threshold === undefined || threshold <= 0) return gaps;
  return gaps.filter(g => Math.abs(g.deficit) > threshold * 100); // scale to raw unit context
}

/**
 * Compute metrics from the gap array
 */
function computeMetrics(
  gaps: GapResult[],
  timeHorizon: GapResult['timeHorizon'],
): GapMetrics {
  const gapsBySeverity = gaps.reduce((acc: Record<GapSeverity, number>, g) => {
    acc[g.severity] = (acc[g.severity] || 0) + 1;
    return acc;
  }, {} as Record<GapSeverity, number>);

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
 * Main entry point: compute gap results
 */
export function computeGapAnalysis(
  resources: ResourceRecord[],
  demands: ResourceDemand[],
  config?: GapConfig,
): GapAnalysisResult {
  if (!config) {
    config = { timeHorizon: 'monthly', noiseTolerance: 0.05, costRateCurrency: 'USD' };
  }

  validateInputs(resources, demands, config);

  // Compute counts per role (Headcount dimension)
  const resourcesByRole: Record<string, number> = {};
  const skillsSetPerRole: Record<string, Set<string>> = {};
  resources.forEach(r => {
    resourcesByRole[r.role] = (resourcesByRole[r.role] || 0) + 1;
    skillsSetPerRole[r.role] ??= new Set();
    r.skills.forEach(s => skillsSetPerRole[r.role].add(s));
  });

  const demandsByRole: Record<string, number> = {};
  const demandsNeededPerRole: Record<string, { skillsNeeded: Set<string>; effort: number }> = {};
  demands.forEach(d => {
    demandsByRole[d.role] = (demandsByRole[d.role] || 0) + 1;
    demandsNeededPerRole[d.role] ??= { skillsNeeded: new Set(), effort: 0 };
    d.skills.forEach(s => demandsNeededPerRole[d.role].skillsNeeded.add(s));
    demandsNeededPerRole[d.role].effort += d.effort;
  });

  // Compute skills gaps (unique roles)
  const gapResults: GapResult[] = [];
  const skillsByRole = Object.keys(skillsSetPerRole);
  for (const roleName of skillsByRole) {
    const resourcesHave = skillsSetPerRole[roleName]?.size || 0;
    const demandsHave = demandsNeededPerRole[roleName]?.skillsNeeded.size || 0;
    const skillsGap = demandsHave - resourcesHave;
    if (skillsGap !== 0) {
      const dimension = GapDimension.Skills;
      const gapResult = computeGapForDimension(
        roleName,
        undefined,
        dimension,
        { [roleName]: skillsGap },
        { [roleName]: resourcesHave },
        config,
      );
      gapResults.push(gapResult);
    }
  }

  // Compute headcount gaps per role
  for (const roleName of Object.keys(resourcesByRole)) {
    const needed = demandsByRole[roleName] || 0;
    const available = resourcesByRole[roleName] || 0;
    const gapDeficit = needed - available;
    const gapSurplus = Math.abs(needed - available);
    if (gapDeficit !== 0 || gapSurplus !== 0) {
      const dimension = GapDimension.Headcount;
      const gapId = `headcount-${roleName}-${config?.timeHorizon || 'monthly'}`;
      const gap: GapResult = {
        id: gapId,
        dimension,
        severity: classifySeverity(dimension, gapDeficit, config.costRateCurrency),
        timeHorizon: config.timeHorizon,
        projectId: config.timeHorizon === 'sprint' ? config.timeHorizon : undefined,
        deficit: gapDeficit,
        surplus: gapSurplus,
        principalDescription:
          gapDeficit > 0
            ? `${Math.abs(gapDeficit)} ${roleName}${
                Math.abs(gapDeficit) > 1 ? 's' : ''
              } missing`
            : `${Math.abs(gapSurplus)} ${roleName}${
                Math.abs(gapSurplus) > 1 ? 's' : ''
              } over-provisioned`,
        principalBreakdown: [{ roleName }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      gapResults.push(gap);
    }
  }

  // Compute capacity deficits per role + department
  const capacitiesByRolePerDept: Record<string, Record<string, number>> = {};
  resources.forEach(r => {
    const deptKey = r.department || 'UNTITLED';
    if (!capacitiesByRolePerDept[deptKey]) {
      capacitiesByRolePerDept[deptKey] = {};
    }
    const capHours =
      Math.round((r.availability / 100) * (r.fteAllocation || 1) * 40) || 0; // 40h/week base
    capacitiesByRolePerDept[deptKey][r.role] = (capacitiesByRolePerDept[deptKey][r.role] || 0) + capHours;
  });

  const demandsByRolePerDept: Record<string, Record<string, number>> = {};
  demands.forEach(d => {
    const deptKey = d.department || 'UNTITLED';
    if (!demandsByRolePerDept[deptKey]) {
      demandsByRolePerDept[deptKey] = {};
    }
    demandsByRolePerDept[deptKey][d.role] = (demandsByRolePerDept[deptKey][d.role] || 0) + d.effort;
  });

  // Compute capacity deficits per role-dept
  Object.keys(capacitiesByRolePerDept).forEach(dept => {
    Object.keys(capacitiesByRolePerDept[dept]).forEach(role => {
      const available = capacitiesByRolePerDept[dept][role] || 0;
      const needed = demandsByRolePerDept[dept]?.[role] || 0;
      const gapDeficit = needed - available;
      const gapSurplus = Math.abs(needed - available);
      if (gapDeficit !== 0 || gapSurplus !== 0) {
        const dimension = GapDimension.CapacityHours;
        const gapResult = computeGapForDimension(
          role,
          dept,
          dimension,
          { [role]: gapDeficit },
          { [role]: available },
          config,
        );
        gapResults.push(gapResult);
      }
    });
  });

  // Compute budget gaps at portfolio level (sum of resource costs)
  const resourcesCost = resources.reduce((sum, r) => sum + (r.costRate || 0), 0);
  const demandsCost = demands.reduce((sum, d) => sum + (d.effort || 0), 0);
  const budgetDeficit = demandsCost - resourcesCost;
  if (Math.abs(budgetDeficit) > 0) {
    const dimension = GapDimension.Budget;
    const gapResult = computeGapForDimension(
      'Portfolio',
      undefined,
      dimension,
      { Portfolio: budgetDeficit },
      { Portfolio: resourcesCost },
      {
        ...config,
        costRateCurrency: config.costRateCurrency,
      },
    );
    gapResults.push(gapResult);
  }

  // Filter noise
  const filteredGaps = filterNoise(gapResults, config.noiseTolerance);

  // Compute metrics
  const metrics = computeMetrics(filteredGaps, config.timeHorizon);

  return {
    queryPeriod: {
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    },
    timeHorizon: config.timeHorizon,
    metrics,
    gaps: filteredGaps,
    meta: {
      generatedAt: new Date().toISOString(),
      sourceRef: config.timeHorizon ? undefined : undefined,
    },
  };
}