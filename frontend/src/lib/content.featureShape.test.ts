import { describe, expect, it } from 'vitest';
import {
  AGENT_CAPABILITIES,
  FEATURES,
  PRODUCT_SECTIONS,
  asFeature,
  type Feature,
} from './content';

/**
 * The public site describes capabilities in three lists. They answer three
 * different questions and should stay three lists — but they had also invented
 * three field vocabularies for one idea, which is what `asFeature()` ends.
 */
describe('the Feature shape', () => {
  const projected: Feature[] = [
    ...FEATURES.map(asFeature),
    ...AGENT_CAPABILITIES.map(asFeature),
    ...PRODUCT_SECTIONS.flatMap((section) => section.surfaces.map(asFeature)),
  ];

  it('projects every list, with no empty facts', () => {
    expect(projected.length).toBeGreaterThan(FEATURES.length);
    for (const feature of projected) {
      expect(feature.icon, feature.title).toBeTruthy();
      expect(feature.title.trim(), 'a feature with no title').toBeTruthy();
      expect(feature.shortDesc.trim(), feature.title).toBeTruthy();
    }
  });

  it('describes each capability once — no title in two lists', () => {
    // The failure this catches: the same capability written up separately on
    // /features and /agents, drifting apart until the two pages contradict.
    const titles = projected.map((feature) => feature.title.trim().toLowerCase());
    const duplicates = titles.filter((title, index) => titles.indexOf(title) !== index);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('gives every addressable feature a site-relative or docs href', () => {
    for (const feature of projected) {
      if (!feature.href) continue;
      expect(feature.href.startsWith('/') || feature.href.startsWith('https://'), feature.title).toBe(true);
    }
  });
});
