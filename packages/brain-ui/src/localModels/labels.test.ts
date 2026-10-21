import { describe, expect, it } from 'vitest';
import type { LocalModelRow } from '@seanhogg/builderforce-brain-embedded';
import {
  DEFAULT_LOCAL_MODEL_LABELS,
  LOCAL_BACKEND_LABEL,
  LOCAL_MODEL_LABEL_FIELDS,
  LOCAL_UNSUPPORTED_LABEL,
  localModelLabelsFrom,
} from './labels';
import { backendBadge } from './localModelView';

describe('localModelLabelsFrom', () => {
  it('reads every field through the host lookup', () => {
    const labels = localModelLabelsFrom((field) => `x:${field}`);
    for (const field of LOCAL_MODEL_LABEL_FIELDS) expect(labels[field]).toBe(`x:${field}`);
  });

  it('falls back to the English default for a field the catalog lacks', () => {
    const labels = localModelLabelsFrom((field) => (field === 'localTools' ? 'Outils' : undefined));
    expect(labels.localTools).toBe('Outils');
    expect(labels.localCancel).toBe(DEFAULT_LOCAL_MODEL_LABELS.localCancel);
  });
});

describe('the reason and backend registries', () => {
  it('point only at real label fields', () => {
    for (const field of [...Object.values(LOCAL_UNSUPPORTED_LABEL), ...Object.values(LOCAL_BACKEND_LABEL)]) {
      expect(LOCAL_MODEL_LABEL_FIELDS).toContain(field);
    }
    expect(LOCAL_UNSUPPORTED_LABEL.memory_insufficient).toBe('localReasonMemory');
  });

  it('badges a CPU-capable row with where it runs, and nothing else', () => {
    const bonsai = {
      ref: 'local/bfi/bonsai-1.7b-q1_0',
      runtime: 'bfi',
      requires: { minBufferBytes: 1, cpu: { minDeviceMemoryBytes: 1 } },
      state: 'absent',
    } as unknown as LocalModelRow;
    expect(backendBadge({ ...bonsai, backend: 'cpu' }, DEFAULT_LOCAL_MODEL_LABELS)).toBe('CPU');
    expect(backendBadge({ ...bonsai, backend: 'webgpu' }, DEFAULT_LOCAL_MODEL_LABELS)).toBe('GPU');
    expect(backendBadge({ ...bonsai, state: 'unsupported', reason: 'memory_insufficient' }, DEFAULT_LOCAL_MODEL_LABELS)).toBeNull();
    const webllm = { ...bonsai, requires: { minBufferBytes: 1 }, backend: 'webgpu' } as unknown as LocalModelRow;
    expect(backendBadge(webllm, DEFAULT_LOCAL_MODEL_LABELS)).toBeNull();
  });
});
