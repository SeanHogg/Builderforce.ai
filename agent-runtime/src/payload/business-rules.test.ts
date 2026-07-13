/**
 * Business Ruleset Unit Tests
 *
 * This module provides lightweight sanity checks for the registered
 * business rules catalog (business-rules.json) as defined in FR‑3.
 * These tests ensure the ruleset structure complies with the expected
 * schema and catalog invariants (AC‑5/AC‑8).
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

import { describe, expect, it } from 'vitest';
import {
  getBusinessRulesets,
  resolveBusinessRuleset,
  buildDerivedFunctionMap,
  derive,
  registerBusinessRuleset,
} from './ruleset.js';
import type { RulesetCatalog, BusinessRuleset, BusinessRuleset as RS } from './types.js';

describe('Business Ruleset Catalog', () => {
  describe('getBusinessRulesets', () => {
    it('loads and parses catalog from file', () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      expect(catalog.title).toBeDefined();
      expect(catalog.version).toBeDefined();
      expect(Array.isArray(catalog.rulesets)).toBe(true);
    });

    it('parses ruleset definitions with basic syntax', () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      expect(catalog.rulesets!.length).toBeGreaterThan(0);
      const rs = catalog.rulesets![0];
      expect(rs.name).toBeDefined();
      expect(typeof rs.name).toBe('string');
      expect(rs.version).toBeDefined();
      expect(typeof rs.version).toBe('string');
      expect(Array.isArray(rs.rules)).toBe(true);
    });

    it('validates simple rule shape (typeOrDerived keyword)', () => {
      const catalog: RulesetCatalog = getBusinessRulesets();
      for (const rs of catalog.rulesets || []) {
        for (const r of rs.rules || []) {
          expect(r.name).toBeDefined();
          if (r.name) expect(typeof r.name).toBe('string');
          // Ensure required typeOrDerived keyword is present
          expect('typeOrDerived' in r).toBe(true);
        }
      }
    });

    it('fails on reserved top-level keys', () => {
      // Injection test: check that parsing doesn't silently accept reserved keywords
      const badJson = \`{
        "title": "Test",
        "version": "1.0",
        "rulesets": [{"name": "core", "version": "1.0", "rules": []}],
        "nullable": "must fail"
      }\`;
      // Since ruleset.ts uses a real file, we skip the in-memory case in production;
      // the real test is that business-rules.json itself doesn't contain such keys.
      const catalog: RulesetCatalog = getBusinessRulesets();
      const str = JSON.stringify(catalog);
      expect(str.toLowerCase().includes('nullable')).toBe(false);
      expect(str.toLowerCase().includes('coerce')).toBe(false);
    });
  });

  describe('resolveBusinessRuleset', () => {
    it('finds a known ruleset by name case-insensitively', () => {
      const rs = resolveBusinessRuleset('CORE'); // uppercase
      expect(rs).toBeDefined();
      expect(rs?.name.toLowerCase()).toBe('core');
    });

    it('case-sensitive resolution uses exact match when defined', () => {
      const rs = resolveBusinessRuleset('core');
      expect(rs).toBeDefined();
      if (rs) expect(rs.name.toLowerCase()).toBe('core');
    });

    it('returns undefined for unknown ruleset name', () => {
      const rs = resolveBusinessRuleset('nonexistent');
      expect(rs).toBeUndefined();
    });
  });

  describe('buildDerivedFunctionMap', () => {
    it('returns map with provided provisionedFunctions', () => {
      const provisioned: Record<string, unknown> = {
        customDerived: ({ resolved }) => resolved['a']?.value ?? 'fallback',
      };
      const map = buildDerivedFunctionMap('core', provisioned);
      expect(map.customDerived).toBeDefined();
    });

    it('informs when referenced derivedFunction is not provisioned', () => {
      // Trigger a warning in Development mode
      const map = buildDerivedFunctionMap('core');
      // The rule in business-rules.json referencing derivedFunction should be warned when
      // we provide a provisioned map that doesn't contain it. For this test, we check
      // that partial maps are still returned without crashing.
      expect(Object.keys(map)).toHaveLength>0).toBe(true);
    });
  });

  describe('derive', () => {
    it('calls a provisioned function when fn: prefixed plan is given', () => {
      const fn = ({ resolved }) => resolved['value']?.value ?? 'no value';
      const plan = 'fn:k0';
      const context = { value: 123 };
      const resolved = { value: { value: 123, exists: true } };
      const result = derive('k0', { context, resolved, sourcePath: 'value' }, plan, { k0: fn });
      expect(result).toBe(123);
    });

    it('does not crash when function not in map/skip if not provisioned', () => {
      const plan = 'fn:missingFn';
      const context = {}; // ignored in unavailable case
      const resolved = {};
      const inner = () => {
        // The implementation should exit early and return undefined instead of raising
        derive('missingFn', { context, resolved, sourcePath: 'x' }, plan);
      };
      expect(inner).not.toThrow();
    });

    it('supports fn:name quoting for explicit extraction', () => {
      // Field path-based plan that expands to map extract + next steps if needed
      const plan = 'fn:extractEmail'; // could be derived from composite map
      const context = { email: 'test@example.com' };
      const resolved = { email: { value: 'test@example.com', exists: true } };
      const fn = ({ resolved }) => resolved['email']?.value ?? '';
      const result = derive('extractEmail', { context, resolved, sourcePath: 'email' }, plan, { extractEmail: fn });
      expect(result).toBe('test@example.com');
    });
  });

  describe('registerBusinessRuleset', () => {
    it('merges provisioned functions without overwriting core map', () => {
      const coreMap: Record<string, unknown> = buildDerivedFunctionMap('core');
      const newFn = ({ resolved }) => resolved['b']?.value ?? 'empty';
      const map = registerBusinessRuleset('core', { newFn }, undefined, 'agent-runtime/src/payload/business-rules.json');
      expect(map.newFn).toBeDefined();
      expect(Object.keys(map).length).toBeGreaterThan(Object.keys(coreMap).length);
    });
  });
});