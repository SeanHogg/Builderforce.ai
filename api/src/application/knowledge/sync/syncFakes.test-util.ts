/**
 * In-memory ports for the pack-sync tests: a knowledge store, a ledger (bundle index + source rows), an extracted
 * cache over real bundle bytes, the sync state/staging port, and a transaction that really rolls back. The R2
 * writes and index queries are COUNTED, so the bounds of PRD 41 A11 rule 4a are assertions, not hopes.
 */
import { sha256Hex, type Extracted, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { Db } from '../../../infrastructure/database/connection';
import type { Bundle } from '../knowledgeBundles';
import type { ExtractedLoc, KnowledgeLedgerPort, SourceRow } from '../knowledgeLedger';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import type { PackUnit } from './applyKnowledgePack';
import type { KnowledgeSyncPort, SyncState } from './knowledgeSyncPorts';

export interface World {
  facts: Map<string, StoredFact>;
  relations: Map<string, StoredRelation>;
  /** source id → row (rows are the record; `legacy` holds per-source objects written before the ledger). */
  sources: Map<string, SourceRow>;
  legacySources: Map<string, SourceRow>;
  index: Map<string, ExtractedLoc>;
  bundles: Map<string, Uint8Array>;
  /** Per-hash objects written before bundles existed. */
  legacyBodies: Map<string, Extracted[]>;
  state: Map<string, SyncState>;
  staged: Map<string, Uint8Array>;
  stale: string[];
  deletedFacts: string[];
  /** Every R2 object write, by what it was. */
  puts: string[];
  /** Every ranged/whole object read of a bundle. */
  bundleReads: number;
  /** Index queries (`locate`). */
  indexQueries: number;
}

export const newWorld = (): World => ({
  facts: new Map(), relations: new Map(), sources: new Map(), legacySources: new Map(), index: new Map(), bundles: new Map(), legacyBodies: new Map(),
  state: new Map(), staged: new Map(), stale: [], deletedFacts: [], puts: [], bundleReads: 0, indexQueries: 0,
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
    markRelationsStaleMany: async (marks) => { for (const m of marks) w.stale.push(`${m.sourceRef}@${m.currentHash}`); return 0; },
    deleteRelationsOf: async () => 0,
    deleteScope: async () => false,
    factSources: async () => new Map(),
    deleteFactsBySource: async () => ({ keys: [], relations: 0 }),
    humanRelationKeys: async () => new Set(),
    deleteRelationsUnder: async () => 0,
    factAuthor: async (key) => (w.facts.has(key) ? null : undefined),
    factAuthors: async (keys) => new Map(keys.filter((k) => w.facts.has(k)).map((k) => [k, null] as const)),
    deleteRelationRows: async (rows) => { let n = 0; for (const r of rows) if (w.relations.delete(rkey(r))) n += 1; return n; },
  };
}

export function fakeLedger(w: World): KnowledgeLedgerPort {
  return {
    index: {
      locate: async (hashes) => { w.indexQueries += 1; return hashes.flatMap((h) => (w.index.has(h) ? [w.index.get(h)!] : [])); },
      upsert: async (rows) => { for (const r of rows) w.index.set(r.hash, r); },
    },
    sources: {
      list: async () => [...w.sources.values()],
      upsert: async (_root, rows) => { for (const r of rows) w.sources.set(r.sourceId, r); },
      remove: async (_root, ids) => { for (const id of ids) w.sources.delete(id); },
      clear: async () => { const n = w.sources.size; w.sources.clear(); return n; },
    },
  };
}

/** The body at an index location, read from real bundle bytes (a ranged read). */
function bodyAt(w: World, loc: ExtractedLoc): Extracted[] | undefined {
  const bytes = w.bundles.get(loc.bundleKey);
  if (!bytes) return undefined;
  w.bundleReads += 1;
  return JSON.parse(new TextDecoder().decode(bytes.subarray(loc.byteOffset, loc.byteOffset + loc.byteLength))) as Extracted[];
}

export function fakeExtracted(w: World): ExtractedCachePort {
  return {
    get: async (hash) => {
      const loc = w.index.get(hash);
      return (loc ? bodyAt(w, loc) : undefined) ?? w.legacyBodies.get(hash);
    },
    put: async (hash, extracted) => { w.puts.push('legacy-body'); w.legacyBodies.set(hash, [...extracted]); },
    setSource: async (ref, hash) => {
      const path = ref.slice(ref.indexOf('::') + 2);
      if (hash) w.sources.set(path, { sourceId: path, path, hash }); else w.sources.delete(path);
    },
    rootExtracted: async () => [], deleteRootSources: async () => 0, snapshotReview: async () => undefined, reviewExtracted: async () => null,
  };
}

export function fakeSync(w: World): KnowledgeSyncPort {
  const all = (): Array<{ path: string; hash: string }> => {
    const byId = new Map([...w.legacySources, ...w.sources]);
    return [...byId.values()].map((r) => ({ path: r.path, hash: r.hash }));
  };
  return {
    state: async (root) => w.state.get(root) ?? { generation: 0, digest: '' },
    saveState: async (root, s) => { w.puts.push('sync.json'); w.state.set(root, s); },
    sources: async () => all(),
    heldBodies: async (hashes) => {
      w.indexQueries += 1;
      return new Map(hashes.flatMap((h) => (w.index.has(h) ? [[h, w.index.get(h)!.sourceRefs] as const] : [])));
    },
    putBundle: async (bundle: Bundle) => { w.puts.push('bundle'); w.bundles.set(bundle.key, bundle.bytes); },
    snapshotReview: async (root, digest) => { w.puts.push(`snapshot:${root}:${digest}`); },
    stagePart: async (id, part, bytes) => { w.puts.push('stage'); w.staged.set(`${id}/${part}`, bytes); },
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

/** A transaction over the world: what `work` wrote is kept when it resolves and restored when it throws. */
export function atomically(w: World) {
  return async <T>(work: (unit: PackUnit) => Promise<T>): Promise<T> => {
    const saved = {
      facts: new Map(w.facts), relations: new Map(w.relations), sources: new Map(w.sources), index: new Map(w.index), stale: [...w.stale],
    };
    try {
      return await work({ db: {} as Db, store: fakeStore(w), ledger: fakeLedger(w) });
    } catch (error) {
      w.facts = saved.facts; w.relations = saved.relations; w.sources = saved.sources; w.index = saved.index; w.stale = saved.stale;
      throw error;
    }
  };
}

export { sha256Hex };
