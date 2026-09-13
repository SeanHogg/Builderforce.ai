import { describe, it, expect } from 'vitest';
import { lastServedModel, withProvenanceMetadata } from './provenance';

const served = (model: string) => ({ metadata: withProvenanceMetadata({ model, account: 'own' }) ?? null });

describe('lastServedModel', () => {
  it('names the model on the NEWEST reply that carries provenance', () => {
    const messages = [
      { metadata: null },
      served('direct/qwen/qwen3.8-max'),
      { metadata: null },
      served('claude-opus-5'),
      { metadata: JSON.stringify({ authoredBy: 'user' }) },
    ];
    expect(lastServedModel(messages)).toBe('claude-opus-5');
  });

  it('is undefined before anything has answered, so the caller keeps the requested model', () => {
    expect(lastServedModel([])).toBeUndefined();
    expect(lastServedModel([{ metadata: null }, { metadata: '{broken' }])).toBeUndefined();
  });
});
