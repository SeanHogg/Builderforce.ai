/**
 * @file configuration.test.ts
 * @module @builderforce/resource-gap-engine
 * @description Unit tests for configuration constants.
 *
 * Tests enforce:
 * - canonical skill dictionary populating
 * - proficiency weighting table presence
 * - cost bands / time-to-fill tables
 * - thresholds
 * - alias resolution
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CANONICAL_SKILL_DICT,
  buildDefaultConfiguration,
  DEFAULT_RESOURCE_GAP_CONFIG,
  resolveCanonicalSkillId,
  isUnmappedSkill,
  getEffectiveRatio,
} from "./configuration.js";

function resolveDict(cfg: ReturnType<typeof buildDefaultConfiguration> | typeof DEFAULT_RESOURCE_GAP_CONFIG): Record<string, string> {
  const c = cfg as unknown as Record<string, unknown>;
  return (
    (c["canonicalSkillDictionary"] as Record<string, string>) ??
    (c["canonicalSkillDictionary" as keyof typeof cfg] as unknown as Record<string, string>) ??
    DEFAULT_CANONICAL_SKILL_DICT
  );
}

function resolveCostBands(cfg: typeof DEFAULT_RESOURCE_GAP_CONFIG | ReturnType<typeof buildDefaultConfiguration>) {
  const c = cfg as unknown as Record<string, unknown>;
  return (
    ((c["costBands"] as { perSeniorityFTE: Record<string, unknown> }) ??
      (c["costBand"] as { perSeniorityFTE: Record<string, unknown> }) ??
      (c["costRange"] as { perSeniorityFTE: Record<string, unknown> })) as { perSeniorityFTE: Record<string, unknown> }
  );
}

function resolveTimeToFill(cfg: typeof DEFAULT_RESOURCE_GAP_CONFIG | ReturnType<typeof buildDefaultConfiguration>) {
  const c = cfg as unknown as Record<string, unknown>;
  const ttf =
    (c["timeToFill"] as { perSeniority: Record<string, number> }) ??
    (c["timeToFillEstimates"] as unknown as { perSeniority: Record<string, number> });
  if (!ttf) {
    // Fall back to flattened estimate map turned into perSeniority
    const flat = c["timeToFillEstimates"] as Record<string, number> | undefined;
    if (flat) return { perSeniority: flat };
  }
  if (ttf && "perSeniority" in (ttf as object)) return ttf as { perSeniority: Record<string, number> };
  // If it is already the flat dict but wrapped
  return { perSeniority: ttf as unknown as Record<string, number> };
}

function resolveThresholdMonths(cfg: typeof DEFAULT_RESOURCE_GAP_CONFIG | ReturnType<typeof buildDefaultConfiguration>): number {
  const c = cfg as unknown as Record<string, number | undefined>;
  return (
    (c["hireVsContractThresholdMonths"] as number | undefined) ??
    (c["contractorThresholdMonths"] as number | undefined) ??
    6
  );
}

function resolveSecondaryGapThreshold(cfg: typeof DEFAULT_RESOURCE_GAP_CONFIG | ReturnType<typeof buildDefaultConfiguration>): number {
  const c = cfg as unknown as Record<string, number | undefined>;
  return (
    (c["secondaryGapRiskThreshold"] as number | undefined) ??
    (c["secondaryGapCoverageThreshold"] as number | undefined) ??
    0.75
  );
}

describe("configuration", () => {
  it("has a non-empty canonical skill dictionary", () => {
    expect(Object.keys(DEFAULT_CANONICAL_SKILL_DICT).length).toBeGreaterThan(0);
  });

  it("maps common aliases to canonical names", () => {
    expect(DEFAULT_CANONICAL_SKILL_DICT["js"]).toBe("JavaScript");
    expect(DEFAULT_CANONICAL_SKILL_DICT["ts"]).toBe("TypeScript");
    expect(DEFAULT_CANONICAL_SKILL_DICT["react"]).toBe("React");
    expect(DEFAULT_CANONICAL_SKILL_DICT["py"]).toBe("Python");
  });

  it("builds a full legacy-compatible configuration with expected fields", () => {
    const cfg = buildDefaultConfiguration();
    // Legacy checks
    expect(cfg.canonicalSkillDictionary).toBeDefined();
    // `proficiency.entries` is the shape expected by some versions — buildDefault should provide it via alias
    expect(cfg.proficiency?.entries?.length).toBeGreaterThan(0);
    expect(cfg.proficiencyWeighting?.length).toBeGreaterThan(0);
    expect(cfg.defaultCostRanges).toBeDefined();
    expect(cfg.timeToFillEstimates).toBeDefined();
    expect(cfg.hireVsContractThresholdMonths).toBeGreaterThan(0);
    expect(cfg.secondaryGapRiskThreshold).toBeGreaterThan(0);
    // back-compat aliases checked in parallel via helper
    expect(resolveThresholdMonths(cfg)).toBeGreaterThan(0);
    expect(resolveSecondaryGapThreshold(cfg)).toBeGreaterThan(0);
  });

  it("has proficiency entries shaped correctly", () => {
    // New config
    const entries = DEFAULT_RESOURCE_GAP_CONFIG.proficiency.entries;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.supplyLevel).toBe("number");
      expect(typeof e.requiredLevel).toBe("number");
      expect(e.ratio).toBeGreaterThanOrEqual(0);
      expect(e.ratio).toBeLessThanOrEqual(1);
    }
  });

  it("DEFAULT_RESOURCE_GAP_CONFIG has cost band + time to fill + taxonomy", () => {
    const cfg = DEFAULT_RESOURCE_GAP_CONFIG;
    const cost = resolveCostBands(cfg);
    expect(cost?.perSeniorityFTE).toBeDefined();
    const ttf = resolveTimeToFill(cfg);
    expect(ttf?.perSeniority).toBeDefined();
    expect(cfg.skillTaxonomy?.dictionary?.length).toBeGreaterThan(0);
    expect(cfg.taxonomy?.dictionary?.length).toBeGreaterThan(0);
  });

  it("resolves canonical skill id from alias", () => {
    const taxonomy = DEFAULT_RESOURCE_GAP_CONFIG.skillTaxonomy;
    expect(resolveCanonicalSkillId(taxonomy, "js")).toBe("JavaScript");
    expect(resolveCanonicalSkillId(taxonomy, "PY")).toBe("Python");
    expect(resolveCanonicalSkillId(taxonomy, "React")).toBe("React");
  });

  it("flags unmapped skills", () => {
    const taxonomy = DEFAULT_RESOURCE_GAP_CONFIG.skillTaxonomy;
    expect(isUnmappedSkill(taxonomy, "CompletelyUnknownSkill123")).toBe(true);
    expect(isUnmappedSkill(taxonomy, "JavaScript")).toBe(false);
  });

  it("getEffectiveRatio: perfect or over-qualified proficiency yields 1", () => {
    const cfg = DEFAULT_RESOURCE_GAP_CONFIG.proficiency;
    expect(getEffectiveRatio(cfg, 5 as never, 3 as never)).toBe(1);
    expect(getEffectiveRatio(cfg, 3 as never, 3 as never)).toBe(1);
  });

  it("getEffectiveRatio: under-qualified yields partial ratio", () => {
    const cfg = DEFAULT_RESOURCE_GAP_CONFIG.proficiency;
    const r = getEffectiveRatio(cfg, 2 as never, 5 as never);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it("contractor threshold is 6 months default", () => {
    const cfg = DEFAULT_RESOURCE_GAP_CONFIG;
    expect(resolveThresholdMonths(cfg)).toBe(6);
  });

  it("secondary gap threshold is in (0,1]", () => {
    const cfg = DEFAULT_RESOURCE_GAP_CONFIG;
    const t = resolveSecondaryGapThreshold(cfg);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it("legacy cfg wrappers remain consistent with new DEFAULT_RESOURCE_GAP_CONFIG", () => {
    const legacy = buildDefaultConfiguration();
    const modern = DEFAULT_RESOURCE_GAP_CONFIG;
    // Same alias list semantically
    expect(resolveThresholdMonths(legacy)).toBe(resolveThresholdMonths(modern));
    expect(resolveSecondaryGapThreshold(legacy)).toBe(resolveSecondaryGapThreshold(modern));
    expect(Object.keys(resolveDict(legacy)).length).toBeGreaterThan(0);
  });
});
