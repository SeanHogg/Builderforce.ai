import { describe, expect, it } from 'vitest';
import { hostedDirectRef, servedOnDevice, servedRef } from './ref.js';

describe('servedRef', () => {
  it('is the served attempt’s target — a gateway attempt included — else the resolved model', () => {
    expect(servedRef({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'local/bfi/q', outcome: 'served' }] })).toBe('local/bfi/q');
    expect(servedRef({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }], resolvedModel: 'other' })).toBe('vendor/model');
    expect(servedRef({ resolvedModel: 'local/webllm/qwen' })).toBe('local/webllm/qwen');
    expect(servedRef({})).toBeUndefined();
  });
});

describe('servedOnDevice', () => {
  it('is true for a served on-device attempt', () => {
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'served' }] })).toBe(true);
  });

  it('is true for a pinned on-device call that recorded no attempts: read from the model that answered', () => {
    expect(servedOnDevice({ resolvedModel: 'local/webllm/qwen' })).toBe(true);
    expect(servedOnDevice({ resolvedModel: 'local/bfi/tiny' })).toBe(true);
  });

  it('is false for a hosted runtime that merely uses the local grammar (Kimi Code)', () => {
    expect(servedOnDevice({ resolvedModel: 'local/kimi-code/k2' })).toBe(false);
    expect(servedOnDevice({ localFirst: [{ target: 'local/kimi-code/k2', outcome: 'served' }] })).toBe(false);
  });

  it('is false for a gateway answer, including one after a local attempt fell over', () => {
    expect(servedOnDevice({ resolvedModel: 'vendor/model' })).toBe(false);
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }] })).toBe(false);
  });

  it('lets an explicit gateway attempt outrank a stale on-device resolved model', () => {
    expect(servedOnDevice({ localFirst: [{ target: 'gateway', outcome: 'served' }], resolvedModel: 'local/ollama/qwen' })).toBe(false);
  });

  it('does not claim a result that names no answer is free', () => {
    expect(servedOnDevice({})).toBe(false);
  });
});

describe('hostedDirectRef', () => {
  it('spells a hosted local-grammar ref the way the gateway catalog does', () => {
    expect(hostedDirectRef('local/kimi-code/k3')).toBe('direct/kimi-code/k3');
  });

  it('is undefined for an on-device ref and for anything that is not a local ref', () => {
    expect(hostedDirectRef('local/ollama/qwen')).toBeUndefined();
    expect(hostedDirectRef('local/webllm/qwen')).toBeUndefined();
    expect(hostedDirectRef('vendor/model')).toBeUndefined();
    expect(hostedDirectRef(undefined)).toBeUndefined();
  });
});
