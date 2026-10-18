/**
 * Two projects, the same question: the second must MISS. This is the regression for the
 * global on-device cache, which replayed project A's answer to project B because every
 * project shared one `SemanticCache`. The embedder is a stub that maps a question to a
 * fixed vector, so the two lookups are semantically identical — the partition is the
 * only thing that can make the second one miss.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@seanhogg/builderforce-brain-embedded', async () => {
  const { SemanticCache } = await import('@seanhogg/builderforce-memory');
  const stores = new Map<string | number, InstanceType<typeof SemanticCache>>();
  return {
    loadOnDeviceAnswerStore: (scope: string | number) => {
      let store = stores.get(scope);
      if (!store) {
        store = new SemanticCache({
          // Every question embeds to the SAME vector, so similarity cannot be what
          // separates the projects — only the partition can.
          embed: async () => new Float32Array([1, 0, 0]),
          threshold: 0.985,
        });
        stores.set(scope, store);
      }
      return Promise.resolve(store);
    },
    // The real module's other exports are unused here; satisfy the type surface.
    ON_DEVICE_ANSWER_THRESHOLD: 0.985,
  };
});

import { getOnDeviceAnswerMemory } from './semantic-cache';

beforeEach(async () => {
  vi.resetModules();
});

describe('getOnDeviceAnswerMemory — partitioned by project', () => {
  it('does not replay one project\'s answer to another project asking the same question', async () => {
    const projectA = await getOnDeviceAnswerMemory(11);
    const projectB = await getOnDeviceAnswerMemory(22);
    expect(projectA).not.toBeNull();
    expect(projectB).not.toBeNull();

    await projectA!.store('which tickets are in the backlog?', 'Project A: three tickets.');

    // Identical question, different project → must miss.
    await expect(projectB!.lookup('which tickets are in the backlog?')).resolves.toBeUndefined();
    // Same project → hits.
    const hit = await projectA!.lookup('which tickets are in the backlog?');
    expect(hit?.response).toBe('Project A: three tickets.');
  });

  it('keeps a project\'s store stable across calls, and apart from the unscoped one', async () => {
    const first = await getOnDeviceAnswerMemory(11);
    const again = await getOnDeviceAnswerMemory(11);
    const unscoped = await getOnDeviceAnswerMemory(null);
    expect(again).toBe(first);
    expect(unscoped).not.toBe(first);
  });
});
