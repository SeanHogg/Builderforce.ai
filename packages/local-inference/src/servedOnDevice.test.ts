import { describe, expect, it } from 'vitest';
import { GATEWAY_ATTEMPT_TARGET, hostedCatalogId, hostedDirectRef, pricedId, servedIdentity, servedOnDevice, servedRef } from './ref.js';

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

describe('servedIdentity — who answered, in one reading', () => {
  it('reads a served on-device attempt as on-device and names it', () => {
    expect(servedIdentity({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'served' }] })).toEqual({ onDevice: true, name: 'local/ollama/qwen', viaAttempt: true });
  });

  it('reads a served hosted local-grammar attempt as off-device but still names it', () => {
    expect(servedIdentity({ localFirst: [{ target: 'local/kimi-code/k3', outcome: 'served' }] })).toEqual({ onDevice: false, name: 'local/kimi-code/k3', viaAttempt: true });
  });

  it('reads a served gateway placeholder with nothing resolved as an UNNAMED cloud answer', () => {
    expect(servedIdentity({ localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }] })).toEqual({ onDevice: false, name: undefined, viaAttempt: true });
  });

  it('names a served cloud attempt by the resolved model', () => {
    expect(servedIdentity({ localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }], resolvedModel: 'direct/minimax/m' })).toEqual({ onDevice: false, name: 'direct/minimax/m', viaAttempt: true });
  });

  it('reads a result with no attempts from its resolved model', () => {
    expect(servedIdentity({ resolvedModel: 'local/webllm/qwen' })).toEqual({ onDevice: true, name: 'local/webllm/qwen', viaAttempt: false });
    expect(servedIdentity({})).toEqual({ onDevice: false, name: undefined, viaAttempt: false });
  });

  it('servedOnDevice and servedRef are projections of it', () => {
    const result = { localFirst: [{ target: GATEWAY_ATTEMPT_TARGET, outcome: 'served' }], resolvedModel: 'local/ollama/qwen' };

    expect(servedOnDevice(result)).toBe(servedIdentity(result).onDevice);
    expect(servedRef(result)).toBe(servedIdentity(result).name);
  });
});

describe('the hosted aliases resolve through both spellings (clientPinOf)', () => {
  it('maps local/kimi-code/<m> and direct/kimi-code/<m> to the same catalog id and direct spelling', () => {
    expect(hostedCatalogId('direct/kimi-code/k3')).toBe('moonshotai/kimi-k3');
    expect(hostedCatalogId('direct/kimi-code/k3')).toBe(hostedCatalogId('local/kimi-code/k3'));
    expect(hostedDirectRef('direct/kimi-code/k3')).toBe('direct/kimi-code/k3');
    expect(hostedCatalogId('direct/kimi-code/not-a-model')).toBeUndefined();
    expect(hostedCatalogId('direct/minimax/m')).toBeUndefined();
  });

  it('pricedId is the alias when there is one, the direct spelling for an unknown hosted model, else the ref', () => {
    expect(pricedId('local/kimi-code/k3')).toBe('moonshotai/kimi-k3');
    expect(pricedId('local/kimi-code/not-a-model')).toBe('direct/kimi-code/not-a-model');
    expect(pricedId('openai/gpt-x')).toBe('openai/gpt-x');
    expect(pricedId('local/ollama/qwen')).toBe('local/ollama/qwen');
  });
});

