import { describe, it, expect } from 'vitest';
import { MODALITIES, DEFAULT_MODALITY, getModality } from './modality';

describe('project modalities', () => {
  it('exposes designer, video, and llm', () => {
    const ids = MODALITIES.map((m) => m.id).sort();
    expect(ids).toEqual(['designer', 'llm', 'video']);
  });

  // Regression: the LLM modality shipped (gate flipped + LlmStudioPanel wired).
  // If someone re-adds `comingSoon: true` the tab silently disappears again.
  it('keeps the llm modality enabled', () => {
    const llm = MODALITIES.find((m) => m.id === 'llm');
    expect(llm).toBeDefined();
    expect(llm?.comingSoon).toBeFalsy();
  });

  it('gives every modality the fields the IDE switcher + Brain read', () => {
    for (const m of MODALITIES) {
      expect(m.label).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(m.brainSystemPrompt).toBeTruthy();
      expect(m.brainPlaceholder).toBeTruthy();
      expect(m.brainEmptyState).toBeTruthy();
      expect(m.rightTabs.length).toBeGreaterThan(0);
    }
  });

  it('defaults to a real, enabled modality', () => {
    const def = getModality(DEFAULT_MODALITY);
    expect(def.id).toBe(DEFAULT_MODALITY);
    expect(def.comingSoon).toBeFalsy();
  });

  it('falls back to Designer for unknown / nullish ids', () => {
    expect(getModality('nope').id).toBe('designer');
    expect(getModality(null).id).toBe('designer');
    expect(getModality(undefined).id).toBe('designer');
  });
});
