import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LAST_SEEN_MAX_GRAPHS, clearLastSeenMemory, lastSeenMemory } from './lastSeen';

const graph = (rootId: string): KnowledgeGraph => ({
  scope: { rootId, packs: ['code'], digest: 'd' }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
});

describe('lastSeenMemory', () => {
  it('remembers the last FULL load per project, with the scopes listed', async () => {
    const m = lastSeenMemory(9001);
    expect(await m.read()).toBeNull();
    const scopes = [{ rootId: 'r1', title: 'One', packs: ['code'] }];
    m.scopes(scopes);
    m.loaded('r1', graph('r1'), false);
    expect(await lastSeenMemory(9001).read()).toEqual({ scopes, rootId: 'r1', graph: graph('r1') });
  });

  it('keeps at most 8 graphs (least recently used out) and can be cleared', async () => {
    for (let i = 0; i < LAST_SEEN_MAX_GRAPHS + 3; i += 1) lastSeenMemory(100 + i).loaded(`r${i}`, graph(`r${i}`), false);
    expect(await lastSeenMemory(100).read()).toBeNull(); // the oldest were evicted
    expect(await lastSeenMemory(100 + LAST_SEEN_MAX_GRAPHS + 2).read()).not.toBeNull();
    clearLastSeenMemory();
    expect(await lastSeenMemory(100 + LAST_SEEN_MAX_GRAPHS + 2).read()).toBeNull();
  });

  it('ignores a focused load and a missing graph, and never crosses projects', async () => {
    const m = lastSeenMemory(9002);
    m.loaded('r1', graph('r1'), true);
    m.loaded('r2', null, false);
    expect(await m.read()).toBeNull();
    m.loaded('r3', graph('r3'), false);
    expect((await m.read())?.rootId).toBe('r3');
    expect(await lastSeenMemory(9003).read()).toBeNull();
  });
});
