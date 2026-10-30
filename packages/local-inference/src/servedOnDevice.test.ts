import { describe, expect, it } from 'vitest';
import { GATEWAY_ATTEMPT_TARGET, hostedCatalogId, hostedDirectRef, servedOnDevice, servedRef } from './ref.js';

describe('servedRef', () => {
  it('names a served LOCAL attempt by its target', () => {
    expect(servedRef({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'local/bfi/q', outcome: 'served' }] })).toBe('local/bfi/q');
  });

  it('names a served cloud attempt by the model the stream resolved, never by the gateway placeholder', () => {
    expect(servedRef({ localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }], resolvedModel: 'direct/minimax/MiniMax-M2.7' })).toBe('direct/minimax/MiniMax-M2.7');
  });

  it('falls back to a served cloud attempt’s own target when it is a real model id and nothing resolved', () => {
    expect(servedRef({ localFirst: [{ target: 'vendor/model', outcome: 'served' }] })).toBe('vendor/model');
  });

  it('names nothing when only the placeholder is known, or the result is empty', () => {
    expect(servedRef({ localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }] })).toBeUndefined();
    expect(servedRef({})).toBeUndefined();
  });

  it('reads a pinned call with no attempts from the model that answered', () => {
    expect(servedRef({ resolvedModel: 'local/webllm/qwen' })).toBe('local/webllm/qwen');
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
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }] })).toBe(false);
  });

  it('lets an explicit gateway attempt outrank a stale on-device resolved model', () => {
    expect(servedOnDevice({ localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }], resolvedModel: 'local/ollama/qwen' })).toBe(false);
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

describe('hostedCatalogId', () => {
  it('maps a hosted runtime’s model to the catalog id it bills as, from the registry data', () => {
    expect(hostedCatalogId('local/kimi-code/k3')).toBe('moonshotai/kimi-k3');
    expect(hostedCatalogId('local/kimi-code/kimi-k3')).toBe('moonshotai/kimi-k3');
  });

  it('is undefined for a hosted model the registry does not know, an on-device ref, and a non-local ref', () => {
    expect(hostedCatalogId('local/kimi-code/not-a-model')).toBeUndefined();
    expect(hostedCatalogId('local/ollama/qwen')).toBeUndefined();
    expect(hostedCatalogId('moonshotai/kimi-k3')).toBeUndefined();
  });
});
