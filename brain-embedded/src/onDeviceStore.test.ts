/**
 * The store loader partitions by scope and degrades gracefully. The SSM runtime is
 * stubbed — these tests are about WHICH cache an answer lands in, not about WebGPU.
 *
 * WebGPU presence is faked by defining `navigator.gpu`, the same signal `hasWebGPU()`
 * reads at call time, rather than a relative-path `vi.mock`. The relative-path mock of
 * `./pageEngines/webgpu` stopped intercepting the static import (vitest 4 resolves the
 * aliased drive-letter path differently from the test's relative specifier), so the real
 * module — which reports `false` under jsdom — leaked in and every store came back null.
 * Stubbing the global keeps the seam on the public `hasWebGPU()` contract instead of the
 * module graph, which is what these tests actually exercise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created: Array<{ embed: (text: string) => Promise<Float32Array>; threshold: number }> = [];

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

// The static import keeps vitest's mock of `@seanhogg/builderforce-memory` on the loader's
// graph; without it the dynamic `import('@seanhogg/builderforce-memory')` in the store
// resolves to the real module and every store comes back null. WebGPU presence is provided
// by the `navigator.gpu` stub in beforeEach instead — see the note at the top of the file.
import { SSM } from '@seanhogg/builderforce-memory';
import { loadOnDeviceAnswerStore, resetOnDeviceStoresForTests } from './onDeviceStore';

beforeEach(() => {
  // Pretend this page has WebGPU: `hasWebGPU()` is `navigator.gpu != null`, read at call
  // time, so defining the global is enough and needs no module mock.
  vi.stubGlobal('navigator', { ...navigator, gpu: {} });
  expect(globalThis.navigator?.gpu, 'WebGPU stub did not apply').toBeTruthy();
  expect(SSM.create, 'memory mock did not apply').toEqual(expect.any(Function));
  created.length = 0;
  resetOnDeviceStoresForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
