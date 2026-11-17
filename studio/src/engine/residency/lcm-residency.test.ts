import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProbedDevice } from '../device-router';
import { LcmResidency } from './lcm-residency';

/**
 * Without a distinct refinement model there is nothing to warm: no weight-store
 * reads, no downloads, and no engine is routed through a prefetcher.
 */

const store = vi.hoisted(() => ({
  has: vi.fn(async (_key: string) => true),
  canPersist: vi.fn(() => true),
  load: vi.fn(async () => new ArrayBuffer(1)),
}));
/** Options every DiffusionEngine was constructed with. */
const constructed = vi.hoisted((): Array<Record<string, unknown>> => []);

vi.mock('./weight-store', () => ({
  weightStore: () => ({ has: store.has, canPersist: store.canPersist }),
}));
vi.mock('../weight-cache', () => ({ getOrFetchWeight: store.load }));
vi.mock('../diffusion-engine', () => ({
  DiffusionEngine: class {
    constructor(opts: Record<string, unknown>) {
      constructed.push(opts);
    }
  },
}));

const PROBED: ProbedDevice = { kind: 'cpu', label: 'test', approxMemoryMb: null };
const SOURCE = { apiKey: 'k', weightSources: ['huggingface-cdn' as const] };
const VIEW = { width: 512, height: 512 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  store.has.mockClear();
  store.load.mockClear();
  constructed.length = 0;
});

describe('LcmResidency', () => {
  it.each([
    ['no refinement model', undefined],
    ['refinement === model', 'lcm-tiny-sd' as const],
  ])('%s ⇒ no warm and no prefetcher on the draft engine', async (_label, refinementModel) => {
    const residency = new LcmResidency({ ...SOURCE, probed: PROBED, model: 'lcm-tiny-sd', refinementModel });
    residency.createEngine('lcm-tiny-sd', VIEW);
    residency.prefetchRefinement();
    await tick();

    expect(store.has).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
    expect(constructed).toHaveLength(1);
    expect(constructed[0]!.weightPrefetch).toBeUndefined();
    residency.dispose();
  });

  it('routes only the refinement engine through the prefetcher, and warms while idle', async () => {
    const residency = new LcmResidency({
      ...SOURCE,
      probed: PROBED,
      model: 'lcm-tiny-sd',
      refinementModel: 'lcm-dreamshaper-v7',
    });
    residency.createEngine('lcm-tiny-sd', VIEW);
    residency.createEngine('lcm-dreamshaper-v7', VIEW);
    expect(constructed[0]!.weightPrefetch).toBeUndefined();
    expect(constructed[1]!.weightPrefetch).toBeDefined();

    residency.prefetchRefinement();
    await vi.waitFor(() => expect(store.has).toHaveBeenCalled());
    residency.dispose();
  });
});
