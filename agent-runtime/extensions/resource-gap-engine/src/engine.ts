/**
 * Resource Gap Engine — FR-2 gap computation.
 *
 * FR-2.1  supply vs. demand delta per skill per quarter
 * FR-2.2  proficiency weighting (supply L3 vs required L5 counts as partial)
 * FR-2.3  segment by skill, seniority, team, location
 * FR-2.4  severity classification
 * FR-2.5  compounding detection
 */

import {
  DEFAULT_RESOURCE_GAP_CONFIG,
  getEffectiveRatio,
  type Proficiency,
  type ResourceGapEngineConfig,
} from "./configuration.js";
import type {
  Employee,
  GapComputationResult,
  ProficiencyWeightEntry,
  ProjectCoverage,
  ProjectDemand,
  Quarter,
  SkillGap,
  UnmappedSkill,
  GapSeverity,
} from "./types.js";

// ── Quarter helpers ──────────────────────────────────────────────────

function normalizeQuarter(q: string): Quarter {
  const s = (q ?? "").trim();
  if (!s) return "2026-Q1" as Quarter;
  // canonicalize e.g. 2026Q2, 2026 Q2, 2026-Q2, 2026q2 → 2026-Q2
  const m = s.match(/^(\d{4})\s*-?\s*Q?\s*([1-4])$/i) ?? s.match(/^(\d{4})\s*[Qq]?\s*([1-4])$/);
  if (m) return `${m[1]}-Q${m[2]}` as Quarter;
  const m2 = s.match(/(20\d{2}).*?([1-4])/);
  if (m2) return `${m2[1]}-Q${m2[2]}` as Quarter;
  return s as Quarter;
}

function parseQuarterToSortKey(q: Quarter): number {
  const m = (q as string).match(/(\d{4})-Q([1-4])/);
  if (!m) return 99999;
  const year = Number.parseInt(m[1], 10);
  const qNum = Number.parseInt(m[2], 10);
  return year * 10 + qNum;
}

function expandQuarterRange(startQ: Quarter, endQ: Quarter): Quarter[] {
  const startKey = parseQuarterToSortKey(startQ);
  const endKey = parseQuarterToSortKey(endQ);
  if (startKey > endKey) return [startQ];
  const startM = (startQ as string).match(/(\d{4})-Q([1-4])/);
  const endM = (endQ as string).match(/(\d{4})-Q([1-4])/);
  if (!startM || !endM) return [startQ];
  const startYear = Number.parseInt(startM[1], 10);
  const startQn = Number.parseInt(startM[2], 10);
  const endYear = Number.parseInt(endM[1], 10);
  const endQn = Number.parseInt(endM[2], 10);

  const result: Quarter[] = [];
  let y = startYear;
  let qn = startQn;
  while (y < endYear || (y === endYear && qn <= endQn)) {
    result.push(`${y}-Q${qn}` as Quarter);
    qn++;
    if (qn > 4) {
      qn = 1;
      y++;
    }
  }
  return result.length ? result : [startQ];
}

function classifySeverity(uncoveredPct: number): GapSeverity {
  if (uncoveredPct > 0.5) return "critical";
  if (uncoveredPct >= 0.25) return "moderate";
  return "low";
}

// ── Demand bucketing ─────────────────────────────────────────────────

interface DemandBucketKey {
  skillId: string;
  quarter: Quarter;
  team?: string;
  location?: string;
  seniority?: string;
}

function bucketKeyToString(k: DemandBucketKey): string {
  return `${k.skillId}|${k.quarter}|${k.team ?? ""}|${k.location ?? ""}|${k.seniority ?? ""}`;
}

interface DemandAccum {
  key: DemandBucketKey;
  demandFTE: number;
  maxRequiredProf: number;
  projectIds: Set<string>;
}

interface SupplyAccum {
  skillId: string;
  availFTEs: { proficiency: Proficiency; fte: number }[];
}

export interface EngineOptions {
  config?: ResourceGapEngineConfig;
  /** Flatten segmentation? When true, compute by skill+quarter including team/location/seniority in grouping. */
  segmented?: boolean;
}

function resolveProficiencyConfig(config: ResourceGapEngineConfig) {
  return config.proficiency ?? { entries: [] as ProficiencyWeightEntry[] };
}

export function computeGaps(
  employees: Employee[],
  demands: ProjectDemand[],
  opts: EngineOptions = {},
): GapComputationResult {
  const config = opts.config ?? DEFAULT_RESOURCE_GAP_CONFIG;
  const segmented = opts.segmented ?? true;

  // ── Build demand buckets ─────────────────────────────────────────
  const demandBuckets = new Map<string, DemandAccum>();
  let totalDemandFTE = 0;

  for (const d of demands) {
    const startQ = normalizeQuarter(d.demandStartQuarter);
    const endQ = normalizeQuarter(d.demandEndQuarter);
    const quarters = expandQuarterRange(startQ, endQ);

    for (const req of d.requiredSkills) {
      if (!req.skillId) continue;
      const fte = Number(req.fteDemand);
      if (!Number.isFinite(fte) || fte <= 0) continue;

      for (const q of quarters) {
        const key: DemandBucketKey = segmented
          ? {
              skillId: req.skillId,
              quarter: q,
              team: d.team,
              location: d.location,
              seniority: d.requiredSeniority,
            }
          : {
              skillId: req.skillId,
              quarter: q,
            };

        const kStr = bucketKeyToString(key);
        const existing = demandBuckets.get(kStr);
        if (existing) {
          existing.demandFTE += fte;
          existing.maxRequiredProf = Math.max(
            existing.maxRequiredProf,
            req.minProficiency as number,
          );
          existing.projectIds.add(d.projectId);
        } else {
          demandBuckets.set(kStr, {
            key,
            demandFTE: fte,
            maxRequiredProf: req.minProficiency as number,
            projectIds: new Set([d.projectId]),
          });
        }
        // Distributed evenly across quarters; count fraction per quarter
        totalDemandFTE += fte / quarters.length;
      }
    }
  }

  // ── Build supply index ───────────────────────────────────────────
  const supplyBySkill = new Map<string, SupplyAccum>();

  for (const emp of employees) {
    const availFrac = Math.max(0, Math.min(emp.availabilityPct / 100, 1));
    if (availFrac <= 0) continue;

    for (const s of emp.skills) {
      if (!s.skillId) continue;
      const key = s.skillId;
      let acc = supplyBySkill.get(key);
      if (!acc) {
        acc = { skillId: key, availFTEs: [] };
        supplyBySkill.set(key, acc);
      }
      acc.availFTEs.push({
        proficiency: s.proficiency as Proficiency,
        fte: availFrac,
      });
    }
  }

  // ── Compute gaps per demand bucket ───────────────────────────────
  const gaps: SkillGap[] = [];
  let totalWeightedSupply = 0;
  const profConfig = resolveProficiencyConfig(config);

  for (const bucket of demandBuckets.values()) {
    const skillSupply = supplyBySkill.get(bucket.key.skillId);
    const rawSupplyFTE = skillSupply
      ? skillSupply.availFTEs.reduce((sum, a) => sum + a.fte, 0)
      : 0;

    const requiredLevel = (bucket.maxRequiredProf || 3) as Proficiency;
    let weightedSupplyFTE = 0;

    if (skillSupply) {
      for (const avail of skillSupply.availFTEs) {
        const ratio = getEffectiveRatio(profConfig, avail.proficiency, requiredLevel);
        weightedSupplyFTE += avail.fte * ratio;
      }
    }

    totalWeightedSupply += weightedSupplyFTE;

    const gapFTE = Math.max(0, bucket.demandFTE - weightedSupplyFTE);
    const demandFTE = bucket.demandFTE;
    const uncoveredPct = demandFTE > 0 ? gapFTE / demandFTE : 0;
    const severity = classifySeverity(uncoveredPct);

    const gap: SkillGap = {
      skillId: bucket.key.skillId,
      quarter: bucket.key.quarter,
      demandFTE,
      weightedSupplyFTE,
      rawSupplyFTE,
      gapFTE,
      uncoveredPct,
      severity,
      team: bucket.key.team,
      location: bucket.key.location,
      seniority: bucket.key.seniority as SkillGap["seniority"],
      compoundingProjectIds:
        bucket.projectIds.size >= 3 ? Array.from(bucket.projectIds) : undefined,
      compoundingProjectCount: bucket.projectIds.size >= 3 ? bucket.projectIds.size : undefined,
    };
    gaps.push(gap);
  }

  // Sort by severity desc, gapFTE desc, quarter asc
  const severityRank: Record<GapSeverity, number> = {
    critical: 0,
    moderate: 1,
    low: 2,
  };
  gaps.sort((a, b) => {
    const sr = severityRank[a.severity] - severityRank[b.severity];
    if (sr !== 0) return sr;
    const g = b.gapFTE - a.gapFTE;
    if (g !== 0) return g;
    return parseQuarterToSortKey(a.quarter) - parseQuarterToSortKey(b.quarter);
  });

  // Project coverage (FR-6.2)
  const projectCoverage = computeProjectCoverage(demands, supplyBySkill, config);

  const unmappedSkills: UnmappedSkill[] = [];

  return {
    gaps,
    projectCoverage,
    unmappedSkills,
    totalDemandFTE,
    totalWeightedSupplyFTE: totalWeightedSupply,
    computedAt: new Date().toISOString(),
  };
}

function computeProjectCoverage(
  demands: ProjectDemand[],
  supplyBySkill: Map<string, SupplyAccum>,
  config: ResourceGapEngineConfig,
): ProjectCoverage[] {
  const out: ProjectCoverage[] = [];
  const profConfig = resolveProficiencyConfig(config);

  for (const d of demands) {
    let totalDemand = 0;
    let totalCovered = 0;

    const startQ = normalizeQuarter(d.demandStartQuarter);
    const endQ = normalizeQuarter(d.demandEndQuarter);
    const quarters = expandQuarterRange(startQ, endQ);
    const quarterCount = quarters.length || 1;

    for (const req of d.requiredSkills) {
      const fte = Number(req.fteDemand);
      if (!Number.isFinite(fte) || fte <= 0) continue;
      const spanDemand = fte * quarterCount;
      totalDemand += spanDemand;

      const skillSupply = supplyBySkill.get(req.skillId);
      if (!skillSupply) continue;

      const requiredLevel = (req.minProficiency || 3) as Proficiency;
      let weighted = 0;
      for (const av of skillSupply.availFTEs) {
        const ratio = getEffectiveRatio(profConfig, av.proficiency, requiredLevel);
        weighted += av.fte * ratio;
      }

      totalCovered += Math.min(weighted * quarterCount, spanDemand);
    }

    const coverageScore = totalDemand > 0 ? totalCovered / totalDemand : 1;
    out.push({
      projectId: d.projectId,
      demandFTE: totalDemand,
      coveredFTE: totalCovered,
      coverageScore: Math.max(0, Math.min(1, coverageScore)),
    });
  }

  return out;
}

export { normalizeQuarter, expandQuarterRange, classifySeverity, bucketKeyToString };
