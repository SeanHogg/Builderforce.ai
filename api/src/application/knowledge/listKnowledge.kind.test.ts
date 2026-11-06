/**
 * The scopes list marks each root `kind: 'pack' | 'review'` — computed from the root id's
 * host segment (`isPackRootId`), never stored.
 */
import { describe, expect, it, vi } from 'vitest';
import { listKnowledgeScopes, scopeKindOf } from './listKnowledge';
import type { KnowledgeStorePort } from './knowledgePorts';

describe('scope kind', () => {
  it('derives pack vs review from the root id', () => {
    expect(scopeKindOf('pack:my-docs')).toBe('pack');
    expect(scopeKindOf('vscode:github.com/acme/app')).toBe('review');
    expect(scopeKindOf('web:pack:x')).toBe('review');
  });

  it('returns a pack scope’s provenance', async () => {
    const provenance = { reviewedBy: 'Ada', judgeModel: 'm' };
    const store = { scopes: vi.fn(async () => [{ rootId: 'pack:docs-1', title: 'Docs', packs: [], provenance }]) } as unknown as KnowledgeStorePort;
    const [scope] = await listKnowledgeScopes({ cacheEnv: undefined, tenantId: 5, projectId: 11, store, version: async () => 'prov-v1' });
    expect(scope).toMatchObject({ kind: 'pack', provenance });
  });

  it('lists every scope with its kind', async () => {
    const scopes = [
      { rootId: 'pack:docs', title: 'Docs', packs: [] },
      { rootId: 'web:folder-1', title: 'Folder', packs: ['docs'] },
    ];
    const store = { scopes: vi.fn(async () => scopes) } as unknown as KnowledgeStorePort;
    const out = await listKnowledgeScopes({
      cacheEnv: undefined, tenantId: 5, projectId: 11, store, version: async () => 'kind-v1',
    });
    expect(out.map((s) => [s.rootId, s.kind])).toEqual([['pack:docs', 'pack'], ['web:folder-1', 'review']]);
  });
});
