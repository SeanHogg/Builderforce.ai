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
  SeniorityBand,
} from "./types.js";

// ── Quarter helpers ──────────────────────────────────────────────────

function normalizeQuarter(q: string): Quarter {
  const s = (q ?? "").trim();
  if (!s) return "2026-Q1" as Quarter;
  // canonical YYYY-Qn → already fine
  const canon = s.match(/^((?:19|20)\d{2})-Q([1-4])$/i);
  if (canon) return `${canon[1]}-Q${canon[2]}` as Quarter;
  // 2026Q2 → 2026-Q2
  const compact = s.match(/^((?:19|20)\d{2})Q([1-4])$/i);
  if (compact) return `${compact[1]}-Q${compact[2]}` as Quarter;
  // 2026-Q2 already caught; ISO date → quarter
  const dt = Date.parse(s);
  if (!Number.isNaN(dt)) {
    const d = new Date(dt);
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${quarter}` as Quarter;
  }
  return s as Quarter;
}

function parseQuarterToSortKey(q: Quarter): number {
  const m = q.match(/^(\d{4})-Q([1-4])$/i);
  if (m) return Number(m[1]) * 4 + Number(m[2]);
  return 0;
}

/** Expand an inclusive start..end quarter range into an ordered list. */
function expandQuarterRange(startQ: Quarter, endQ: Quarter): Quarter[] {
  const sKey = parseQuarterToSortKey(startQ);
  const eKey = parseQuarterToSortKey(endQ);
  if (sKey === 0 || eKey === 0 || sKey > eKey) {
    // fallback: treat as single quarter if parse failed or inverted
    return [startQ];
  }
  const out: Quarter[] = [];
  let year = Number(startQ.slice(0, 4));
  let q = Number(startQ.slice(6));
  const endYear = Number(endQ.slice(0, 4));
  const endQNum = Number(endQ.slice(6));
  while (year < endYear || (year === endYear && q <= endQNum)) {
    out.push(`${year}-Q${q}` as Quarter);
    q++;
    if (q > 4) {
      q = 1;
      year++;
    }
  }
  return out;
}

// ── Severity ─────────────────────────────────────────────────────────

function classifySeverity(uncoveredPct: number): GapSeverity {
  if (uncoveredPct > 0.5) return "critical";
  if (uncoveredPct >= 0.25) return "moderate";
  return "low";
}

// ── Core engine ──────────────────────────────────────────────────────

interface DemandBucketKey {
  skillId: string;
  quarter: Quarter;
  team?: string;
  location?: string;
  seniority?: SeniorityBand;
}

function bucketKeyToString(k: DemandBucketKey): string {
  return `${k.skillId}|${k.quarter}|${k.team ?? ""}|${k.location ?? ""}|${k.seniority ?? ""}`;
}

interface DemandAccum {
  key: DemandBucketKey;
  demandFTE: number;
  /** Key is `${minProficiency}` — max requirement level touched */
  maxRequiredProf: number;
  projectIds: Set<string>;
  /** Weighted demand by required proficiency — not needed for scalar gap but used for coverage tracking */
}

interface SupplyAccum {
  skillId: string;
  availFTEs: { proficiency: Proficiency; fte: number }[];
}

export interface EngineOptions {
  config?: ResourceGapEngineConfig;
  /** Flatten segmentation? When true, compute only by skill+quarter ignoring team/location/seniority in gap grouping. */
  segmented?: boolean;
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
  // track raw unmapped — caller should also pass ingest-level unmappedSkills
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
        totalDemandFTE += fte / quarters.length;
      }
    }
  }

  // ── Build supply index: skillId → availabilities ─────────────────
  // We use availabilityPct to scale FTE per employee per skill.
  // Employee's available FTE for a skill = availabilityPct/100.
  // Weighted supply per bucket then multiplies by proficiency weight vs max required proficiency in that bucket.
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

  for (const bucket of demandBuckets.values()) {
    const skillSupply = supplyBySkill.get(bucket.key.skillId);
    const rawSupplyFTE = skillSupply
      ? skillSupply.availFTEs.reduce((sum, a) => sum + a.fte, 0)
      : 0;

    const requiredLevel = (bucket.maxRequiredProf || 3) as Proficiency;
    let weightedSupplyFTE = 0;

    if (skillSupply) {
      for (const avail of skillSupply.availFTEs) {
        const ratio = getEffectiveRatio(
          { entries: config.proficiency.entries as ProficiencyWeightEntry[] },
          avail.proficiency,
          requiredLevel,
        );
        weightedSupplyFTE += avail.fte * ratio;
      }
    }

    totalWeightedSupply += weightedSupplyFTE;

    const gapFTE = bucket.key.quarter
      ? Math.max(0, bucket.demandFTE - weightedSupplyFTE)
      : 0;
    const demandFTE = bucket.demandFTE;
    const uncoveredPct = demandFTE > 0 ? gapFTE / demandFTE : 0;
    const severity = classifySeverity(uncoveredPct);

    // Record only when gap exists (or we want full inventory — PRD says produce gaps for coverage view too)
    // We record all buckets — dashboard shows severity-colored heatmap even when covered.
    // To satisfy AC-3 (hiring recs for every Critical/Moderate) we must at least emit uncovered gaps; emitting covered ones too is safe.
    const gap: SkillGap = {
      skillId: bucket.key.skillId,
      quarter: bucket.key.quarter,
      demandFTE: bucket.key.quarter ? bucket.demandFTE : demandFTE,
      weightedSupplyFTE,
      rawSupplyFTE,
      gapFTE,
      uncoveredPct,
      severity,
      team: bucket.key.team,
      location: bucket.key.location,
      seniority: bucket.key.seniority,
      compoundingProjectIds:
        bucket.projectIds.size >= 3 ? Array.from(bucket.projectIds) : undefined,
      compoundingProjectCount: bucket.projectIds.size >= 3 ? bucket.projectIds.size : undefined,
    };
    gaps.push(gap);
  }

  // Sort gaps by severity desc then gapFTE desc, then quarter asc
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

  // ── Project coverage (FR-6.2) ────────────────────────────────────
  // For each project, fraction of demanded FTE covered by our overall weighted supply model.
  // Simpler approximation: per-project = per-skill coverage weighted by FTE.
  const projectCoverage = computeProjectCoverage(demands, supplyBySkill, config);

  // Collect unmapped placeholder — detailed taxonomy flagging is handled in ingest layer
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

  for (const d of demands) {
    let totalDemand = 0;
    let totalCovered = 0;

    // Consider entire demand window as one bucket for coverage: sum quarters from this demand
    const startQ = normalizeQuarter(d.demandStartQuarter);
    const endQ = normalizeQuarter(d.demandEndQuarter);
    const quarters = expandQuarterRange(startQ, endQ);
    const quarterCount = quarters.length || 1;

    for (const req of d.requiredSkills) {
      const fte = Number(req.fteDemand);
      if (!Number.isFinite(fte) || fte <= 0) continue;
      // Demand per quarter * quarterCount = full demand across window — report as full-span total for coverage
      const spanDemand = fte * quarterCount;
      totalDemand += spanDemand;

      const skillSupply = supplyBySkill.get(req.skillId);
      if (!skillSupply) continue;

      const requiredLevel = (req.minProficiency || 3) as Proficiency;
      let weighted = 0;
      for (const av of skillSupply.availFTEs) {
        const ratio = getEffectiveRatio(
          { entries: config.proficiency.entries as ProficiencyWeightEntry[] },
          av.proficiency,
          requiredLevel,
        );
        weighted += av.fte * ratio;
      }

      // Weighted supply is not per-project-exclusive in this model (shared pool)
      // so coverage caps at demand for this project per skill per window.
      // Supply sharing is approximated: each project gets proportional share of available.
      // Simpler conservative approximation: covered = min(weighted, spanDemand)
      // Shared-pool double counting is intentionally optimistic; server-side dashboard
      // can apply proportional allocation. For AC coverage count this matches spec.
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
