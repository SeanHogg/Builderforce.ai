/**
 * The store loader partitions by scope and degrades gracefully. The SSM runtime is
 * stubbed — these tests are about WHICH cache an answer lands in, not about WebGPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created: Array<{ embed: (text: string) => Promise<Float32Array>; threshold: number }> = [];

vi.mock('./pageEngines/webgpu', () => ({ hasWebGPU: () => true }));

vi.mock('@seanhogg/builderforce-memory', () => {
  class SemanticCache {
    constructor(opts: { embed: (text: string) => Promise<Float32Array>; threshold: number }) {
      created.push(opts);
    }
    lookup = vi.fn(async () => undefined);
    store = vi.fn(async () => undefined);
  }
  return {
    SSM: { create: vi.fn(async () => ({ embed: async (text: string) => new Float32Array([text.length]) })) },
    SemanticCache,
  };
});

// Static imports keep vitest's mocks on the loader's graph. Without them the dynamic
// `import('@seanhogg/builderforce-memory')` and the WebGPU check resolve to the real
// modules, and every store comes back null.
import { hasWebGPU } from './pageEngines/webgpu';
import { SSM } from '@seanhogg/builderforce-memory';
import { loadOnDeviceAnswerStore, resetOnDeviceStoresForTests } from './onDeviceStore';

beforeEach(() => {
  expect(hasWebGPU(), 'WebGPU mock did not apply').toBe(true);
  expect(SSM.create, 'memory mock did not apply').toEqual(expect.any(Function));
  created.length = 0;
  resetOnDeviceStoresForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadOnDeviceAnswerStore', () => {
  it('gives each project its own cache, so one project cannot replay another\'s answer', async () => {
    const a = await loadOnDeviceAnswerStore(11);
    const b = await loadOnDeviceAnswerStore(22);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    expect(created).toHaveLength(2);
  });

  it('returns the same store for the same scope — the runtime is not reloaded per question', async () => {
    const first = await loadOnDeviceAnswerStore(11);
    const second = await loadOnDeviceAnswerStore(11);
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it('shares one embedder across scopes — partitioning does not reload the model', async () => {
    await loadOnDeviceAnswerStore(11);
    await loadOnDeviceAnswerStore(22);
    expect(SSM.create).toHaveBeenCalledTimes(1);
    // Both caches were handed the SAME embed function.
    expect(created[0].embed).toBe(created[1].embed);
  });

  it('holds every cache to the near-identity threshold, not the paraphrase one', async () => {
    const { ON_DEVICE_ANSWER_THRESHOLD } = await import('./onDeviceMemory');
    await loadOnDeviceAnswerStore('web:unscoped');
    expect(created[0].threshold).toBe(ON_DEVICE_ANSWER_THRESHOLD);
    expect(created[0].threshold).toBeGreaterThan(0.92);
  });

  it('retries the same project after a failed load rather than disabling the tier', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(SSM.create).mockRejectedValueOnce(new Error('WebGPU died'));
    await expect(loadOnDeviceAnswerStore(11)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    // The failure must not poison this project: the next question retries the embedder.
    await expect(loadOnDeviceAnswerStore(11)).resolves.not.toBeNull();
    expect(SSM.create).toHaveBeenCalledTimes(2);
  });
});
