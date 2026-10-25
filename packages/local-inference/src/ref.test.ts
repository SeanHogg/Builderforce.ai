import { describe, expect, it } from 'vitest';
import { runsOnDevice } from './ref.js';

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
