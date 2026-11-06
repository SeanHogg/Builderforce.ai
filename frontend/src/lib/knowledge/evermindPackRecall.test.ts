import { describe, expect, it, vi } from 'vitest';
import type { EvermindRecallResult } from '@seanhogg/builderforce-brain-embedded';
import { selectedPacksForProject, selectedPacksOf, withEvermindPacks } from './evermindPackRecall';

const PACK = 'pack:docs';
const memory: EvermindRecallResult = { seeded: true, version: 3, mode: 'connected', items: [{ id: 7, text: 'learned', score: 0.9 }] };

function client() {
  return {
    scopes: vi.fn(async () => [
      { rootId: PACK, title: 'Docs', packs: [], kind: 'pack' as const },
      { rootId: 'pack:other', title: 'Other', packs: [], kind: 'pack' as const },
    ]),
    search: vi.fn(async (root: string) => (root === PACK ? [{ id: `src:${PACK}::a.md`, score: 0.7, tier: 'lexical' as const }] : [])),
    graph: vi.fn(async () => null),
  };
}

describe('Evermind pack recall', () => {
  it('reads the selected packs tolerantly', () => {
    expect(selectedPacksOf({ knowledgePacks: [PACK, 3, ''] })).toEqual([PACK]);
    expect(selectedPacksOf({})).toEqual([]);
  });

  it('collects the packs of the project’s Evermind nodes only', () => {
    const nodes = [
      { data: { kind: 'evermind', resourceId: 'evermind:5', knowledgePacks: [PACK] } },
      { data: { kind: 'evermind', resourceId: 'evermind:6', knowledgePacks: ['pack:x'] } },
      { data: { kind: 'note', resourceId: 'evermind:5', knowledgePacks: ['pack:y'] } },
    ];
    expect(selectedPacksForProject(nodes, 5)).toEqual([PACK]);
  });

  it('returns the base recall untouched when no pack is selected', async () => {
    const base = vi.fn(async () => memory);
    const c = client();
    expect(await withEvermindPacks(base, { client: c, selected: [] })('q')).toBe(memory);
    expect(c.search).not.toHaveBeenCalled();
  });

  it('appends the selected packs’ cards to the memories, and only the selected ones are searched', async () => {
    const c = client();
    const out = await withEvermindPacks(async () => memory, { client: c, selected: [PACK] })('termination');
    expect(out?.items[0]).toEqual(memory.items[0]);
    expect(out?.items).toHaveLength(2);
    expect(out?.items[1]).toMatchObject({ id: -1, score: 0.7 });
    expect(out?.version).toBe(3);
    expect(c.search).toHaveBeenCalledTimes(1);
    expect(c.search).toHaveBeenCalledWith(PACK, 'termination', 6);
  });

  it('answers from the packs alone when the memory recall is unavailable', async () => {
    const out = await withEvermindPacks(async () => null, { client: client(), selected: [PACK] })('q');
    expect(out).toMatchObject({ seeded: false, mode: 'connected' });
    expect(out?.items).toHaveLength(1);
  });
});
