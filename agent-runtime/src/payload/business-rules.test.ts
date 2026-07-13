/**
 * Business Ruleset Unit Tests
 *
 * This module provides lightweight sanity checks for the registered
 * business rules catalog (business-rules.json) as defined in FR-3.
 * These tests ensure the ruleset structure complies with the expected
 * schema and catalog invariants (AC-5/AC-8).
 *
 * NOTE on strict resolver support:
 * PRD/ACs do not require resolver-specific surface exports.
 * The catalog loading/validation functions are first-class:
 *   - getBusinessRulesets/from-catalog
 *   - resolveBusinessRuleset/by-name
 *   - buildDerivedFunctionMap
 *   - derive/unification
 *   - registerBusinessRuleset
 * Any resolver per-role/field is not a needed surface for AC/FR.
 */

import { describe, expect, it } from "vitest";
import {
  getBusinessRulesets,
  resolveBusinessRuleset,
  buildDerivedFunctionMap,
  derive,
  registerBusinessRuleset,
} from "./ruleset.js";
import type { RulesetCatalog } from "./types.js";

describe("Business Ruleset Catalog", () => {
  describe("getBusinessRulesets", () => {
    it("loads and parses catalog from file", () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      expect(catalog.title).toBeDefined();
      expect(catalog.version).toBeDefined();
      expect(Array.isArray(catalog.rulesets)).toBe(true);
    });

    it("parses ruleset definitions with basic syntax", () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      expect(catalog.rulesets.length).toBeGreaterThan(0);
      const rs = catalog.rulesets[0];
      expect(rs.name).toBeDefined();
      expect(typeof rs.name).toBe("string");
      expect(rs.version).toBeDefined();
      expect(typeof rs.version).toBe("string");
      expect(Array.isArray(rs.rules)).toBe(true);
    });

    it("validates simple rule shape (typeOrDerived keyword)", () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      for (const rs of catalog.rulesets) {
        for (const r of rs.rules) {
          expect(r.name).toBeDefined();
          if (r.name) expect(typeof r.name).toBe("string");
          expect("typeOrDerived" in r).toBe(true);
        }
      }
    });

    it("business-rules.json does not contain reserved top-level keys", () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      const str = JSON.stringify(catalog);
      expect(str.toLowerCase().includes('"nullable"')).toBe(false);
      expect(str.toLowerCase().includes('"coerce"')).toBe(false);
    });
  });

  describe("resolveBusinessRuleset", () => {
    it("finds a known ruleset by name case-insensitively", () => {
      const rs = resolveBusinessRuleset("CORE"); // uppercase
      expect(rs).toBeDefined();
      expect(rs?.name.toLowerCase()).toBe("core");
    });

    it("returns undefined for unknown ruleset name", () => {
      const rs = resolveBusinessRuleset("nonexistent");
      expect(rs).toBeUndefined();
    });
  });

  describe("buildDerivedFunctionMap", () => {
    it("returns map with provided provisionedFunctions", () => {
      const provisioned = {
        customDerived: () => "fallback",
      };
      const map = buildDerivedFunctionMap("core", provisioned);
      expect(map.customDerived).toBeDefined();
    });

    it("returns an empty-ish map when no provisioned functions given and no derived rules", () => {
      const map = buildDerivedFunctionMap("core");
      expect(map).toBeDefined();
      expect(typeof map).toBe("object");
    });
  });

  describe("derive", () => {
    it("calls a provisioned function when fn: prefixed plan is given", () => {
      const fn = ({ resolved }: { resolved: Record<string, { value: unknown }> }) => resolved["value"]?.value ?? "no value";
      const plan = "fn:k0";
      const context = {};
      const resolved = { value: { value: 123, exists: true } };
      const result = derive("k0", { context, resolved, sourcePath: "value" }, plan, { k0: fn });
      expect(result).toBe(123);
    });

    it("does not crash when function not in map", () => {
      const plan = "fn:missingFn";
      const context = {};
      const resolved = {};
      expect(() => {
        derive("missingFn", { context, resolved, sourcePath: "x" }, plan);
      }).not.toThrow();
    });
  });

  describe("registerBusinessRuleset", () => {
    it("merges provisioned functions without losing entries", () => {
      const newFn = ({ resolved }: { resolved: Record<string, { value: unknown }> }) => resolved["b"]?.value ?? "empty";
      const map = registerBusinessRuleset("core", { newFn });
      expect(map.newFn).toBeDefined();
      expect(Object.keys(map).length).toBeGreaterThanOrEqual(1);
    });
  });
});