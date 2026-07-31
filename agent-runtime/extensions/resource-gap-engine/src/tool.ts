/**
 * @file tool.ts
 * @module @builderforce/resource-gap-engine
 * @description Tool registration for Resource Gap Engine — FR-3 / FR-4 / FR-5.
 */

import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { ToolInputError, jsonResult } from "../../src/agents/tools/common.js";
import {
  DEFAULT_RESOURCE_GAP_CONFIG,
  type ResourceGapEngineConfig,
} from "./configuration.js";
import { computeGaps } from "./engine.js";
import type {
  DeploymentCandidate,
  DeploymentRecommendation,
  Employee,
  GapComputationResult,
  HiringRecommendation,
  ProjectDemand,
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

// ── Helpers ──────────────────────────────────────────────────────────

function resolveCostBand(config: ResourceGapEngineConfig) {
  return config.costBand ?? config.costBands ?? config.costRange ?? DEFAULT_RESOURCE_GAP_CONFIG.costBand;
}

function resolveTimeToFill(config: ResourceGapEngineConfig) {
  return config.timeToFill ?? DEFAULT_RESOURCE_GAP_CONFIG.timeToFill;
}

function resolveContractorThresholdMonths(config: ResourceGapEngineConfig): number {
  return (
    config.hireVsContractThresholdMonths ??
    config.contractorThresholdMonths ??
    DEFAULT_RESOURCE_GAP_CONFIG.hireVsContractThresholdMonths
  );
}

function resolveSecondaryGapThreshold(config: ResourceGapEngineConfig): number {
  return (
    config.secondaryGapRiskThreshold ??
    config.secondaryGapCoverageThreshold ??
    DEFAULT_RESOURCE_GAP_CONFIG.secondaryGapRiskThreshold
  );
}

function computeUrgency(
  severity: GapSeverity,
  demandStartQuarter: Quarter,
  timeToFillDays: number,
): UrgencyTier {
  const m = (demandStartQuarter as string).match(/^(\d{4})-Q([1-4])$/i);
  let daysUntilDemand = 9999;
  if (m) {
    const year = Number(m[1]);
    const q = Number(m[2]);
    const month = (q - 1) * 3;
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
  const parse = (q: string) => {
    const mm = q.match(/^(\d{4})-Q([1-4])$/i);
    if (!mm) return null;
    return { year: Number(mm[1]), q: Number(mm[2]) };
  };
  const s = parse(startQ as string);
  const e = parse(endQ as string);
  if (!s || !e) return 12;
  return (e.year - s.year) * 12 + (e.q - s.q) * 3;
}

// ── FR-3 Hiring recommendations ──────────────────────────────────────

function buildHiringRecommendations(
  gapResult: GapComputationResult,
  demands: ProjectDemand[],
  config: ResourceGapEngineConfig,
): HiringRecommendation[] {
  const out: HiringRecommendation[] = [];
  let idCounter = 0;

  const costBand = resolveCostBand(config);
  const ttfCfg = resolveTimeToFill(config);
  const contractorThresholdMonths = resolveContractorThresholdMonths(config);

  for (const gap of gapResult.gaps) {
    if (gap.severity === "low") continue;

    const matchingDemand = demands.find((d) => !gap.team || d.team === gap.team);
    const seniority: SeniorityBand = gap.seniority ?? matchingDemand?.requiredSeniority ?? "mid";
    const ttf = ttfCfg.perSeniority?.[seniority] ?? 60;
    const urgency = computeUrgency(gap.severity, gap.quarter, ttf);

    const roleTitle = `${seniority.charAt(0).toUpperCase() + seniority.slice(1)} ${gap.skillId} Engineer`;

    const demandForGap = matchingDemand;
    const durationMonths = demandForGap
      ? quarterDiffMonths(
          demandForGap.demandStartQuarter as Quarter,
          demandForGap.demandEndQuarter as Quarter,
        )
      : 12;

    const isPotentiallyContract = durationMonths < contractorThresholdMonths;

    const bandForSen = costBand.perSeniorityFTE?.[seniority];

    const minProfFromDemand =
      matchingDemand?.requiredSkills?.find(
        (rs) => rs.skillId.toLowerCase() === gap.skillId.toLowerCase(),
      )?.minProficiency ?? 3;

    out.push({
      id: `hire-${++idCounter}-${gap.skillId}-${gap.quarter}`,
      gap: {
        skillId: gap.skillId,
        quarter: gap.quarter,
        team: gap.team,
        location: gap.location,
        seniority: gap.seniority,
      },
      type: isPotentiallyContract ? ("contract" as const) : ("hire" as const),
      status: "open" as RecommendationStatus,
      roleTitle,
      requiredSkills: [
        {
          skillId: gap.skillId,
          minProficiency: minProfFromDemand as SkillProficiency,
        },
      ],
      seniority,
      targetTeam: gap.team ?? matchingDemand?.team ?? "engineering",
      demandStartQuarter: gap.quarter,
      demandStartDate: demandForGap?.demandStartDate,
      durationMonths,
      urgency: urgency as UrgencyTier,
      estimatedTimeToFillDays: ttf,
      isPotentiallyContract,
      contractorRationale: isPotentiallyContract
        ? `Demand duration ${durationMonths} months < threshold ${contractorThresholdMonths} months; contractor recommended`
        : undefined,
      costBand: bandForSen ?? undefined,
      createdAt: new Date().toISOString(),
    });
  }

  // P1 first
  const rank: Record<UrgencyTier, number> = { P1: 0, P2: 1, P3: 2 };
  out.sort((a, b) => {
    const r = rank[a.urgency] - rank[b.urgency];
    if (r !== 0) return r;
    return b.gap.skillId.localeCompare(a.gap.skillId);
  });

  return out;
}

// ── FR-4 Deployment recommendations ──────────────────────────────────

function buildDeploymentRecommendations(
  gaps: SkillGap[],
  employees: Employee[],
  config: ResourceGapEngineConfig,
): DeploymentRecommendation[] {
  const recs: DeploymentRecommendation[] = [];

  const teamAvailability = new Map<string, number>();
  const teamEmployees = new Map<string, Employee[]>();
  for (const emp of employees) {
    const avail = Math.max(0, Math.min(emp.availabilityPct / 100, 1));
    teamAvailability.set(emp.team, (teamAvailability.get(emp.team) ?? 0) + avail);
    const arr = teamEmployees.get(emp.team) ?? [];
    arr.push(emp);
    teamEmployees.set(emp.team, arr);
  }

  const secondaryGapCoverageThreshold = resolveSecondaryGapThreshold(config);

  for (const gap of gaps) {
    if (gap.severity === "low") continue;

    const candidates: DeploymentCandidate[] = [];

    for (const emp of employees) {
      const matchingSkill = emp.skills.find(
        (s) => s.skillId.toLowerCase() === gap.skillId.toLowerCase(),
      );
      if (!matchingSkill) continue;

      const reqProf = 3 as SkillProficiency;
      const profDelta = (matchingSkill.proficiency as number) - (reqProf as number);
      if (profDelta < -2) continue;

      const availFrac = Math.max(0, Math.min(emp.availabilityPct / 100, 1));
      if (availFrac < 0.1) continue;

      const isExact = matchingSkill.skillId.toLowerCase() === gap.skillId.toLowerCase();
      const matchScoreBase = isExact ? 1 : 0.7;
      const profRatio = profDelta >= 0 ? 1 : Math.max(0, 0.5 + profDelta * 0.25);
      const skillMatchScore = Math.max(0, Math.min(1, matchScoreBase * profRatio));

      const utilizationRate = Math.max(0, Math.min(1, 1 - availFrac));

      let transitionLeadTimeDays = 14;
      if (emp.currentProjectEndDate) {
        const endMs = Date.parse(emp.currentProjectEndDate);
        if (!Number.isNaN(endMs)) {
          const diffDays = Math.ceil((endMs - Date.now()) / (1000 * 60 * 60 * 24));
          transitionLeadTimeDays = Math.max(0, diffDays);
        }
      }

      const sourceTeamAvail = teamAvailability.get(emp.team) ?? 0;
      const postRedeploy = sourceTeamAvail - availFrac;
      const teamSize = teamEmployees.get(emp.team)?.length ?? 1;
      const coverageAfter = teamSize > 0 ? postRedeploy / teamSize : 0;
      const secondaryGapRisk = coverageAfter < secondaryGapCoverageThreshold;
      const secondaryGapDetail = secondaryGapRisk
        ? `Moving ${emp.id} from ${emp.team} would reduce ${emp.team} coverage to ${Math.round(coverageAfter * 100)}% (below ${Math.round(secondaryGapCoverageThreshold * 100)}% threshold)`
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

    candidates.sort((a, b) => {
      const s = b.skillMatchScore - a.skillMatchScore;
      if (Math.abs(s) > 0.001) return s;
      const pd = b.proficiencyDelta - a.proficiencyDelta;
      if (pd !== 0) return pd;
      const ur = a.utilizationRate - b.utilizationRate;
      if (Math.abs(ur) > 0.001) return ur;
      return a.transitionLeadTimeDays - b.transitionLeadTimeDays;
    });

    if (candidates.length === 0) continue;

    const urgencyTier: UrgencyTier =
      gap.severity === "critical" ? "P1" : gap.severity === "moderate" ? "P2" : "P3";

    recs.push({
      id: `deploy-${gap.skillId}-${gap.quarter}-${gap.team ?? "all"}`,
      gap: {
        skillId: gap.skillId,
        quarter: gap.quarter,
        team: gap.team,
        location: gap.location,
        seniority: gap.seniority,
      },
      type: "deploy",
      status: "open" as RecommendationStatus,
      urgency: urgencyTier,
      candidates: candidates.slice(0, 10),
      topCandidateId: candidates[0]?.employeeId,
      createdAt: new Date().toISOString(),
    });
  }

  return recs;
}

// ── FR-5 Upskill ─────────────────────────────────────────────────────

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
      const targetProf = 4 as SkillProficiency;
      const delta = (targetProf as number) - (currentProf as number);

      if (delta <= 0 || delta > 1) continue;

      const rampDays = 45;
      const category: LearningCategory = "internal_training";

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

// ── Tool factory ─────────────────────────────────────────────────────

function validateEmployees(raw: unknown): Employee[] {
  if (!Array.isArray(raw)) throw new ToolInputError("employees must be an array");
  return raw as Employee[];
}

function validateDemands(raw: unknown): ProjectDemand[] {
  if (!Array.isArray(raw)) throw new ToolInputError("project_demands must be an array");
  return raw as ProjectDemand[];
}

export function createResourceGapTool(api: BuilderForceAgentsPluginApi): AnyAgentTool {
  void api; // future use (logger, etc.)
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
      const rawDemands =
        (params["project_demands"] as unknown) ??
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
          compoundingGaps: gapResult.gaps.filter((g) => (g.compoundingProjectCount ?? 0) >= 3)
            .length,
          hiringRecs: hiringRecommendations.length,
          deploymentRecs: deploymentRecommendations.length,
          upskillRecs: upskillRecommendations.length,
        },
        computedAt: gapResult.computedAt,
      });
    },
  } as unknown as AnyAgentTool;
}
