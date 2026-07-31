/**
 * @file tool.ts
 * @module @builderforce/resource-gap-engine
 * @description Tool registration for Resource Gap Engine.
 */

import type {
  AnyAgentTool,
  BuilderForceAgentsPluginApi,
} from "../../src/plugins/types.js";
import {
  ToolInputError,
  jsonResult,
} from "../../src/agents/tools/common.js";
import {
  DEFAULT_RESOURCE_GAP_CONFIG,
  type Proficiency,
  type ResourceGapEngineConfig,
} from "./configuration.js";
import { computeGaps } from "./engine.js";
import type {
  DeploymentCandidate,
  DeploymentRecommendation,
  Employee,
  EmployeeSkill,
  GapComputationResult,
  HiringRecommendation,
  ProjectDemand,
  ProficiencyWeightEntry,
  Quarter,
  SkillGap,
  SkillProficiency,
  SeniorityBand,
  UpskillRecommendation,
  GapSeverity,
  UrgencyTier,
  LearningCategory,
  RecommendationStatus,
} from "./types.js";

// ── Recommendation engine ────────────────────────────────────────────

function seniorityRank(s: SeniorityBand): number {
  const order: SeniorityBand[] = ["junior", "mid", "senior", "staff", "principal"];
  return order.indexOf(s);
}

function computeUrgency(
  severity: GapSeverity,
  demandStartQuarter: Quarter,
  timeToFillDays: number,
): UrgencyTier {
  // Parse demand quarter to date distance
  const m = demandStartQuarter.match(/^(\d{4})-Q([1-4])$/i);
  let daysUntilDemand = 9999;
  if (m) {
    const year = Number(m[1]);
    const q = Number(m[2]);
    const month = (q - 1) * 3; // Jan-based
    const demandDate = new Date(year, month, 1);
    const now = new Date();
    const diffMs = demandDate.getTime() - now.getTime();
    daysUntilDemand = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  if (severity === "critical" || daysUntilDemand <= timeToFillDays) return "P1";
  if (severity === "moderate" || daysUntilDemand <= timeToFillDays * 2) return "P2";
  return "P3";
}

function quarterDiffMonths(startQ: Quarter, endQ: Quarter): number {
  const parse = (q: Quarter) => {
    const mm = q.match(/^(\d{4})-Q([1-4])$/i);
    if (!mm) return null;
    return { year: Number(mm[1]), q: Number(mm[2]) };
  };
  const s = parse(startQ);
  const e = parse(endQ);
  if (!s || !e) return 12;
  return (e.year - s.year) * 12 + (e.q - s.q) * 3;
}

function buildHiringRecommendations(
  gapResult: GapComputationResult,
  demands: ProjectDemand[],
  config: ResourceGapEngineConfig,
): HiringRecommendation[] {
  const out: HiringRecommendation[] = [];
  let idCounter = 0;

  // Build lookup for demand start dates by project gap
  const demandLookup = new Map<string, ProjectDemand>();
  for (const d of demands) demandLookup.set(d.projectId, d);

  for (const gap of gapResult.gaps) {
    if (gap.severity === "low") continue; // AC-3: Critical and Moderate only per spec, but include logic for all severities optionally

    // Derive required proficiency from gap's max requirement approximated as 3+severity
    const minProf = (gap.seniority ? 3 : 3) as SkillProficiency;

    const targetTeam = gap.team ?? "engineering";
    const demandQ = gap.quarter;

    // Find matching demand to extract seniority and dates
    const matchingDemand = demands.find(
      (d) => d.team === gap.team || !gap.team,
    );
    const seniority: SeniorityBand =
      gap.seniority ?? matchingDemand?.requiredSeniority ?? "mid";
    const ttf = config.timeToFill.perSeniority[seniority] ?? 60;
    const urgency = computeUrgency(gap.severity, demandQ, ttf);

    const roleTitle = `${seniority.charAt(0).toUpperCase() + seniority.slice(1)} ${gap.skillId} Engineer`;
    const demandForGap = matchingDemand;
    const durationMonths = demandForGap
      ? quarterDiffMonths(
          demandForGap.demandStartQuarter as Quarter,
          demandForGap.demandEndQuarter as Quarter,
        )
      : 12;

    const isPotentiallyContract =
      durationMonths < config.contractorThresholdMonths;

    const costBandRaw =
      config.costBands.perSeniorityFTE[seniority] ?? {
        min: 90000,
        max: 130000,
        currency: "USD",
      };

    // Scale cost estimate by gapFTE
    const costBand = {
      min: Math.round(costBandRaw.min * gap.gapFTE),
      max: Math.round(costBandRaw.max * gap.gapFTE),
      currency: costBandRaw.currency,
    };

    out.push({
      id: `hire-${++idCounter}-${gap.skillId}-${gap.quarter}`,
      gap: {
        skillId: gap.skillId,
        quarter: gap.quarter,
        team: gap.team,
        location: gap.location,
        seniority: gap.seniority,
      },
      type: isPotentiallyContract ? "contract" : "hire",
      status: "open" as RecommendationStatus,
      roleTitle,
      requiredSkills: [{ skillId: gap.skillId, minProficiency: minProf }],
      seniority,
      targetTeam,
      demandStartQuarter: demandQ,
      demandStartDate: demandForGap?.demandStartQuarter,
      durationMonths,
      urgency,
      estimatedTimeToFillDays: ttf,
      isPotentiallyContract,
      contractorRationale: isPotentiallyContract
        ? `Demand duration ${durationMonths} months < threshold ${config.contractorThresholdMonths} months; contractor more cost-effective`
        : undefined,
      costBand,
      createdAt: new Date().toISOString(),
    });
  }

  // Ensure every Critical and Moderate gap has at least one hiring rec (AC-3)
  return out;
}

// FR-4 deployment
function buildDeploymentRecommendations(
  gaps: SkillGap[],
  employees: Employee[],
  config: ResourceGapEngineConfig,
): DeploymentRecommendation[] {
  const recs: DeploymentRecommendation[] = [];
  let idCounter = 0;

  // Pre-index employee total availability by team for secondary gap check
  const teamAvailability = new Map<string, number>();
  const teamEmployees = new Map<string, Employee[]>();

  for (const e of employees) {
    const avail = Math.max(0, Math.min(e.availabilityPct / 100, 1));
    teamAvailability.set(e.team, (teamAvailability.get(e.team) ?? 0) + avail);
    if (!teamEmployees.has(e.team)) teamEmployees.set(e.team, []);
    teamEmployees.get(e.team)!.push(e);
  }

  for (const gap of gaps) {
    // For each gap, find candidates
    const candidates: DeploymentCandidate[] = [];

    for (const emp of employees) {
      // Must have matching or adjacent skill
      const matchingSkill = emp.skills.find(
        (s) => s.skillId.toLowerCase() === gap.skillId.toLowerCase(),
      );
      if (!matchingSkill) continue;

      // Sufficient proficiency — at least level where weight > 0
      // Let's accept prof delta >= -2 (FR 5.1 near-match path is delta <=1 but deployment allows broader)
      const reqProf = 3 as SkillProficiency; // conservative
      const profDelta = (matchingSkill.proficiency as number) - reqProf;
      if (profDelta < -2) continue;

      const availFrac = Math.max(0, Math.min(emp.availabilityPct / 100, 1));
      if (availFrac < 0.1) continue; // needs available capacity

      // Skill match score: based on proficiency weighting + adjacency
      const isExact = matchingSkill.skillId.toLowerCase() === gap.skillId.toLowerCase();
      const matchScoreBase = isExact ? 1 : 0.7;
      const profRatio = profDelta >= 0 ? 1 : Math.max(0, 0.5 + profDelta * 0.25);
      const skillMatchScore = Math.max(0, Math.min(1, matchScoreBase * profRatio));

      // Utilization rate: 1 - availability
      const utilizationRate = Math.max(0, Math.min(1, 1 - availFrac));

      // Transition lead
      let transitionLeadTimeDays = 14;
      if (emp.currentProjectEndDate) {
        const endMs = Date.parse(emp.currentProjectEndDate);
        if (!Number.isNaN(endMs)) {
          const diffDays = Math.ceil((endMs - Date.now()) / (1000 * 60 * 60 * 24));
          transitionLeadTimeDays = Math.max(0, diffDays);
        }
      }

      // Secondary gap risk: would removing this employee reduce source team coverage below 75%?
      const sourceTeamAvail = teamAvailability.get(emp.team) ?? 0;
      const postRedeploy = sourceTeamAvail - availFrac;
      const teamSize = teamEmployees.get(emp.team)?.length ?? 1;
      const sourceTeamCoverageThreshold = config.secondaryGapCoverageThreshold;
      // Simplistic coverage estimate: availability sum / team size approximates coverage
      const coverageAfter = teamSize > 0 ? postRedeploy / teamSize : 0;
      const secondaryGapRisk = coverageAfter < sourceTeamCoverageThreshold;
      const secondaryGapDetail = secondaryGapRisk
        ? `Moving ${emp.id} from ${emp.team} would reduce ${emp.team} coverage to ${Math.round(coverageAfter * 100)}% (below ${Math.round(sourceTeamCoverageThreshold * 100)}% threshold)`
        : undefined;

      candidates.push({
        employeeId: emp.id,
        employeeName: emp.name,
        currentRole: emp.currentRole,
        currentTeam: emp.team,
        currentProjectEndDate: emp.currentProjectEndDate,
        skillMatchScore,
        proficiencyDelta: profDelta,
        utilizationRate,
        transitionLeadTimeDays,
        rationale: isExact
          ? `Exact skill match ${matchingSkill.skillId} L${matchingSkill.proficiency} vs required L${reqProf}`
          : `Adjacent skill ${matchingSkill.skillId} L${matchingSkill.proficiency}`,
        managerContact: emp.managerContact,
        secondaryGapRisk,
        secondaryGapDetail,
      });
    }

    // Rank candidates FR-4.2: skill match score, proficiency delta, utilization rate, transition lead time
    candidates.sort((a, b) => {
      const s = b.skillMatchScore - a.skillMatchScore;
      if (Math.abs(s) > 0.001) return s;
      const pd = b.proficiencyDelta - a.proficiencyDelta;
      if (pd !== 0) return pd;
      const ur = a.utilizationRate - b.utilizationRate; // lower utilization preferred
      if (Math.abs(ur) > 0.001) return ur;
      return a.transitionLeadTimeDays - b.transitionLeadTimeDays;
    });

    if (candidates.length === 0) continue;

    const urgencyTier =
      gap.severity === "critical" ? "P1" : gap.severity === "moderate" ? "P2" : "P3";

    recs.push({
      id: `deploy-${++idCounter}-${gap.skillId}-${gap.quarter}`,
      gap: {
        skillId: gap.skillId,
        quarter: gap.quarter,
        team: gap.team,
        location: gap.location,
        seniority: gap.seniority,
      },
      type: "deploy",
      status: "open" as RecommendationStatus,
      urgency: urgencyTier as UrgencyTier,
      candidates: candidates.slice(0, 10),
      topCandidateId: candidates[0]?.employeeId,
      createdAt: new Date().toISOString(),
    });
  }

  return recs;
}

// FR-5 upskill
function buildUpskillRecommendations(
  gaps: SkillGap[],
  employees: Employee[],
): UpskillRecommendation[] {
  const out: UpskillRecommendation[] = [];
  let idCounter = 0;

  for (const gap of gaps) {
    for (const emp of employees) {
      const matchingSkill = emp.skills.find(
        (s) => s.skillId.toLowerCase() === gap.skillId.toLowerCase(),
      );
      if (!matchingSkill) continue;

      const currentProf = matchingSkill.proficiency as SkillProficiency;
      const targetProf = 4 as SkillProficiency; // assume target L4 for gap closure
      const delta = (targetProf as number) - (currentProf as number);

      // Near-match: proficiency delta ≤1 level (FR-5.1)
      if (delta <= 0 || delta > 1) continue;

      // Ramp time heuristics
      const rampMap: Record<number, number> = { 1: 45 };
      const rampDays = rampMap[delta] ?? 60;

      const category: LearningCategory =
        delta === 1 ? "internal_training" : "mentorship";

      const projectedReadiness = new Date(Date.now() + rampDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      out.push({
        id: `upskill-${++idCounter}-${gap.skillId}-${emp.id}`,
        gap: {
          skillId: gap.skillId,
          quarter: gap.quarter,
          team: gap.team,
          location: gap.location,
          seniority: gap.seniority,
        },
        type: "upskill",
        status: "open" as RecommendationStatus,
        employeeId: emp.id,
        employeeName: emp.name,
        currentTeam: emp.team,
        currentProficiency: currentProf,
        targetProficiency: targetProf,
        category,
        estimatedRampTimeDays: rampDays,
        projectedReadinessDate: projectedReadiness,
        rationale: `Near-match: ${emp.id} has ${matchingSkill.skillId} L${currentProf} vs required L${targetProf}, delta ${delta} → upskill viable`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return out;
}

function validateEmployees(raw: unknown): Employee[] {
  if (!Array.isArray(raw)) throw new ToolInputError("employees must be an array");
  return raw as Employee[];
}

function validateDemands(raw: unknown): ProjectDemand[] {
  if (!Array.isArray(raw)) throw new ToolInputError("project_demands must be an array");
  return raw as ProjectDemand[];
}

export function createResourceGapTool(
  _api: BuilderForceAgentsPluginApi,
): AnyAgentTool {
  return {
    name: "resource_gap_analysis",
    label: "Resource Gap Analysis",
    description:
      "Run a structured resource gap analysis: computes supply vs demand deltas by skill per quarter with proficiency weighting, classifies severity, detects compounding gaps, and generates hiring, deployment and upskill recommendations with build-vs-buy analysis.",

    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        employees: {
          type: "array",
          description: "Employee inventory with skills and availability",
          items: { type: "object" },
        },
        project_demands: {
          type: "array",
          description: "Project demand forecast by skill and timeline",
          items: { type: "object" },
        },
        config_overrides: {
          type: "object",
          description: "Optional config overrides for time-to-fill, contractor threshold, etc.",
        },
        segmented: {
          type: "boolean",
          description: "If true, segment gaps by team/location/seniority (default true)",
        },
      },
      required: ["employees", "project_demands"],
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const employees = validateEmployees(params["employees"] ?? params["demands"]);
      // defensive: support both naming conventions
      const rawDemands =
        (params["project_demands"] as unknown) ??
        (params["project_demands" as string] as unknown) ??
        (params["demands"] as unknown) ??
        (params["projectRequirements"] as unknown);
      const demands = validateDemands(rawDemands);

      if (employees.length === 0)
        throw new ToolInputError("employees array must contain at least one employee");
      if (demands.length === 0)
        throw new ToolInputError("project_demands must contain at least one project");

      const segmented = (params["segmented"] as boolean | undefined) ?? true;

      let config: ResourceGapEngineConfig = DEFAULT_RESOURCE_GAP_CONFIG;
      const overrides = params["config_overrides"] as
        | Partial<ResourceGapEngineConfig>
        | undefined;
      if (overrides) {
        config = {
          ...config,
          ...overrides,
          proficiency: overrides.proficiency ?? config.proficiency,
          taxonomy: overrides.taxonomy ?? config.taxonomy,
          timeToFill: overrides.timeToFill ?? config.timeToFill,
          costBands: overrides.costBands ?? config.costBands,
          contractorThresholdMonths:
            overrides.contractorThresholdMonths ?? config.contractorThresholdMonths,
          secondaryGapCoverageThreshold:
            overrides.secondaryGapCoverageThreshold ??
            config.secondaryGapCoverageThreshold,
        };
      }

      const gapResult = computeGaps(employees, demands, { config, segmented });
      const hiringRecommendations = buildHiringRecommendations(gapResult, demands, config);
      const deploymentRecommendations = buildDeploymentRecommendations(
        gapResult.gaps,
        employees,
        config,
      );
      const upskillRecommendations = buildUpskillRecommendations(gapResult.gaps, employees);

      return jsonResult({
        gaps: gapResult.gaps,
        projectCoverage: gapResult.projectCoverage,
        unmappedSkills: gapResult.unmappedSkills,
        totalDemandFTE: gapResult.totalDemandFTE,
        totalWeightedSupplyFTE: gapResult.totalWeightedSupplyFTE,
        hiringRecommendations,
        deploymentRecommendations,
        upskillRecommendations,
        summary: {
          totalGaps: gapResult.gaps.length,
          criticalGaps: gapResult.gaps.filter((g) => g.severity === "critical").length,
          moderateGaps: gapResult.gaps.filter((g) => g.severity === "moderate").length,
          lowGaps: gapResult.gaps.filter((g) => g.severity === "low").length,
          compoundingGaps: gapResult.gaps.filter(
            (g) => (g.compoundingProjectCount ?? 0) >= 3,
          ).length,
          hiringRecs: hiringRecommendations.length,
          deploymentRecs: deploymentRecommendations.length,
          upskillRecs: upskillRecommendations.length,
        },
        computedAt: gapResult.computedAt,
      });
    },
  } as unknown as AnyAgentTool;
}
