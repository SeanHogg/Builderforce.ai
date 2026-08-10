import { describe, expect, it } from 'vitest';
import { capabilitySnippet, EMBEDDED_CAPABILITIES, EMBEDDED_CAPABILITY_KEYS, unifiedEmbedSnippet } from './embeddedCapabilities';

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
