import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import type { CopyReader } from './copy';
import { AGENT_CAPABILITIES, asFeature, featuresCopy, productSectionsCopy, type Feature } from './product';

/**
 * The public site describes capabilities in three lists — `features`,
 * `agents.capabilities` and the product surfaces. They answer three different
 * questions and should stay three lists — but they had also invented three field
 * vocabularies for one idea, which is what `asFeature()` ends. The words are
 * catalog copy now, so the lists are projected from the default catalog.
 */
const t = createTranslator({ locale: 'en', messages: en as never }) as unknown as CopyReader;
const capabilityCopy = t.raw('agents.capabilities') as { title: string; description: string }[];

describe('the Feature shape', () => {
  const projected: Feature[] = [
    ...featuresCopy(t).map(asFeature),
    ...AGENT_CAPABILITIES.map((capability, i) => asFeature({ ...capability, ...capabilityCopy[i] })),
    ...productSectionsCopy(t).flatMap((section) => section.surfaces.map(asFeature)),
  ];

  it('projects every list, with no empty facts', () => {
    expect(projected.length).toBeGreaterThan(featuresCopy(t).length);
    for (const feature of projected) {
      expect(feature.title.trim(), 'a feature with no title').toBeTruthy();
      expect(feature.shortDesc.trim(), feature.title).toBeTruthy();
    }
  });

  it('gives every registry-backed feature its glyph', () => {
    // `features` carries no glyph of its own; the two registries that pair a
    // catalog list with structure must supply one for every row.
    const glyphed = [
      ...AGENT_CAPABILITIES.map((capability, i) => asFeature({ ...capability, ...capabilityCopy[i] })),
      ...productSectionsCopy(t).flatMap((section) => section.surfaces.map(asFeature)),
    ];
    for (const feature of glyphed) expect(feature.icon, feature.title).toBeTruthy();
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
