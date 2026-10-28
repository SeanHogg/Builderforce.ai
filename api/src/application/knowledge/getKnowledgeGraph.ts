/**
 * getKnowledgeGraph — the server-built, cached graph of one knowledge root (PRD 38 §4.8).
 *
 *   perception  the root's extracted entries (R2, current hash per source) + for the
 *               project's linked repository, the cloud repo map turned into code-pack
 *               references (`repoGraphToExtracted`) and the latest uploaded analysis
 *               snapshot (`analysisToExtracted`);
 *   memory      the facts anchored to the root's sources and the relations touching them;
 *   join        memory's `buildGraph` with the ONE pack list (`knowledgePacks`).
 *
 * Cached through `getOrSetCached` under
 *   kg:v3:${tenant}:${project}:${root}:${scopeDigest}:${knowledgeVersion}:${focusHash}:${maxNodes}
 * New data changes the key — never a TTL invalidation. `scopeDigest` is the review digest
 * plus, for the linked repo, the commit sha (a new commit is new perception).
 *
 * `at` builds the graph AT a past review digest (Compare's stored baseline): perception is
 * that review's snapshot (`reviews/{digest}.json` → extracted output by hash, so the code
 * pack's analysis outputs of that review come with it), joined with the CURRENT facts and
 * relations. Its `scopeDigest` slot is `@${at}` — the snapshot is immutable, so the digest
 * alone names its perception, and the version token still names the memory.
 */
import {
  DEFAULT_MAX_NODES, MAX_NODES_CAP, buildGraph, factRef, pathOfRef, sha256Hex,
  type Extracted, type KnowledgeGraph, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import { analysisToExtracted, knowledgePacks, repoGraphToExtracted, sourcePathOf, type CodeAnalysisSnapshot } from '@builderforce/agent-tools';
import { getOrSetCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import type { AnalysisSnapshotPort, ExtractedCachePort, KnowledgeStorePort, RepoGraphPort } from './knowledgePorts';

/** A cached graph lives a day at most in KV; its key already changes with every write. */
export const GRAPH_KV_TTL_SECONDS = 86_400;

export interface KnowledgeGraphDeps {
  cacheEnv: CacheEnv;
  tenantId: number;
  projectId: number;
  store: KnowledgeStorePort;
  extracted: ExtractedCachePort;
  analysis: AnalysisSnapshotPort;
  repo: RepoGraphPort;
  /** The project's knowledge version token (see `knowledgeVersion.ts`). */
  version(): Promise<string>;
}

export interface KnowledgeGraphQuery {
  rootId: string;
  focus?: readonly string[];
  maxNodes?: number;
  /** A past review digest of the root: build from that review's snapshot. */
  at?: string;
}

/** `maxNodes` as the graph will honour it: default 400, capped at 2000. */
export function clampMaxNodes(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_MAX_NODES;
  return Math.min(MAX_NODES_CAP, Math.max(1, Math.floor(raw)));
}

export function knowledgeGraphCacheKey(parts: {
  tenantId: number; projectId: number; rootId: string; scopeDigest: string; version: string; focusHash: string; maxNodes: number;
}): string {
  return `kg:v3:${parts.tenantId}:${parts.projectId}:${parts.rootId}:${parts.scopeDigest}:${parts.version}:${parts.focusHash}:${parts.maxNodes}`;
}

const focusHashOf = (focus: readonly string[]): string =>
  focus.length === 0 ? '-' : sha256Hex([...new Set(focus)].sort().join('\n')).slice(0, 16);

/** A root's CURRENT perception: the digest its cached reads key on, and how to read it. */
export interface RootPerception {
  scopeDigest: string;
  perceive(): Promise<Extracted[]>;
}

/**
 * The root as it is now — a reviewed scope and/or the project's linked repository. Null for a
 * root that was never reviewed and is not the linked repo. Shared by the graph and the facts
 * read (`listKnowledge.ts`), so both name the same sources under the same digest.
 */
export async function currentPerception(deps: KnowledgeGraphDeps, rootId: string): Promise<RootPerception | null> {
  const [scope, linked] = await Promise.all([deps.store.scope(rootId), deps.repo.linked()]);
  const repo = linked?.rootId === rootId ? linked : null;
  if (!scope && !repo) return null;

  const sha = repo ? await repo.sha() : null;
  return {
    scopeDigest: sha256Hex(`${scope?.lastDigest ?? '-'}@${sha ?? '-'}`).slice(0, 24),
    async perceive() {
      const extracted: Extracted[] = [...(await deps.extracted.rootExtracted(rootId))];
      if (repo) {
        const graph = await repo.graph();
        if (graph) extracted.push(...repoGraphToExtracted(graph, rootId));
      }
      const analysis = await deps.analysis.latest(rootId);
      if (analysis) extracted.push(...analysisToExtracted(analysis.snapshot as CodeAnalysisSnapshot, rootId));
      return extracted;
    },
  };
}

/**
 * The file paths perception names — what a fact must be anchored to, to belong to the root.
 *
 * A ref of the root itself is read against its KNOWN prefix `src:${rootId}::`: a root id may
 * end in `:` (the linked repo's `cloud:${repoId}:`), and the generic `pathOfRef` splits at the
 * FIRST `::`, which would leave that colon on the path (`:docs/a.md`). Any other `src:` ref
 * (none expected) falls back to the generic grammar.
 */
export function sourcePathsOf(extracted: readonly Extracted[], rootId: string): Set<string> {
  const paths = new Set<string>();
  for (const e of extracted) {
    const p = sourcePathOf(e.sourceRef, rootId) ?? pathOfRef(e.sourceRef);
    if (p) paths.add(p);
  }
  return paths;
}

export async function getKnowledgeGraph(deps: KnowledgeGraphDeps, q: KnowledgeGraphQuery): Promise<KnowledgeGraph | null> {
  if (q.at) return graphAtDigest(deps, q, q.at);
  const root = await currentPerception(deps, q.rootId);
  return root ? cachedBuild(deps, q, root.scopeDigest, root.perceive) : null;
}

/** The root's graph as its review `at` saw it, with today's memory. Null without that snapshot. */
async function graphAtDigest(deps: KnowledgeGraphDeps, q: KnowledgeGraphQuery, at: string): Promise<KnowledgeGraph | null> {
  if (!(await deps.store.scope(q.rootId))) return null;
  // A digest with no snapshot (reviewed before snapshots existed) is null — a 404, never an
  // empty graph. The snapshot is immutable, so that answer may be cached like the graph.
  return cachedBuild(deps, q, `@${at}`, () => deps.extracted.reviewExtracted(q.rootId, at));
}

async function cachedBuild(
  deps: KnowledgeGraphDeps, q: KnowledgeGraphQuery, scopeDigest: string, perceive: () => Promise<Extracted[] | null>,
): Promise<KnowledgeGraph | null> {
  const focus = (q.focus ?? []).filter(Boolean);
  const maxNodes = clampMaxNodes(q.maxNodes);
  const key = knowledgeGraphCacheKey({
    tenantId: deps.tenantId, projectId: deps.projectId, rootId: q.rootId, scopeDigest,
    version: await deps.version(), focusHash: focusHashOf(focus), maxNodes,
  });

  return getOrSetCached(deps.cacheEnv, key, async (): Promise<KnowledgeGraph | null> => {
    const extracted = await perceive();
    if (!extracted) return null;
    const facts = await deps.store.facts(sourcePathsOf(extracted, q.rootId));
    const relations = await deps.store.relations(q.rootId, new Set(facts.map((f) => factRef(f.key))));
    return buildGraph(
      { rootId: q.rootId, extracted, facts, relations, packs: knowledgePacks() },
      { maxNodes, focus: focus as NodeRef[] },
    );
  }, { kvTtlSeconds: GRAPH_KV_TTL_SECONDS });
}
