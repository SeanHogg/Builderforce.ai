/** In-memory ports for the pack-sync tests: a knowledge store, an extracted cache and the sync state/staging port. */
import type { Extracted, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import type { KnowledgeSyncPort, SyncState } from './knowledgeSyncPorts';

export interface World {
  facts: Map<string, StoredFact>;
  relations: Map<string, StoredRelation>;
  sources: Map<string, string>;
  bodies: Map<string, Extracted[]>;
  state: Map<string, SyncState>;
  staged: Map<string, Uint8Array>;
  stale: string[];
  deletedFacts: string[];
}

export const newWorld = (): World => ({
  facts: new Map(), relations: new Map(), sources: new Map(), bodies: new Map(), state: new Map(), staged: new Map(), stale: [], deletedFacts: [],
});

const rkey = (r: { from: string; to: string; kind: string }): string => `${r.from}\u0000${r.to}\u0000${r.kind}`;

export function fakeStore(w: World): KnowledgeStorePort {
  return {
    scopes: async () => [], scope: async () => null,
    facts: async (paths) => [...w.facts.values()].filter((f) => f.fileAnchors.some((a) => paths.has(a.path))),
    relations: async (root, refs) => [...w.relations.values()].filter((r) =>
      r.from.startsWith(`src:${root}::`) || r.to.startsWith(`src:${root}::`) || refs.has(r.from) || refs.has(r.to)),
    upsertRelations: async (rows) => { for (const r of rows) w.relations.set(rkey(r), r); return rows.length; },
    upsertScope: async () => undefined,
    markRelationsStale: async (ref, hash) => { w.stale.push(`${ref}@${hash}`); return 0; },
    deleteRelationsOf: async () => 0,
    deleteScope: async () => false,
    factSources: async () => new Map(),
    deleteFactsBySource: async () => ({ keys: [], relations: 0 }),
    humanRelationKeys: async () => new Set(),
    deleteRelationsUnder: async () => 0,
    factAuthor: async (key) => (w.facts.has(key) ? null : undefined),
    deleteRelationRows: async (rows) => { let n = 0; for (const r of rows) if (w.relations.delete(rkey(r))) n += 1; return n; },
  };
}

export function fakeExtracted(w: World): ExtractedCachePort {
  return {
    get: async (hash) => w.bodies.get(hash),
    put: async (hash, extracted) => { w.bodies.set(hash, [...extracted]); },
    setSource: async (ref, hash) => {
      const path = ref.slice(ref.indexOf('::') + 2);
      if (hash) w.sources.set(path, hash); else w.sources.delete(path);
    },
    rootExtracted: async () => [], deleteRootSources: async () => 0, snapshotReview: async () => undefined, reviewExtracted: async () => null,
  };
}

export function fakeSync(w: World): KnowledgeSyncPort {
  return {
    state: async (root) => w.state.get(root) ?? { generation: 0, digest: '' },
    saveState: async (root, s) => { w.state.set(root, s); },
    sources: async () => [...w.sources].map(([path, hash]) => ({ path, hash })),
    hasExtracted: async (hashes) => hashes.map((h) => w.bodies.has(h)),
    stagePart: async (id, part, bytes) => { w.staged.set(`${id}/${part}`, bytes); },
    stagedParts: async (id, parts) => {
      const out: Uint8Array[] = [];
      for (let i = 0; i < parts; i++) { const b = w.staged.get(`${id}/${i}`); if (!b) return null; out.push(b); }
      return out;
    },
    dropStaged: async (id) => { for (const k of [...w.staged.keys()]) if (k.startsWith(`${id}/`)) w.staged.delete(k); },
    sweepStaged: async () => undefined,
    clearRoot: async (root) => { w.state.delete(root); },
  };
}
