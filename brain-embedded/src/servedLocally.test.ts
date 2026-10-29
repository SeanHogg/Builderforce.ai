import { describe, expect, it } from 'vitest';
import { servedOnDevice } from '@builderforce/local-inference';

// THE "this turn was free" rule (owned by @builderforce/local-inference). The run outcome's cost reads it.
describe('servedOnDevice - judged by what SERVED the call', () => {
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

  it('is false for a cloud model, and when nothing reports what served - the REQUESTED model is never a fallback', () => {
    expect(servedOnDevice({ resolvedModel: 'gpt-5' })).toBe(false);
    expect(servedOnDevice({}, 'local/ollama/phi')).toBe(false);
  });
});
