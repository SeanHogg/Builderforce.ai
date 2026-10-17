import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_MODEL_LABELS, LOCAL_MODEL_LABEL_FIELDS, localModelLabelsFrom } from './labels';

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
