/**
 * @file configuration.test.ts
 * @module @builderforce/resource-gap-engine
 * @description Unit tests for configuration constants.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_CANONICAL_SKILL_DICT, buildDefaultConfiguration } from "./configuration.js";

describe("configuration", () => {
  it("has a non-empty canonical skill dictionary", () => {
    expect(Object.keys(DEFAULT_CANONICAL_SKILL_DICT)).not.toHaveLength(0);
  });

  it("maps common aliases to canonical names", () => {
    expect(DEFAULT_CANONICAL_SKILL_DICT["js"]).toBe("JavaScript");
    expect(DEFAULT_CANONICAL_SKILL_DICT["ts"]).toBe("TypeScript");
    expect(DEFAULT_CANONICAL_SKILL_DICT["react"]).toBe("React");
    expect(DEFAULT_CANONICAL_SKILL_DICT["py"]).toBe("Python");
  });

  it("builds a full configuration object", () => {
    const cfg = buildDefaultConfiguration();
    expect(cfg.canonicalSkillDictionary).toBeDefined();
    expect(cfg.canonicalSkillDictionary).toBe("object");
    expect(cfg.proficiencyWeighting).toBe(Array.of(
      expect.objectContaining({ minimumSupplyProficiency: 3, maxEffectiveProficiency: 4 }), 
      expect.objectContaining({ minimumSupplyProficiency: 4, maxEffectiveProficiency: 5 })
    ));
    expect(cfg.defaultCostRanges).toBe("object");
    expect(cfg.timeToFillEstimates).toBe("object");
    expect(cfg.hireVsContractThresholdMonths).toBe(6);
    expect(cfg.secondaryGapRiskThreshold).toBe(0.75);
    expect(cfg.fullCoverageProficiencyRatio).toBe(1.0);
  });
});