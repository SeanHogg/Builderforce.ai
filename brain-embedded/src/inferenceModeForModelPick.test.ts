import { describe, expect, it } from 'vitest';
import { inferenceModeForModelPick } from './inferenceModeForModelPick';

describe('inferenceModeForModelPick', () => {
  it('a model or the connected-accounts pool under Hybrid selects Specific', () => {
    expect(inferenceModeForModelPick('hybrid', { mode: 'model', model: 'direct/kimi-code/k3' })).toBe('specific');
    expect(inferenceModeForModelPick('hybrid', { mode: 'model', model: 'local/ollama/qwen' })).toBe('specific');
    expect(inferenceModeForModelPick('hybrid', { mode: 'byo_pool' })).toBe('specific');
  });

  it('Auto returns Specific to Hybrid and leaves every other mode alone', () => {
    expect(inferenceModeForModelPick('specific', { mode: 'auto' })).toBe('hybrid');
    expect(inferenceModeForModelPick('hybrid', { mode: 'auto' })).toBeNull();
    expect(inferenceModeForModelPick('local-only', { mode: 'auto' })).toBeNull();
  });

  it('a pick already on Specific changes nothing', () => {
    expect(inferenceModeForModelPick('specific', { mode: 'model', model: 'meta/llama' })).toBeNull();
    expect(inferenceModeForModelPick('specific', { mode: 'byo_pool' })).toBeNull();
  });

  it('Local only keeps an ON-DEVICE pick, read from the runtime registry', () => {
    expect(inferenceModeForModelPick('local-only', { mode: 'model', model: 'local/ollama/qwen' })).toBeNull();
    // Kimi Code is local in grammar but hosted (`onDevice: false`): Local only would set it aside.
    expect(inferenceModeForModelPick('local-only', { mode: 'model', model: 'local/kimi-code/k3' })).toBe('specific');
    expect(inferenceModeForModelPick('local-only', { mode: 'model', model: 'direct/kimi-code/k3' })).toBe('specific');
    expect(inferenceModeForModelPick('local-only', { mode: 'byo_pool' })).toBe('specific');
  });

  it('an UNDECIDED Local only is never lifted by a pick — the first-run question still asks', () => {
    expect(inferenceModeForModelPick('local-only', { mode: 'model', model: 'direct/kimi-code/k3' }, { undecided: true })).toBeNull();
    expect(inferenceModeForModelPick('local-only', { mode: 'byo_pool' }, { undecided: true })).toBeNull();
    // Undecided Hybrid is not a privacy promise: the pick still runs as picked.
    expect(inferenceModeForModelPick('hybrid', { mode: 'model', model: 'meta/llama' }, { undecided: true })).toBe('specific');
  });
});
