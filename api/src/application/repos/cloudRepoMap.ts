/**
 * The cloud repo map (PRD C5) for the DURABLE runner — the surface with no filesystem,
 * which until now could orient only by listing the tree and reading files one by one.
 *
 * The repository is read ONCE per commit: one tarball request, decompressed and walked
 * as it streams (`tarStream.ts`), each source file reduced to its facts by
 * `@builderforce/repo-map` (the TypeScript twin of bf-index's ranker) and dropped. The
 * built graph is stored in R2 by repository + commit sha (`repoMapStore.ts`), so every
 * later call — the next tick, the next run, another tenant on the same commit — only
 * renders it, personalized by the call's `focus` and `query`.
 *
 * The map is built from the run's BASE ref, not the ticket branch: the branch moves with
 * every write the run makes, the base does not, so the cache holds across the run and
 * across runs. The run's own edits are what it already knows; the map is orientation.
 *
 * Exposed as the shared `repo.semantic` capability, so the SAME `repo_map` and
 * `semantic_search` tool definitions run here as on Desktop. Search is hybrid over the
 * map's definitions: the keyword ranking fused (RRF) with a dense one from free bge-m3
 * vectors embedded lazily and reused across commits (`repoSymbolVectors.ts`); without a
 * Workers AI credential it is keyword-only.
 */

import type { RepoMapResult, RepoSemanticCapability, SemanticSearchHit, SemanticSearchResult } from '@builderforce/agent-tools';
import {
  DEFAULT_REPO_MAP_LIMITS, RepoGraph, RepoGraphBuilder, isMapCandidate, renderRepoMap, searchRepoSymbols,
  type RepoMapLimits, type SerializedRepoGraph,
} from '@builderforce/repo-map';
import { reciprocalRankFusion } from '@seanhogg/builderforce-memory/retrieval';
import type { Env } from '../../env';
import type { EmbeddingEnv } from '../memory/memoryEmbedding';
import { TENANT_PRINCIPAL, cacheScopeKey } from '../llm/cacheScope';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { fetchRepoTarball, resolveRepoCommitSha, type RepoReadContext } from './readRepoContents';
import { getOrBuildRepoGraph, repoMapObjectKey } from './repoMapStore';
import { loadRepoSymbolIndex, type RepoSymbolIndex } from './repoSymbolVectors';
import { readTarEntries } from './tarStream';

const SOURCE = 'application/repos/cloudRepoMap.ts';

/** How long a ref → sha answer is reused before the provider is asked again. */
const SHA_CACHE_SECONDS = 60;
/** Wall-clock ceiling on one tarball read; past it the map is built from what was read. */
const BUILD_DEADLINE_MS = 20_000;
/** A file with a NUL byte in its first this-many bytes is binary. */
const BINARY_SNIFF_BYTES = 8_192;

export type CloudRepoMapEnv = Pick<Env, 'UPLOADS' | 'AUTH_CACHE_KV' | 'CACHE_L2_KV'> & EmbeddingEnv;

/** Candidates each arm contributes before fusion. */
const SEARCH_POOL = 30;

export interface CloudRepoMapDeps {
  env: CloudRepoMapEnv;
  tenantId: number;
  projectId?: number | null;
  /** The repository and the ref the map is built from — pass the run's BASE branch. */
  repo: RepoReadContext;
  limits?: RepoMapLimits;
}

export type LoadedRepoGraph = { ok: true; graph: RepoGraph; sha: string } | { ok: false; reason: string };

/** ref → sha, cached per tenant + project (a sha is only ever learned with the caller's own credential).
 *  Exported for the knowledge graph, which keys its cache on the commit without loading the map. */
export async function commitShaFor(deps: CloudRepoMapDeps): Promise<{ ok: true; sha: string } | { ok: false; reason: string }> {
  const { repo } = deps;
  const scope = cacheScopeKey({ tenantId: deps.tenantId, projectId: deps.projectId ?? null, principal: TENANT_PRINCIPAL });
  const key = `repo-map-sha:${scope}:${repo.provider}:${repo.host ?? '-'}:${repo.owner}/${repo.repo}@${repo.ref}`;
  const cached = await peekCached<string>(deps.env, key);
  if (cached) return { ok: true, sha: cached };
  const resolved = await resolveRepoCommitSha(repo);
  // Only a success is cached: a transient provider failure must not stick for a minute.
  if (resolved.ok) await setCached(deps.env, key, resolved.sha, { kvTtlSeconds: SHA_CACHE_SECONDS, l1TtlMs: SHA_CACHE_SECONDS * 1000 });
  return resolved;
}

/** `owner-repo-abc1234/src/a.ts` → `src/a.ts` (GitHub roots every entry in one directory). */
function stripArchiveRoot(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? '' : path.slice(slash + 1);
}

function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Build the serialized graph from a (gzip'd) tarball stream, within `limits`. Stops —
 * and marks the graph truncated — at the file cap, the byte cap or the deadline.
 */
export async function buildRepoGraphFromTarball(
  gzipped: ReadableStream<Uint8Array>,
  limits: RepoMapLimits = DEFAULT_REPO_MAP_LIMITS,
  now: () => number = Date.now,
): Promise<SerializedRepoGraph> {
  const builder = new RepoGraphBuilder();
  const decoder = new TextDecoder();
  const deadline = now() + BUILD_DEADLINE_MS;
  let bytes = 0;
  const tar = gzipped.pipeThrough(new DecompressionStream('gzip'));
  for await (const entry of readTarEntries(tar)) {
    if (entry.type !== 'file') continue;
    const path = stripArchiveRoot(entry.path);
    if (!path || !isMapCandidate(path, entry.size, limits)) continue;
    if (builder.fileCount >= limits.maxFiles || bytes + entry.size > limits.maxTotalBytes || now() > deadline) {
      builder.markTruncated();
      break;
    }
    const data = await entry.read();
    if (looksBinary(data)) continue;
    bytes += data.length;
    builder.addFile(path, decoder.decode(data));
  }
  return builder.build();
}

/** The run's repo graph: R2 by commit, else one tarball read. Never throws. */
export async function loadCloudRepoGraph(deps: CloudRepoMapDeps): Promise<LoadedRepoGraph> {
  const sha = await commitShaFor(deps);
  if (!sha.ok) return { ok: false, reason: sha.reason };
  const key = repoMapObjectKey({ ...deps.repo, sha: sha.sha });
  let buildFailure = 'the repository could not be read';
  const serialized = await getOrBuildRepoGraph(deps.env, key, async () => {
    const tarball = await fetchRepoTarball(deps.repo, sha.sha);
    if (!tarball.ok) {
      buildFailure = tarball.reason;
      return null;
    }
    try {
      return await buildRepoGraphFromTarball(tarball.body, deps.limits ?? DEFAULT_REPO_MAP_LIMITS);
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'buildRepoGraphFromTarball', context: { key } });
      buildFailure = `the repository archive could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  });
  if (!serialized) return { ok: false, reason: buildFailure };
  try {
    return { ok: true, graph: RepoGraph.fromJSON(serialized), sha: sha.sha };
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'hydrate', context: { key } });
    return { ok: false, reason: 'the stored repo map could not be read' };
  }
}

const FALLBACK = 'Use list_files / search_code to orient instead.';

/** A footer that keeps a capped map honest about what it covers. */
function coverageNote(graph: RepoGraph, sha: string): string {
  const head = `(map of ${sha.slice(0, 7)} on the base branch — your own edits this run are not in it`;
  return graph.stats.truncated
    ? `${head}; built from the first ${graph.stats.files} source files, the repository is larger than the cloud read cap)\n`
    : `${head})\n`;
}

/**
 * The `repo.semantic` capability over the cloud repo map. `repoMap` also accepts the
 * task `query` (personalization, as bf-context's `--query`) when a caller passes one.
 */
export function createCloudRepoSemantic(deps: CloudRepoMapDeps): RepoSemanticCapability {
  let loaded: Promise<LoadedRepoGraph> | null = null;
  const load = (): Promise<LoadedRepoGraph> => (loaded ??= loadCloudRepoGraph(deps));
  let indexed: Promise<RepoSymbolIndex | null> | null = null;
  const dense = (graph: RepoGraph, sha: string): Promise<RepoSymbolIndex | null> =>
    (indexed ??= loadRepoSymbolIndex({ env: deps.env, repo: { ...deps.repo, sha }, graph }));
  return {
    async repoMap(opts?: { focus?: string[]; maxTokens?: number; query?: string }): Promise<RepoMapResult> {
      const r = await load();
      if (!r.ok) return { ok: false, error: `repo map unavailable: ${r.reason}. ${FALLBACK}` };
      const map = renderRepoMap(r.graph, { maxTokens: opts?.maxTokens ?? 1500, focus: opts?.focus ?? [], query: opts?.query ?? null });
      return { ok: true, map: map + coverageNote(r.graph, r.sha) };
    },
    async search(query: string, opts?: { scope?: string; limit?: number }): Promise<SemanticSearchResult> {
      const r = await load();
      if (!r.ok) return { ok: false, error: `semantic search unavailable: ${r.reason}. ${FALLBACK}` };
      const limit = Math.max(1, opts?.limit ?? 8);
      const scope = opts?.scope ?? null;
      const keyword = searchRepoSymbols(r.graph, query, { limit: SEARCH_POOL, scope });
      const index = await dense(r.graph, r.sha);
      const embedded = index ? await index.search(query, { limit: SEARCH_POOL, scope }) : [];
      const results = fuseDefinitionHits(keyword, embedded).slice(0, limit);
      // Still embedding (a pass ran out of budget): the next search covers more.
      const indexing = index ? index.embedded < index.covered : false;
      return { ok: true, query, total: results.length, results, ...(indexing ? { indexing } : {}) };
    },
  };
}

/**
 * Keyword and dense definition rankings fused by RRF. A definition both arms found is
 * `hybrid`; with no dense arm the keyword order is returned unchanged.
 */
export function fuseDefinitionHits(
  keyword: ReadonlyArray<{ path: string; line: number; symbol: string; signature: string }>,
  embedded: ReadonlyArray<{ symbol: { path: string; line: number; name: string; signature: string }; score: number }>,
): SemanticSearchHit[] {
  const idOf = (path: string, line: number, name: string): string => `${path}:${line}:${name}`;
  const rows = new Map<string, { path: string; line: number; symbol: string; signature: string; arms: Set<'keyword' | 'embedding'> }>();
  const add = (path: string, line: number, symbol: string, signature: string, arm: 'keyword' | 'embedding'): string => {
    const id = idOf(path, line, symbol);
    const row = rows.get(id) ?? { path, line, symbol, signature, arms: new Set() };
    row.arms.add(arm);
    rows.set(id, row);
    return id;
  };
  const keywordIds = keyword.map((h) => add(h.path, h.line, h.symbol, h.signature, 'keyword'));
  const denseIds = embedded.map((h) => add(h.symbol.path, h.symbol.line, h.symbol.name, h.symbol.signature, 'embedding'));
  const order = denseIds.length
    ? reciprocalRankFusion([{ ids: keywordIds }, { ids: denseIds }])
    : keywordIds.map((id) => ({ id, score: undefined as number | undefined }));
  return order.map(({ id, score }) => {
    const row = rows.get(id)!;
    const source = row.arms.size === 2 ? 'hybrid' : row.arms.has('embedding') ? 'embedding' : 'keyword';
    return {
      path: row.path, startLine: row.line, endLine: row.line, symbol: row.symbol, kind: 'definition', snippet: row.signature, source,
      ...(score === undefined ? {} : { score }),
    };
  });
}
