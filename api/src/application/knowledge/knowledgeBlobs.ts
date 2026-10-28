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
 *   knowledge/{t}/{p}/code-analysis/{sha}.json       the analyzer snapshot of one commit
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
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { AnalysisSnapshotPort, ExtractedCachePort } from './knowledgePorts';

const SOURCE = 'application/knowledge/knowledgeBlobs.ts';
/** Blobs fetched per graph build when the bundle is cold; the rest arrive on the next build. */
export const MAX_BLOB_FETCHES_PER_BUILD = 600;
const FETCH_CONCURRENCY = 8;
const LIST_PAGE = 1000;

type Bundle = Record<string, Extracted[]>;
interface SourceEntry { path: string; hash: string }

const seg = (s: string): string => encodeURIComponent(s);

/** The root id of a `src:${rootId}::${path}` ref, else undefined. */
export function rootOfRef(ref: string): string | undefined {
  if (!ref.startsWith('src:')) return undefined;
  const at = ref.indexOf('::');
  return at > 4 ? ref.slice(4, at) : undefined;
}

const pathOfSourceRef = (ref: string): string => ref.slice(ref.indexOf('::') + 2);

/** The object identity of a source: its path, or `~<tag>|<path>` for a root-level output. */
function sourceId(path: string, hash: string): string {
  if (!hash.startsWith('~')) return path;
  const colon = hash.indexOf(':');
  return `${colon > 0 ? hash.slice(0, colon) : hash}|${path}`;
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
    analysis: (sha: string) => `${base}/code-analysis/${seg(sha)}.json`,
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
async function listSources(bucket: R2Bucket, prefix: string): Promise<SourceEntry[]> {
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

export function r2ExtractedCache(env: Pick<Env, 'UPLOADS'>, tenantId: number, projectId: number): ExtractedCachePort {
  const keys = knowledgeBlobKeys(tenantId, projectId);
  const bucket = (): R2Bucket => {
    if (!env.UPLOADS) throw new Error('knowledge storage (R2) is not configured');
    return env.UPLOADS;
  };

  /** Records (or, with hash '', deletes) one source's current hash. Touches only that object. */
  const putSource = async (rootId: string, path: string, hash: string, idHash = hash): Promise<void> => {
    const key = keys.source(rootId, sourceId(path, idHash));
    if (!hash) {
      await bucket().delete(key);
      return;
    }
    await writeJson(bucket(), key, { path, hash }, { path, hash });
  };

  return {
    async get(hash) {
      if (!env.UPLOADS) return undefined;
      return readJson<Extracted[]>(env.UPLOADS, keys.extracted(hash));
    },

    async put(hash, extracted) {
      await writeJson(bucket(), keys.extracted(hash), extracted);
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
      return extractedOf(env.UPLOADS, rootId, await listSources(env.UPLOADS, keys.sources(rootId)), true);
    },

    async snapshotReview(rootId, digest) {
      const b = bucket();
      const key = keys.review(rootId, digest);
      // Immutable per digest: a digest names exactly these sources, so a second writer of the
      // same digest has nothing to add. Never a read-modify-write.
      if (await b.head(key)) return;
      const sources = await listSources(b, keys.sources(rootId));
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
    const missing = wanted.filter((h) => !(h in prior)).slice(0, MAX_BLOB_FETCHES_PER_BUILD);
    const fetched = await mapBounded(missing, FETCH_CONCURRENCY, (h) => readJson<Extracted[]>(b, keys.extracted(h)));
    const bundle: Bundle = {};
    for (const h of wanted) if (prior[h]) bundle[h] = prior[h]!;
    missing.forEach((h, i) => { if (fetched[i]) bundle[h] = fetched[i]!; });
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
      await writeJson(env.UPLOADS, keys.analysis(sha), snapshot);
      await writeJson(env.UPLOADS, keys.latestAnalysis(rootId), { sha });
    },
    async latest(rootId) {
      if (!env.UPLOADS) return null;
      const pointer = await readJson<{ sha?: unknown }>(env.UPLOADS, keys.latestAnalysis(rootId));
      if (typeof pointer?.sha !== 'string') return null;
      const snapshot = await readJson<unknown>(env.UPLOADS, keys.analysis(pointer.sha));
      return snapshot === undefined ? null : { sha: pointer.sha, snapshot };
    },
  };
}
