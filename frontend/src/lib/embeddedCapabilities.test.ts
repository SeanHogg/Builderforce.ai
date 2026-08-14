import { describe, expect, it } from 'vitest';
import {
  capabilitySnippet,
  EMBEDDED_CAPABILITIES,
  EMBEDDED_CAPABILITY_KEYS,
  EMBEDDED_REPLACED_TOOLS,
  EMBEDDED_STACK_BENCHMARK_MONTHLY,
  unifiedEmbedSnippet,
} from './embeddedCapabilities';

describe('embedded capability catalog', () => {
  it('contains every migrated capability exactly once', () => {
    expect(EMBEDDED_CAPABILITIES).toHaveLength(13);
    expect(new Set(EMBEDDED_CAPABILITY_KEYS).size).toBe(13);
    expect(EMBEDDED_CAPABILITY_KEYS).toEqual(expect.arrayContaining([
      'usage_tracking', 'support_widget', 'feedback_widget', 'heatmaps',
      'feature_management', 'terms_gate', 'sourcing', 'lead_forms',
      'push_notifications', 'onboarding', 'cookie_consent', 'hr_widget', 'status_page',
    ]));
  });

  it('uses one public workspace key for the unified install rail', () => {
    const snippet = unifiedEmbedSnippet('bf_42');
    expect(snippet).toContain('embed/v1.js');
    expect(snippet).toContain('data-builderforce-key="bf_42"');
  });

  it('provides an activation example for every capability', () => {
    for (const capability of EMBEDDED_CAPABILITIES) {
      expect(capabilitySnippet(capability.key).trim().length).toBeGreaterThan(10);
    }
  });
});

/**
 * The selling claims on /embedded are DERIVED from this registry, so the tests
 * that matter are the ones that keep a published number honest when the catalog
 * changes underneath it.
 */
describe('embedded capability stack value', () => {
  it('gives every capability something it stands in for and a price to stand against', () => {
    for (const item of EMBEDDED_CAPABILITIES) {
      expect(item.replaces.length, item.key).toBeGreaterThan(0);
      expect(item.benchmarkMonthlyUsd, item.key).toBeGreaterThan(0);
    }
  });

  it('sums the stack benchmark from the catalog rather than a typed headline', () => {
    const expected = EMBEDDED_CAPABILITIES.reduce((total, item) => total + item.benchmarkMonthlyUsd, 0);
    expect(EMBEDDED_STACK_BENCHMARK_MONTHLY).toBe(expected);
    // A visitor is shown this figure beside a catalog of N cards; if the two
    // could disagree the page would advertise a stack it does not ship.
    expect(EMBEDDED_STACK_BENCHMARK_MONTHLY).toBeGreaterThan(0);
  });

  it('lists each displaced tool once, however many capabilities name it', () => {
    expect(new Set(EMBEDDED_REPLACED_TOOLS).size).toBe(EMBEDDED_REPLACED_TOOLS.length);
    for (const item of EMBEDDED_CAPABILITIES) {
      for (const tool of item.replaces) expect(EMBEDDED_REPLACED_TOOLS).toContain(tool);
    }
  });
});
