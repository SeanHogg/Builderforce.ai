import { describe, expect, it } from 'vitest';
import { servedLocalTarget, servedOnDevice } from './ref.js';

describe('servedLocalTarget', () => {
  it('names the local ref the served attempt answered with', () => {
    expect(servedLocalTarget({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'local/bfi/q', outcome: 'served' }] })).toBe('local/bfi/q');
  });

  it('is undefined when the gateway answered, or no attempts were recorded', () => {
    expect(servedLocalTarget({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }] })).toBeUndefined();
    expect(servedLocalTarget({})).toBeUndefined();
  });
});

describe('servedOnDevice', () => {
  it('is true for a served on-device attempt', () => {
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'served' }] })).toBe(true);
  });

  it('is true for a pinned on-device call that recorded no attempts: read from the answering model, else the one asked for', () => {
    expect(servedOnDevice({ resolvedModel: 'local/webllm/qwen' })).toBe(true);
    expect(servedOnDevice({}, 'local/bfi/tiny')).toBe(true);
  });

  it('is false for a hosted runtime that merely uses the local grammar (Kimi Code)', () => {
    expect(servedOnDevice({ resolvedModel: 'local/kimi-code/k2' })).toBe(false);
    expect(servedOnDevice({ localFirst: [{ target: 'local/kimi-code/k2', outcome: 'served' }] })).toBe(false);
  });

  it('is false for a gateway answer, including one after a local attempt fell over', () => {
    expect(servedOnDevice({ resolvedModel: 'vendor/model' })).toBe(false);
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }], resolvedModel: 'vendor/model' })).toBe(false);
    expect(servedOnDevice({})).toBe(false);
  });
});
