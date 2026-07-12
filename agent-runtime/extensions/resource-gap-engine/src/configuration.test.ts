/**
 * @file configuration.test.ts
 * @module @builderforce/resource-gap-engine
 * @description Unit tests for configuration constants.
 */

import { describe, it, expect } from "jsr:@std/testing@1.0.2/assert";
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
    expect(cfg.canonicalSkillDictionary).toNotBe(undefined);
    expect(cfg.proficiencyWeighting).toBeArrayOfSize(4);
    expect(cfg.defaultCostRanges).toBeDefined();
    expect(cfg.timeToFillEstimates).toBeDefined();
    expect(cfg.hireVsContractThresholdMonths).toBe(6);
    expect(cfg.secondaryGapRiskThreshold).toBe(0.75);
    expect(cfg.fullCoverageProficiencyRatio).toBe(1.0);
  });
});