/**
 * Recommendation Generator (aligned with PRD FR-5)
 *
 * Maps identified gaps to actionable recommendations with priority, effort, cost, and owner.
 * Outputs a list of Recommendations bound to matched GapResult IDs.
 */

import {
  GapResult,
  GapAnalysisResult,
  Recommendation,
  RecommendationType,
  RecommendationStatus,
  GapDimension,
  GapSeverity,
} from './types';

const DEFAULT_TIME_TO_RESOLVE_DAYS = 30;
const HIGH_IMPACT_URGENCY_STEPS = 2;

/**
 * Assign priority to a recommendation based on gap severity and dimension
 */
function assignPriority(
  severity: GapSeverity,
  dimension: GapDimension,
): 'low' | 'medium' | 'high' {
  const isCriticalOrHigh = severity === GapSeverity.Critical || severity === GapSeverity.High;
  const isCapacityHeadcountSorta = dimension === GapDimension.CapacityHours || dimension === GapDimension.Headcount;
  const isUrgent = isCriticalOrHigh || (isCapacityHeadcountSorta && severity === GapSeverity.Medium);
  return isUrgent ? 'high' : 'medium';
}

/**
 * Generate description for a recommendation anchored to gap principalDescription
 */
function generateDescription(gap: GapResult, recType: RecommendationType): string {
  const mod = gap.principalDescription.replace('no gap', '').replace('missing', '').trim();
  switch (recType) {
    case RecommendationType.Hire:
      return `Recruit ${mod} to close the identified gap; vet against [RoleCriterion] in [System]`;
    case RecommendationType.Upskill:
      return `Upskill existing team members to meet skill needs for ${mod}`;
    case RecommendationType.Reskill:
      return `Reskill current staff into matched roles for ${mod}`;
    case RecommendationType.Reallocate:
      return `Reallocate underutilized staff with compatible skills to bridge ${mod}`;
    case RecommendationType.Defer:
      return `Defer non-critical components of ${mod} pending capacity clearing; document and review`;
    case RecommendationType.ContractAugment:
      return `Engage external contractors for time-boxed gap compensation; engage via [System]`;
    default:
      return 'Implement mitigation for this gap';
  }
}

/**
 * Generate owner suggestion based on gap department
 */
function suggestOwner(gap: GapResult): string | undefined {
  const roleFamily = gap.dimension === GapDimension.Headcount ? gap.principalBreakdown?.[0]?.roleName : 'Resource Manager';
  const dept = gap.department || 'Global';
  return `${roleFamily} in ${dept}`; // Example: "Senior Engineer in Engineering"
}

/**
 * Main generator entry point: gap analysis → recommendations
 */
export function generateRecommendations(
  analysis: GapAnalysisResult,
  config?: {
    timeToResolveDays?: number;
    costRateCurrency?: string;
  },
): GapAnalysisResult {
  let recs: Recommendation[] = [];
  const currency = config?.costRateCurrency || 'USD';
  const baseTimeToResolve = config?.timeToResolveDays ?? DEFAULT_TIME_TO_RESOLVE_DAYS;

  analysis.gaps.forEach(gap => {
    const severity = gap.severity;
    const dimension = gap.dimension;
    let candidates: RecommendationType[] = [];

    // Map gap dimensions to recommendation categories (simplified Logic)
    switch (dimension) {
      case GapDimension.Headcount:
        candidates = [RecommendationType.Hire, RecommendationType.Reskill, RecommendationType.ContractAugment];
        break;
      case GapDimension.CapacityHours:
        candidates = [RecommendationType.Reallocate, RecommendationType.ContractAugment];
        break;
      case GapDimension.Budget:
        candidates = [RecommendationType.ContractAugment];
        break;
      case GapDimension.Skills:
        candidates = [RecommendationType.Upskill, RecommendationType.Reskill, RecommendationType.Hire];
        break;
    }

    // Assign recommendation(s) sorted by priority and dimension alignment
    candidates.forEach(recType => {
      const rec: Recommendation = {
        id: `rec-${gap.id}-${recType}`,
        gapId: gap.id,
        type: recType,
        title: `${recType.toUpperCase()} for: ${gap.principalDescription}`,
        description: generateDescription(gap, recType),
        effortToImplement: recType === RecommendationType.Defer ? 0 : Math.random() * 40 + 1, // randomized placeholder effort in hours
        estimatedCost: recType === RecommendationType.Hire ? Math.random() * 100000 + 50000 : recType === RecommendationType.ContractAugment ? Math.random() * 50000 + 10000 : undefined,
        timeToResolution: recType === RecommendationType.Defer ? undefined : Math.round(baseTimeToResolve / 7) * 7, // baseTimeToResolve in days
        priority: assignPriority(severity, dimension),
        status: RecommendationStatus.Pending,
        owner: suggestOwner(gap),
        dueDate: recType === RecommendationType.Defer ? undefined : new Date(Date.now() + baseTimeToResolve * 24 * 60 * 60 * 1000).toISOString(),
        rationale: `Drives resolution of a ${severity} ${dimension} gap (${gap.principalDescription})`,
      };
      recs.push(rec);
    });
  });

  // Return a copy of the analysis with recommendations populated
  return {
    ...analysis,
    recommendations: recs,
    meta: {
      ...analysis.meta,
      generatedAt: new Date().toISOString(),
      sourceRef: analysis.meta?.sourceRef || `generator-${new Date().toISOString()}`,
    },
  };
}