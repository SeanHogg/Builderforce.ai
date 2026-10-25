import { describe, expect, it } from 'vitest';
import { clientPinOf, runsOnDevice } from './ref.js';

describe('clientPinOf', () => {
  it('resolves a local ref as it stands', () => {
    expect(clientPinOf('local/ollama/qwen3:8b')).toEqual({ provider: 'ollama', model: 'qwen3:8b' });
    expect(clientPinOf('local/kimi-code/k3')).toEqual({ provider: 'kimi-code', model: 'k3' });
  });

  it('resolves a gateway ref on a client-dispatched vendor to that runtime', () => {
    expect(clientPinOf('direct/kimi-code/k3')).toEqual({ provider: 'kimi-code', model: 'k3' });
    expect(clientPinOf('direct/kimi-code/kimi-for-coding')).toEqual({ provider: 'kimi-code', model: 'kimi-for-coding' });
  });

  it('leaves every other gateway ref to the gateway', () => {
    expect(clientPinOf('direct/moonshot/kimi-k3')).toBeNull();
    expect(clientPinOf('direct/minimax/MiniMax-M3.1-Flash-Preview')).toBeNull();
    expect(clientPinOf('direct/kimi-code/')).toBeNull();
    expect(clientPinOf('auto')).toBeNull();
    expect(clientPinOf(undefined)).toBeNull();
  });
});

describe('runsOnDevice', () => {
  it('reads the registry: an on-device runtime is on-device, a hosted one is not', () => {
    expect(runsOnDevice('local/ollama/qwen3:8b')).toBe(true);
    expect(runsOnDevice('local/kimi-code/k3')).toBe(false);
  });

  it('a gateway ref or nothing is not on-device', () => {
    expect(runsOnDevice('direct/kimi-code/k3')).toBe(false);
    expect(runsOnDevice(undefined)).toBe(false);
  });
});
