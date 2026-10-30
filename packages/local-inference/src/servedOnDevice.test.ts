import { describe, expect, it } from 'vitest';
import { servedOnDevice, servedRef } from './index.js';

// THE "this call was free" rule: judged by what SERVED the call, never by what was asked for.
describe('servedRef - what actually served', () => {
  it('is the attempt marked served, else the resolved model, else nothing', () => {
    expect(servedRef({ localFirst: [{ target: 'local/ollama/a', outcome: 'failed' }, { target: 'gateway', outcome: 'served' }], resolvedModel: 'gpt-5' })).toBe('gateway');
    expect(servedRef({ resolvedModel: 'local/ollama/phi' })).toBe('local/ollama/phi');
    expect(servedRef({})).toBeUndefined();
  });
});

describe('servedOnDevice', () => {
  it('is true for an on-device runtime, however the transport reports it', () => {
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/llama3', outcome: 'served' }] })).toBe(true);
    expect(servedOnDevice({ resolvedModel: 'local/ollama/phi' })).toBe(true);
  });

  it('the attempt marked served wins over the resolved model', () => {
    expect(servedOnDevice({ localFirst: [{ target: 'local/ollama/a', outcome: 'failed' }, { target: 'gateway', outcome: 'served' }], resolvedModel: 'local/ollama/a' })).toBe(false);
  });

  it('is false for a hosted runtime dispatched from here (local in grammar, paid, off the device)', () => {
    expect(servedOnDevice({ resolvedModel: 'local/kimi-code/k3' })).toBe(false);
    expect(servedOnDevice({ localFirst: [{ target: 'local/kimi-code/k3', outcome: 'served' }] })).toBe(false);
  });

  it('is false for a cloud model, and when nothing reports what served (unknown, not free)', () => {
    expect(servedOnDevice({ resolvedModel: 'gpt-5' })).toBe(false);
    expect(servedOnDevice({})).toBe(false);
  });
});
