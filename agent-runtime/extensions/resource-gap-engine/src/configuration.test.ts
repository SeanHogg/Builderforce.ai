/**
 * @file configuration.test.ts
 * @module @builderforce/resource-gap-engine
 * @description Unit tests for configuration constants.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_CANONICAL_SKILL_DICT, buildDefaultConfiguration, DEFAULT_RESOURCE_GAP_CONFIG } from "./configuration.js";

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

  it("builds a full configuration object", () => {
    const cfg = buildDefaultConfiguration();
    expect(cfg.canonicalSkillDictionary).toBeDefined();
    expect(typeof cfg.canonicalSkillDictionary).toBe("object");
    expect(cfg.proficiency).toBeDefined();
    expect(Array.isArray(cfg.proficiency.entries)).toBe(true);
    expect(cfg.proficiency.entries.length).toBeGreaterThan(0);
    // Each entry has supplyLevel, requiredLevel, ratio
    expect(cfg.proficiency.entries[0]).toHaveProperty("supplyLevel");
    expect(cfg.proficiency.entries[0]).toHaveProperty("requiredLevel");
    expect(cfg.proficiency.entries[0]).toHaveProperty("ratio");
    expect(cfg.costBands).toBeDefined();
    expect(typeof cfg.costBands).toBe("object");
    expect(cfg.timeToFill).toBeDefined();
    expect(typeof cfg.timeToFill).toBe("object");
    expect(cfg.hireVsContractThresholdMonths).toBe(6);
    expect(cfg.secondaryGapRiskThreshold).toBe(0.75);
  });

  it("DEFAULT_RESOURCE_GAP_CONFIG is defined with required fields", () => {
    expect(DEFAULT_RESOURCE_GAP_CONFIG.proficiency).toBeDefined();
    expect(DEFAULT_RESOURCE_GAP_CONFIG.skillTaxonomy).toBeDefined();
    expect(DEFAULT_RESOURCE_GAP_CONFIG.timeToFill).toBeDefined();
    expect(DEFAULT_RESOURCE_GAP_CONFIG.costBand).toBeDefined();
    expect(DEFAULT_RESOURCE_GAP_CONFIG.hireVsContractThresholdMonths).toBe(6);
    expect(DEFAULT_RESOURCE_GAP_CONFIG.secondaryGapRiskThreshold).toBe(0.75);
  });
});
