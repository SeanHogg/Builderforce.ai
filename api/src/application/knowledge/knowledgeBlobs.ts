/**
 * knowledgeBlobs — the knowledge graph's PERCEPTION in R2 (PRD 38 §4.2/§4.8): extracted
 * output by content hash, one object per source naming its current hash, and the code
 * pack's analysis snapshots. None of it is memory: it is recomputable from sources,
 * immutable per hash, and never written to Postgres.
 *
 *   knowledge/{t}/{p}/extracted/{hash}.json          Extracted[] for one content hash
 *   knowledge/{t}/{p}/{root}/src/{sha256(path)}.json { path, hash } — the CURRENT hash of one
 *                                                    source; deleted with the source
 *   knowledge/{t}/{p}/{root}/reviews/{digest}.json   [{ path, hash }] sorted — the root's sources
 *                                                    when a review recorded `digest`. Written
 *                                                    ONCE per digest, never rewritten: Compare
 *                                                    builds "before" from it (`?at=`), and the
 *                                                    outputs it names are immutable by hash
 *   knowledge/{t}/{p}/{root}/bundle.json             { [hash]: Extracted[] } — a read-through
 *                                                    roll-up of the sources' blobs, so a graph
 *                                                    build is one list + one read, not a read
 *                                                    per file (Workers cap subrequests)
 *   knowledge/{t}/{p}/{root}/code-analysis/{sha}.json the analyzer snapshot of one commit, as one root
 *                                                    names its files (older ones: {p}/code-analysis/{sha}.json)
 *   knowledge/{t}/{p}/{root}/analysis.json           { sha } — the latest for the root
 *
 * One object per source means two reviewers of the same root never overwrite each other's
 * entries: each write touches only its own source. The graph lists the root's `src/` prefix
 * (1000 per page); `{path, hash}` rides in the object's custom metadata too, so the listing
 * alone names every current source. A ROOT-level output (hash `~<tag>:…`, repo graph /
 * analyzers) is its own source object, named by `~<tag>|<path>`, so it never displaces the
 * file's own entry. The bundle is a cache keyed by content hash: a lost race re-fetches.
 */
import { sha256Hex, type Extracted, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { fileLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Env } from '../../env';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';
import type { AnalysisSnapshotPort, ExtractedCachePort } from './knowledgePorts';
import { buildBundle, mergeBodies, readBundled } from './knowledgeBundles';
import type { KnowledgeLedgerPort } from './knowledgeLedger';
import { KnowledgeSyncError } from './sync/knowledgeSyncPorts';

const SOURCE = 'application/knowledge/knowledgeBlobs.ts';
/** Blobs fetched per graph build when the bundle is cold; the rest arrive on the next build. */
export const MAX_BLOB_FETCHES_PER_BUILD = 600;
const FETCH_CONCURRENCY = 8;
const LIST_PAGE = 1000;
/** Re-merges of a legacy upload whose body moved under it before it gives up (409). */
const PUT_ATTEMPTS = 3;

type Bundle = Record<string, Extracted[]>;
export interface SourceEntry { path: string; hash: string }

const seg = (s: string): string => encodeURIComponent(s);

/** The root id of a `src:${rootId}::${path}` ref, else undefined. */
export function rootOfRef(ref: string): string | undefined {
  if (!ref.startsWith('src:')) return undefined;
  const at = ref.indexOf('::');
  return at > 4 ? ref.slice(4, at) : undefined;
}

const pathOfSourceRef = (ref: string): string => ref.slice(ref.indexOf('::') + 2);

/** The object identity of a source: its path, or `~<tag>|<path>` for a root-level output. */
export function sourceId(path: string, hash: string): string {
  return fileLeafKey(path, hash).slice(2); // the codec's leaf key is `f:<this id>`: ONE rule for both sides
}

export function knowledgeBlobKeys(tenantId: number, projectId: number) {
  const base = `knowledge/${tenantId}/${projectId}`;
  const sources = (rootId: string) => `${base}/${seg(rootId)}/src/`;
  return {
    extracted: (hash: string) => `${base}/extracted/${seg(hash)}.json`,
    sources,
    source: (rootId: string, id: string) => `${sources(rootId)}${sha256Hex(id)}.json`,
    bundle: (rootId: string) => `${base}/${seg(rootId)}/bundle.json`,
    review: (rootId: string, digest: string) => `${base}/${seg(rootId)}/reviews/${seg(digest)}.json`,
    /** A root's snapshot at `sha`: two roots of one project at one commit hold different paths, so the root is in the key. */
    analysis: (rootId: string, sha: string) => `${base}/${seg(rootId)}/code-analysis/${seg(sha)}.json`,
    /** Snapshots written before the key named its root (one per sha, shared by every root). Read-only. */
    legacyAnalysis: (sha: string) => `${base}/code-analysis/${seg(sha)}.json`,
    latestAnalysis: (rootId: string) => `${base}/${seg(rootId)}/analysis.json`,
  };
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | undefined> {
  try {
    const obj = await bucket.get(key);
    return obj ? ((await obj.json()) as T) : undefined;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'readJson', level: 'warning', context: { key } });
    return undefined;
  }
}

async function writeJson(bucket: R2Bucket, key: string, value: unknown, meta?: Record<string, string>): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json' },
    ...(meta ? { customMetadata: meta } : {}),
  });
}

/** Runs `work` over `items` with at most `n` in flight. */
async function mapBounded<T, R>(items: readonly T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

/** Every current source of a root, by paginated prefix listing. */
export async function listSources(bucket: R2Bucket, prefix: string): Promise<SourceEntry[]> {
  const out: SourceEntry[] = [];
  const unlabeled: string[] = [];
  let cursor: string | undefined;
  do {
    // `include` exists at runtime (compat date ≥ 2022-08-04) but not in the default
    // workers-types entrypoint; objects listed without metadata are read below instead.
    const options: R2ListOptions & { include?: Array<'httpMetadata' | 'customMetadata'> } = {
      prefix, limit: LIST_PAGE, include: ['customMetadata'], ...(cursor ? { cursor } : {}),
    };
    const page = await bucket.list(options);
    for (const obj of page.objects) {
      const meta = obj.customMetadata;
      if (meta?.['path'] !== undefined && meta?.['hash']) out.push({ path: meta['path'], hash: meta['hash'] });
      else unlabeled.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // An object written without metadata is read for its body.
  const read = await mapBounded(unlabeled, FETCH_CONCURRENCY, (key) => readJson<SourceEntry>(bucket, key));
  for (const e of read) if (e && typeof e.path === 'string' && e.hash) out.push(e);
  return out;
}

/**
 * The root's current sources: the `knowledge_sources` rows (written by pack sync and by `setSource`) over the
 * legacy per-source R2 objects, a row winning for the same source id. Without a ledger it is the legacy listing.
 */
export async function listRootSources(
  bucket: R2Bucket | undefined, ledger: KnowledgeLedgerPort | undefined, tenantId: number, projectId: number, rootId: string,
): Promise<SourceEntry[]> {
  const legacy = bucket ? await listSources(bucket, knowledgeBlobKeys(tenantId, projectId).sources(rootId)) : [];
  if (!ledger) return legacy;
  const byId = new Map(legacy.map((s) => [sourceId(s.path, s.hash), s] as const));
  for (const r of await ledger.sources.list(rootId)) {
    // A removal marker (hash '') hides the legacy object of that source: the legacy object is advisory from then on.
    if (r.hash === '') byId.delete(r.sourceId); else byId.set(r.sourceId, { path: r.path, hash: r.hash });
  }
  return [...byId.values()];
}

export function r2ExtractedCache(env: Pick<Env, 'UPLOADS'>, tenantId: number, projectId: number, ledger?: KnowledgeLedgerPort): ExtractedCachePort {
  const keys = knowledgeBlobKeys(tenantId, projectId);
  const bucket = (): R2Bucket => {
    if (!env.UPLOADS) throw new Error('knowledge storage (R2) is not configured');
    return env.UPLOADS;
  };

  /**
   * Records (or, with hash '', deletes) one source's current hash. With a ledger the row is the record, and the
   * legacy object of the same source, if any, is dropped so it can never contradict the row.
   */
  const putSource = async (rootId: string, path: string, hash: string, idHash = hash): Promise<void> => {
    const id = sourceId(path, idHash);
    if (ledger) {
      // A removal is a marker row, so a legacy object that could not be deleted below is harmless (the sweep retries it).
      if (hash) await ledger.sources.upsert(rootId, [{ sourceId: id, path, hash }]); else await ledger.sources.mark(rootId, [id]);
      await bucket().delete(keys.source(rootId, id)).catch(reportedFallback(undefined, { source: SOURCE, operation: 'deleteLegacySource', context: { rootId } }));
      return;
    }
    const key = keys.source(rootId, id);
    if (!hash) {
      await bucket().delete(key);
      return;
    }
    await writeJson(bucket(), key, { path, hash }, { path, hash });
  };

  /** Bodies for `hashes`: through the bundle index first (ranged reads), the legacy per-hash object for the rest. */
  const bodiesOf = async (b: R2Bucket, hashes: readonly string[], over: KnowledgeLedgerPort | undefined = ledger): Promise<Map<string, Extracted[]>> => {
    const found = new Map<string, Extracted[]>();
    if (over && hashes.length > 0) {
      for (const [h, body] of await readBundled(b, await over.index.locate(hashes))) found.set(h, body);
    }
    const rest = hashes.filter((h) => !found.has(h)).slice(0, MAX_BLOB_FETCHES_PER_BUILD);
    const fetched = await mapBounded(rest, FETCH_CONCURRENCY, (h) => readJson<Extracted[]>(b, keys.extracted(h)));
    rest.forEach((h, i) => { if (fetched[i]) found.set(h, fetched[i]!); });
    return found;
  };

  return {
    async get(hash) {
      if (!env.UPLOADS) return undefined;
      return (await bodiesOf(env.UPLOADS, [hash])).get(hash);
    },

    async getMany(hashes) {
      if (!env.UPLOADS) return new Map();
      return bodiesOf(env.UPLOADS, hashes);
    },

    /**
     * The legacy per-hash upload. With a ledger it MERGES by `sourceRef` with the stored body (the same `mergeBodies` as a
     * pack) under the project's sync lock, and stores the result as a one-body bundle + index row, so a pack's
     * read-merge-write sees the change (its basis key moves) and neither evicts the other's entries. Without a ledger
     * (a store with no database) it replaces the per-hash object, as before.
     */
    async put(hash, extracted) {
      if (ledger) {
        // As the pack path: read + merge + write the bundle OUTSIDE the lock (no R2 I/O while it is held), then one locked,
        // CONDITIONAL index write. A body that moved meanwhile (a pack, another upload) is merged again, a few times.
        let written = 0;
        for (let attempt = 0; attempt < PUT_ATTEMPTS && written === 0; attempt++) {
          const prior = (await ledger.index.locate([hash]))[0]?.bundleKey ?? null;
          const current = (await bodiesOf(bucket(), [hash])).get(hash);
          const bundle = buildBundle(tenantId, [{ hash, entries: mergeBodies(current, extracted) }]);
          await bucket().put(bundle.key, bundle.bytes, { httpMetadata: { contentType: 'application/json' } });
          written = await ledger.exclusive((locked) => locked.index.upsert(bundle.locs, new Map([[hash, prior]])));
        }
        if (written === 0) throw new KnowledgeSyncError(409, 'body_conflict', `the extracted body of ${hash} kept changing; retry`, { hashes: [hash] });
      } else {
        await writeJson(bucket(), keys.extracted(hash), extracted);
      }
      // A root-level output has no `markStale` of its own: register it now.
      if (!hash.startsWith('~')) return;
      for (const e of extracted) {
        const root = rootOfRef(e.sourceRef);
        if (root) await putSource(root, pathOfSourceRef(e.sourceRef), hash);
      }
    },

    async setSource(sourceRef: NodeRef, hash: string) {
      const root = rootOfRef(sourceRef);
      if (!root) return;
      // A file's own object is named by its plain path; '' (removed) deletes it.
      await putSource(root, pathOfSourceRef(sourceRef), hash, '');
    },

    async rootExtracted(rootId) {
      if (!env.UPLOADS) return [];
      return extractedOf(env.UPLOADS, rootId, await listRootSources(env.UPLOADS, ledger, tenantId, projectId, rootId), true);
    },

    async deleteRootSources(rootId) {
      if (!env.UPLOADS) return 0;
      const b = env.UPLOADS;
      let removed = 0;
      for (;;) {
        // Always the FIRST page: what was listed is deleted, so the next listing starts past it
        // without leaning on a cursor across deletes.
        const page = await b.list({ prefix: keys.sources(rootId), limit: LIST_PAGE });
        if (page.objects.length === 0) break;
        await b.delete(page.objects.map((o) => o.key));
        removed += page.objects.length;
        if (!page.truncated) break;
      }
      await b.delete(keys.bundle(rootId));
      if (ledger) removed += await ledger.sources.clear(rootId);
      return removed;
    },

    async snapshotReview(rootId, digest) {
      const b = bucket();
      const key = keys.review(rootId, digest);
      // Immutable per digest: a digest names exactly these sources, so a second writer of the
      // same digest has nothing to add. Never a read-modify-write.
      if (await b.head(key)) return;
      const sources = await listRootSources(b, ledger, tenantId, projectId, rootId);
      sources.sort((a, c) => (a.path < c.path ? -1 : a.path > c.path ? 1 : a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : 0));
      await writeJson(b, key, sources);
    },

    async reviewExtracted(rootId, digest) {
      if (!env.UPLOADS) return null;
      const sources = await readJson<SourceEntry[]>(env.UPLOADS, keys.review(rootId, digest));
      if (!Array.isArray(sources)) return null;
      const valid = sources.filter((e) => e && typeof e.path === 'string' && typeof e.hash === 'string' && e.hash);
      // The bundle is the CURRENT sources' cache: a baseline reads it but never rewrites it.
      return extractedOf(env.UPLOADS, rootId, valid, false);
    },
  };

  /**
   * The extracted entry each source names, by its hash: from the root's bundle, fetching
   * what it lacks (bounded). `refreshBundle` rolls the fetched blobs into the bundle — only
   * for the current sources, so a baseline build never displaces them.
   */
  async function extractedOf(b: R2Bucket, rootId: string, sources: readonly SourceEntry[], refreshBundle: boolean): Promise<Extracted[]> {
    const prior = (await readJson<Bundle>(b, keys.bundle(rootId))) ?? {};
    const wanted = [...new Set(sources.map((s) => s.hash))].sort();
    const missingAll = wanted.filter((h) => !(h in prior));
    const missing = missingAll.slice(0, MAX_BLOB_FETCHES_PER_BUILD);
    // Indexed bodies are read in coalesced ranged windows (a few subrequests for thousands of bodies); only the
    // rest are fetched one object each, still bounded per build.
    const fetched = missing.length > 0 ? await bodiesOf(b, missingAll) : new Map<string, Extracted[]>();
    const bundle: Bundle = {};
    for (const h of wanted) if (prior[h]) bundle[h] = prior[h]!;
    for (const h of missingAll) { const body = fetched.get(h); if (body) bundle[h] = body; }
    if (refreshBundle && (missing.length > 0 || Object.keys(prior).length !== Object.keys(bundle).length)) {
      await writeJson(b, keys.bundle(rootId), bundle).catch((error: unknown) => {
        // The bundle is a read-through cache; the next build re-fetches what it lacks.
        reportCaughtError(error, { source: SOURCE, operation: 'writeBundle', level: 'warning', context: { rootId } });
      });
    }
    // Only the entry each source names: a hash shared by two files carries both.
    const out: Extracted[] = [];
    for (const s of sources) {
      const ref = `src:${rootId}::${s.path}`;
      const hit = bundle[s.hash]?.find((e) => e.sourceRef === ref);
      if (hit) out.push(hit);
    }
    return out;
  }
}

export function r2AnalysisSnapshots(env: Pick<Env, 'UPLOADS'>, tenantId: number, projectId: number): AnalysisSnapshotPort {
  const keys = knowledgeBlobKeys(tenantId, projectId);
  return {
    async put(sha, rootId, snapshot) {
      if (!env.UPLOADS) throw new Error('knowledge storage (R2) is not configured');
      await writeJson(env.UPLOADS, keys.analysis(rootId, sha), snapshot);
      await writeJson(env.UPLOADS, keys.latestAnalysis(rootId), { sha });
    },
    async clear(rootId) {
      // The pointer is what `latest` follows; the sha-keyed blobs are immutable and unreachable without it.
      if (env.UPLOADS) await env.UPLOADS.delete(keys.latestAnalysis(rootId));
    },
    async latest(rootId) {
      if (!env.UPLOADS) return null;
      const pointer = await readJson<{ sha?: unknown }>(env.UPLOADS, keys.latestAnalysis(rootId));
      if (typeof pointer?.sha !== 'string') return null;
      const snapshot = (await readJson<unknown>(env.UPLOADS, keys.analysis(rootId, pointer.sha)))
        // Pointers written before the key named its root point at the shared blob. Remove this fallback (and `legacyAnalysis`) once those pointers have aged out.
        ?? (await readJson<unknown>(env.UPLOADS, keys.legacyAnalysis(pointer.sha)));
      return snapshot === undefined ? null : { sha: pointer.sha, snapshot };
    },
  };
}
