import { describe, it, expect } from 'vitest';
import { MODALITIES, DEFAULT_MODALITY, getModality } from './modality';

describe('project modalities', () => {
  it('exposes designer, video, evermind, finetune, and voice', () => {
    const ids = MODALITIES.map((m) => m.id).sort();
    expect(ids).toEqual(['designer', 'evermind', 'finetune', 'video', 'voice']);
  });

  // Regression: the combined `llm` modality was split into `evermind` (living model)
  // and `finetune` (classic LoRA). Both must stay enabled — a stray `comingSoon: true`
  // silently drops the tab from the switcher + dashboard chooser.
  it('keeps evermind and finetune enabled', () => {
    for (const id of ['evermind', 'finetune'] as const) {
      const m = MODALITIES.find((x) => x.id === id);
      expect(m).toBeDefined();
      expect(m?.comingSoon).toBeFalsy();
    }
  });

  // Legacy `llm` projects predate the split and were seeded with an Evermind recipe,
  // so getModality must alias the retired id to the evermind definition.
  it('aliases the retired llm id to evermind', () => {
    expect(getModality('llm').id).toBe('evermind');
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
