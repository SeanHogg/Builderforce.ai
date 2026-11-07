/**
 * In-memory ports for the pack-sync tests: a knowledge store, a ledger (bundle index, source rows, sync leaves,
 * generations), an extracted cache over real bundle bytes, the sync staging port, and a transaction that really rolls
 * back. R2 writes and index queries are COUNTED, so the bounds of PRD 41 A11 rules 4a-4b are assertions, not hopes.
 *
 * `facts` and `relations` are the PROJECT's shared tables; `leaves` are per root — the server's manifest reads only
 * the leaves, which is exactly what two roots sharing a project rely on.
 */
import { type Extracted, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { bucketDigest, bucketOf, MANIFEST_BUCKETS, relationLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Db } from '../../../infrastructure/database/connection';
import { reportedFallback } from '../../observability/caughtErrorReporter';
import type { Bundle } from '../knowledgeBundles';
import type { ExtractedLoc, KnowledgeLedgerPort, SourceRow } from '../knowledgeLedger';
import type { ExtractedCachePort, KnowledgeStorePort } from '../knowledgePorts';
import { storeMock } from '../knowledgeStoreMock.test-util';
import type { PackUnit } from './applyKnowledgePack';
import { KnowledgeSyncError, type KnowledgeSyncPort, type SyncState } from './knowledgeSyncPorts';

export interface World {
  facts: Map<string, StoredFact & { createdBy?: string | null }>;
  relations: Map<string, StoredRelation>;
  /** root → source id → row (the record; `legacySources` holds per-source objects written before the ledger). */
  sources: Map<string, Map<string, SourceRow>>;
  legacySources: Map<string, Map<string, SourceRow>>;
  /** Legacy per-source objects deleted by a sync, by source id. */
  legacyDeleted: string[];
  index: Map<string, ExtractedLoc>;
  bundles: Map<string, Uint8Array>;
  /** Per-hash objects written before bundles existed. */
  legacyBodies: Map<string, Extracted[]>;
  /** root → leaf key → digest. */
  leaves: Map<string, Map<string, string>>;
  /** root → bucket → digest (the buckets table; an absent bucket is empty). */
  buckets: Map<string, Map<number, string>>;
  /** root → generation and digest (the roots table). */
  roots: Map<string, SyncState>;
  staged: Map<string, Uint8Array>;
  stale: string[];
  /** Every R2 object write, by what it was. */
  puts: string[];
  /** Every ranged/whole object read of a bundle. */
  bundleReads: number;
  /** Index queries (`locate`). */
  indexQueries: number;
  /** Rows read from the shared fact / relation tables (a manifest must never do this). */
  sharedTableReads: number;
  /** Serialises transactions, as row locks do: a second pack waits for the first to commit or roll back. */
  txChain?: Promise<unknown>;
}

export const newWorld = (): World => ({
  facts: new Map(), relations: new Map(), sources: new Map(), legacySources: new Map(), legacyDeleted: [], index: new Map(), bundles: new Map(),
  legacyBodies: new Map(), leaves: new Map(), buckets: new Map(), roots: new Map(), staged: new Map(), stale: [], puts: [], bundleReads: 0, indexQueries: 0, sharedTableReads: 0,
});

const inner = <V>(m: Map<string, Map<string, V>>, root: string): Map<string, V> => {
  let x = m.get(root);
  if (!x) { x = new Map(); m.set(root, x); }
  return x;
};

export function fakeStore(w: World): KnowledgeStorePort {
  return storeMock({
    facts: async (paths) => { w.sharedTableReads += 1; return [...w.facts.values()].filter((f) => f.fileAnchors.some((a) => paths.has(a.path))); },
    relations: async () => { w.sharedTableReads += 1; return [...w.relations.values()]; },
    upsertRelations: async (rows) => { for (const r of rows) w.relations.set(relationLeafKey(r), r); return rows.length; },
    markRelationsStale: async (ref, hash) => { w.stale.push(`${ref}@${hash}`); return 0; },
    markRelationsStaleMany: async (marks) => { for (const m of marks) w.stale.push(`${m.sourceRef}@${m.currentHash}`); return 0; },
    factAuthor: async (key) => (w.facts.has(key) ? (w.facts.get(key)!.createdBy ?? null) : undefined),
    factAuthors: async (keys) => new Map(keys.filter((k) => w.facts.has(k)).map((k) => [k, w.facts.get(k)!.createdBy ?? null] as const)),
    deleteRelationRows: async (rows) => { let n = 0; for (const r of rows) if (w.relations.delete(relationLeafKey(r))) n += 1; return n; },
    relationsTouching: async (refs) => [...w.relations.values()].filter((r) => refs.includes(r.from) || refs.includes(r.to)),
    deleteFactsByKeys: async (keys, actor) => {
      const gone: string[] = [];
      for (const k of keys) {
        const f = w.facts.get(k);
        if (f && (f.createdBy == null || f.createdBy === actor.userId || actor.admin)) { w.facts.delete(k); gone.push(k); }
      }
      return gone;
    },
  });
}

export function fakeLedger(w: World): KnowledgeLedgerPort {
  const ledger: KnowledgeLedgerPort = {
    index: {
      locate: async (hashes) => { w.indexQueries += 1; return hashes.flatMap((h) => (w.index.has(h) ? [w.index.get(h)!] : [])); },
      holds: async (pairs) => {
        w.indexQueries += 1;
        return new Set(pairs.flatMap((p, i) => (w.index.get(p.hash)?.sourceRefs.includes(p.sourceRef) ? [i] : [])));
      },
      upsert: async (rows, expected) => {
        let n = 0;
        for (const r of rows) {
          if (expected && (w.index.get(r.hash)?.bundleKey ?? null) !== (expected.get(r.hash) ?? null)) continue;
          w.index.set(r.hash, r);
          n += 1;
        }
        return n;
      },
      drop: async (hashes) => { for (const h of hashes) w.index.delete(h); },
      dropBundles: async (keys) => { for (const [h, l] of [...w.index]) if (keys.includes(l.bundleKey)) w.index.delete(h); },
    },
    sources: {
      list: async (root) => [...inner(w.sources, root).values()],
      upsert: async (root, rows) => { for (const r of rows) inner(w.sources, root).set(r.sourceId, r); },
      mark: async (root, ids) => { for (const id of ids) inner(w.sources, root).set(id, { sourceId: id, path: '', hash: '' }); },
      markers: async (limit) => [...w.sources].flatMap(([rootId, m]) => [...m.values()].filter((r) => r.hash === '').map((r) => ({ rootId, sourceId: r.sourceId }))).slice(0, limit),
      dropMarkers: async (markers) => { for (const m of markers) if (inner(w.sources, m.rootId).get(m.sourceId)?.hash === '') inner(w.sources, m.rootId).delete(m.sourceId); },
      clear: async (root) => { const n = inner(w.sources, root).size; w.sources.delete(root); return n; },
    },
    leaves: {
      all: async (root) => [...inner(w.leaves, root)].map(([key, digest]) => ({ key, digest })).sort((a, b) => (a.key < b.key ? -1 : 1)),
      inBuckets: async (root, buckets) => [...inner(w.leaves, root)].filter(([key]) => buckets.includes(bucketOf(key))).map(([key, digest]) => ({ key, digest })),
      any: async (root) => inner(w.leaves, root).size > 0,
      upsert: async (root, rows) => { for (const r of rows) inner(w.leaves, root).set(r.key, r.digest); },
      remove: async (root, keys) => { for (const k of keys) inner(w.leaves, root).delete(k); },
      existing: async (root, keys) => new Set(keys.filter((k) => inner(w.leaves, root).has(k))),
      namedByOthers: async (root, keys) => new Set(keys.filter((k) => [...w.leaves].some(([r, m]) => r !== root && m.has(k)))),
      fillBuckets: async () => 0,
      clear: async (root) => { const n = inner(w.leaves, root).size; w.leaves.delete(root); return n; },
    },
    buckets: {
      digests: async (root) => {
        const out: string[] = new Array(MANIFEST_BUCKETS).fill(bucketDigest([]));
        for (const [b, d] of inner(w.buckets, root)) out[b] = d;
        return out;
      },
      has: async (root) => inner(w.buckets, root).size > 0,
      put: async (root, rows) => { for (const r of rows) { if (r.digest === bucketDigest([])) inner(w.buckets, root).delete(r.bucket); else inner(w.buckets, root).set(r.bucket, r.digest); } },
      clear: async (root) => { w.buckets.delete(root); },
    },
    roots: {
      get: async (root) => w.roots.get(root) ?? null,
      seed: async (root, row) => { if (!w.roots.has(root)) w.roots.set(root, row); },
      advance: async (root, base, digest) => {
        const cur = w.roots.get(root);
        if (base === 0 ? cur !== undefined : cur?.generation !== base) return null;
        const next = { generation: (cur?.generation ?? 0) + 1, digest };
        w.roots.set(root, next);
        return next.generation;
      },
      clear: async (root) => { w.roots.delete(root); },
    },
    // The world's transactions are already serialised (`txChain`), which is what the advisory lock does in Postgres.
    lock: async () => undefined,
    exclusive: (work) => work(ledger),
  };
  return ledger;
}

/** The body at an index location, read from real bundle bytes (a ranged read). */
function bodyAt(w: World, loc: ExtractedLoc): Extracted[] | undefined {
  const bytes = w.bundles.get(loc.bundleKey);
  if (!bytes) return undefined;
  w.bundleReads += 1;
  return JSON.parse(new TextDecoder().decode(bytes.subarray(loc.byteOffset, loc.byteOffset + loc.byteLength))) as Extracted[];
}

export function fakeExtracted(w: World): ExtractedCachePort {
  const get = async (hash: string): Promise<Extracted[] | undefined> => {
    const loc = w.index.get(hash);
    return (loc ? bodyAt(w, loc) : undefined) ?? w.legacyBodies.get(hash);
  };
  return {
    get,
    getMany: async (hashes) => {
      const out = new Map<string, Extracted[]>();
      for (const h of hashes) { const body = await get(h); if (body) out.set(h, body); }
      return out;
    },
    put: async (hash, extracted) => { w.puts.push('legacy-body'); w.legacyBodies.set(hash, [...extracted]); },
    setSource: async () => undefined,
    rootExtracted: async () => [], deleteRootSources: async () => 0, snapshotReview: async () => undefined, reviewExtracted: async () => null,
  };
}

export function fakeSync(w: World): KnowledgeSyncPort {
  const all = (root: string): Array<{ path: string; hash: string }> => {
    const byId = new Map([...inner(w.legacySources, root), ...inner(w.sources, root)]);
    return [...byId.values()].map((r) => ({ path: r.path, hash: r.hash }));
  };
  const stageKey = (actor: string, id: string, part: number): string => `${actor}/${id}/${part}`;
  return {
    state: async (root) => w.roots.get(root) ?? { generation: 0, digest: '' },
    sources: async (root) => all(root),
    heldEntries: async (pairs) => fakeLedger(w).index.holds(pairs),
    putBundle: async (bundle: Bundle) => { w.puts.push('bundle'); w.bundles.set(bundle.key, bundle.bytes); },
    snapshotReview: async (root, digest) => { w.puts.push(`snapshot:${root}:${digest}`); },
    stagePart: async (actor, id, part, bytes) => { w.puts.push('stage'); w.staged.set(stageKey(actor, id, part), bytes); },
    stagedParts: async (actor, id, parts, maxBytes) => {
      const out: Uint8Array[] = [];
      let total = 0;
      for (let i = 0; i < parts; i++) {
        const b = w.staged.get(stageKey(actor, id, i));
        if (!b) return null;
        total += b.length;
        if (total > maxBytes) throw new KnowledgeSyncError(413, 'pack_too_large', 'parts add up past the cap');
        out.push(b);
      }
      return out;
    },
    dropStaged: async (actor, id) => { for (const k of [...w.staged.keys()]) if (k.startsWith(`${actor}/${id}/`)) w.staged.delete(k); },
    sweepStaged: async () => undefined,
    deleteLegacySources: async (root, ids) => { for (const id of ids) { w.legacyDeleted.push(id); inner(w.legacySources, root).delete(id); } },
    clearRoot: async (root) => { w.roots.delete(root); w.leaves.delete(root); w.buckets.delete(root); },
  };
}

/** A transaction over the world: what `work` wrote is kept when it resolves and restored when it throws. */
export function atomically(w: World) {
  const copy = <V>(m: Map<string, Map<string, V>>): Map<string, Map<string, V>> => new Map([...m].map(([k, v]) => [k, new Map(v)]));
  return <T>(work: (unit: PackUnit) => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const saved = {
        facts: new Map(w.facts), relations: new Map(w.relations), sources: copy(w.sources), leaves: copy(w.leaves), buckets: copy(w.buckets as never) as unknown as World['buckets'], index: new Map(w.index),
        roots: new Map(w.roots), stale: [...w.stale],
      };
      try {
        return await work({ db: {} as Db, store: fakeStore(w), ledger: fakeLedger(w) });
      } catch (error) {
        Object.assign(w, saved);
        throw error;
      }
    };
    const next = (w.txChain ?? Promise.resolve()).then(run);
    w.txChain = next.catch(reportedFallback(undefined, { source: 'application/knowledge/sync/syncFakes.test-util.ts', operation: 'txChain' }));
    return next;
  };
}
