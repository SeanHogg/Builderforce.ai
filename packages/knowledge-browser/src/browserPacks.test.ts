import { describe, expect, it, vi } from 'vitest';
import { withPacks } from '@builderforce/agent-tools/knowledge-index';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import { browserPackRegistry, browserPackRetrieval, selectedPackRegistry } from './browserPacks';

const PACK = 'pack:docs';
const OTHER_PACK = 'pack:legal';

function fakeClient(): Pick<KnowledgeClient, 'scopes' | 'search' | 'graph'> {
  return {
    scopes: vi.fn(async () => [
      { rootId: 'web:vfs:7', title: 'Workspace', packs: ['code'], kind: 'review' as const },
      { rootId: PACK, title: 'Docs pack', packs: [], kind: 'pack' as const, lastReviewedAt: '2026-11-01T00:00:00Z', provenance: { reviewedBy: 'Ada' } },
      { rootId: OTHER_PACK, title: 'Legal', packs: [], kind: 'pack' as const },
    ]),
    search: vi.fn(async (root: string) => (root === PACK ? [{ id: `src:${PACK}::a.md`, score: 0.8, tier: 'lexical' as const }] : [])),
    graph: vi.fn(async () => null),
  };
}

describe('browser pack seam', () => {
  it('lists only the project’s pack scopes', async () => {
    const entries = await browserPackRegistry(fakeClient()).list();
    expect(entries.map((e) => e.rootId)).toEqual([PACK, OTHER_PACK]);
    expect(entries[0]).toMatchObject({ title: 'Docs pack', loadedAt: '2026-11-01T00:00:00Z', provenance: { reviewedBy: 'Ada' } });
    expect(entries[1]).not.toHaveProperty('provenance');
  });

  it('narrows the registry to the selected root ids', async () => {
    const selected = selectedPackRegistry(browserPackRegistry(fakeClient()), [OTHER_PACK, 'pack:gone']);
    expect((await selected.list()).map((e) => e.rootId)).toEqual([OTHER_PACK]);
  });

  it('retrieves from each pack root through search + graph', async () => {
    const client = fakeClient();
    const recall = await browserPackRetrieval(client).recall([PACK, OTHER_PACK], 'termination');
    expect(recall.hits.map((h) => h.id)).toEqual([`src:${PACK}::a.md`]);
    expect(client.search).toHaveBeenCalledWith(PACK, 'termination', 8);
    expect(client.search).toHaveBeenCalledWith(OTHER_PACK, 'termination', 8);
  });

  it('composes with withPacks: the selected packs answer when there is no primary index', async () => {
    const client = fakeClient();
    const index = withPacks(undefined, selectedPackRegistry(browserPackRegistry(client), [PACK]), browserPackRetrieval(client));
    const recall = await index.recall('termination');
    expect(recall.hits).toHaveLength(1);
    expect(client.search).not.toHaveBeenCalledWith(OTHER_PACK, expect.anything(), expect.anything());
  });
});
