import { describe, it, expect } from 'vitest';
import { MODALITIES, DEFAULT_MODALITY, getModality } from './modality';

describe('project modalities', () => {
  it('exposes designer, mobile, video, evermind, finetune, and voice', () => {
    const ids = MODALITIES.map((m) => m.id).sort();
    expect(ids).toEqual(['designer', 'evermind', 'finetune', 'mobile', 'video', 'voice']);
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
      expect(m.rightTabs.length).toBeGreaterThan(0);
    }
  });

  // The IDE reads its layout from these fields instead of branching on the
  // modality id, so a new modality that omits one would render an empty centre
  // pane rather than failing loudly.
  it('gives every modality the layout fields the IDE reads', () => {
    for (const m of MODALITIES) {
      expect(m.center, `${m.id}.center`).toBeTruthy();
      expect(typeof m.dockBrain, `${m.id}.dockBrain`).toBe('boolean');
      expect(['site', 'agent'], `${m.id}.publishPanel`).toContain(m.publishPanel);
      // A Publish tab and a publish panel have to agree.
      if (m.rightTabs.includes('publish')) expect(m.publishPanel).toBeTruthy();
    }
  });

  // Mobile reuses the Designer's whole WebContainer pipeline and differs only in
  // how the centre pane frames the preview.
  it('configures mobile as a runnable, checked, device-framed modality', () => {
    const mobile = getModality('mobile');
    expect(mobile.id).toBe('mobile');
    expect(mobile.center).toBe('device');
    expect(mobile.showRunButton).toBe(true);
    expect(mobile.showChecks).toBe(true);
    expect(mobile.dockBrain).toBe(true);
    expect(mobile.publishPanel).toBe('site');
    expect(mobile.comingSoon).toBeFalsy();
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
