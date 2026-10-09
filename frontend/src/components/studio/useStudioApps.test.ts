import { describe, expect, it } from 'vitest';
import { newestStudioCards, summaryHasApp } from './useStudioApps';

describe('Studio apps — which boards the Studio home lists', () => {
  it('lists a server board whose preview holds a build, by kind or by object', () => {
    expect(summaryHasApp({ preview: { kinds: ['chat', 'build'] } })).toBe(true);
    expect(summaryHasApp({ preview: { kinds: ['chat'], objects: [{ id: 'a', kind: 'build', x: 0, y: 0, title: 'App' }] } })).toBe(true);
    expect(summaryHasApp({ preview: { kinds: ['chat', 'website'] } })).toBe(false);
    expect(summaryHasApp({ preview: null })).toBe(false);
  });

  it('shows the newest first, at most twelve', () => {
    const cards = Array.from({ length: 14 }, (_, index) => ({
      key: `s${index}`, href: `/studio/s${index}`, title: `App ${index}`, updatedAt: new Date(2026, 9, index + 1).toISOString(),
    }));
    const shown = newestStudioCards(cards);
    expect(shown).toHaveLength(12);
    expect(shown[0]!.key).toBe('s13');
  });
});
