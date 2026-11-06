/**
 * The browser half of the portable-pack seam (PRD 40, "The seam: pack registry → retrieval
 * port"): an uploaded pack is a knowledge root of the project (`pack:` host segment), so the
 * browser's registry is the project's scopes of `kind === 'pack'` and its retrieval port is
 * the SAME `packRetrievalPort` over `searchRecall` — the platform's search plus one graph hop
 * per pack root. No second merge, no second retrieval: `withPacks` composes them with the
 * host's own recall.
 */

import {
  packRetrievalPort, searchRecall,
  type KnowledgePackEntry, type PackRegistry, type PackRetrievalPort,
} from '@builderforce/agent-tools/knowledge-index';
import type { KnowledgeClient, KnowledgeScopeRecord } from '@builderforce/knowledge-client';

/** The slice of the knowledge client the pack seam reads. */
export type PackClient = Pick<KnowledgeClient, 'scopes' | 'search' | 'graph'>;

const entryOf = (scope: KnowledgeScopeRecord): KnowledgePackEntry => ({
  name: scope.rootId,
  rootId: scope.rootId,
  title: scope.title || scope.rootId,
  loadedAt: scope.lastReviewedAt ?? '',
  ...(scope.provenance ? { provenance: scope.provenance } : {}),
});

/** Every pack uploaded to the project the client is bound to (its scopes of kind `pack`). */
export function browserPackRegistry(client: Pick<KnowledgeClient, 'scopes'>): PackRegistry {
  return {
    async list() {
      return (await client.scopes()).filter((s) => s.kind === 'pack').map(entryOf);
    },
  };
}

/** The packs `selected` (root ids) out of `registry` — what an Evermind that chose its packs retrieves from. */
export function selectedPackRegistry(registry: PackRegistry, selected: readonly string[]): PackRegistry {
  const wanted = new Set(selected);
  return { list: async () => (await registry.list()).filter((e) => wanted.has(e.rootId)) };
}

/** The retrieval port over the platform: search + one graph hop per pack root, merged by `mergeRecalls`. */
export function browserPackRetrieval(client: Pick<KnowledgeClient, 'search' | 'graph'>): PackRetrievalPort {
  return packRetrievalPort({
    indexOf: (rootId) => searchRecall({
      search: (q, k) => client.search(rootId, q, k),
      graph: (focus) => client.graph(rootId, { focus }),
    }),
  });
}
