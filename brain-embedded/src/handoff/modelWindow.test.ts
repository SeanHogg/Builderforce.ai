import { describe, expect, it } from 'vitest';
import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import { contextWindowOf } from './modelWindow';

describe('contextWindowOf', () => {
  it('reads a local ref from the shipped catalog (WebLLM 4k, Bonsai 65k)', () => {
    expect(contextWindowOf('local/webllm/Qwen3-1.7B-q4f16_1-MLC')).toBe(4_096);
    expect(contextWindowOf('local/bfi/bonsai-8b-q1_0')).toBe(65_536);
  });

  it("prefers the runtime's own live report over the catalog", () => {
    const probes: LocalRuntimeProbe[] = [
      {
        provider: 'ollama',
        endpoint: { baseUrl: 'http://127.0.0.1:11434' },
        reachable: true,
        models: [{ ref: 'local/ollama/qwen3:8b', provider: 'ollama', model: 'qwen3:8b', contextTokens: 8_192 }],
      },
    ];
    expect(contextWindowOf('local/ollama/qwen3:8b', { probes })).toBe(8_192);
    expect(
      contextWindowOf('local/webllm/Qwen3-1.7B-q4f16_1-MLC', {
        models: [{ ref: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', provider: 'webllm', model: 'Qwen3-1.7B-q4f16_1-MLC', contextTokens: 2_048 }],
      }),
    ).toBe(2_048);
  });

  it('is unknown for an unreported local model and for a cloud ref nobody sized', () => {
    expect(contextWindowOf('local/ollama/never-probed')).toBeUndefined();
    expect(contextWindowOf('anthropic/claude-sonnet')).toBeUndefined();
    expect(contextWindowOf(undefined)).toBeUndefined();
  });

  it("answers a cloud ref only from the host's own catalog", () => {
    expect(contextWindowOf('vendor/model-a', { cloud: (ref) => (ref === 'vendor/model-a' ? 32_000 : undefined) })).toBe(32_000);
    expect(contextWindowOf('vendor/model-b', { cloud: () => 0 })).toBeUndefined();
  });
});
