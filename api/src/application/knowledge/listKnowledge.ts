/**
 * listKnowledge — the cached list reads of the knowledge API (PRD 38 §4.8):
 *
 *   scopes   GET …/knowledge/scopes        every reviewed root of the project
 *   facts    GET …/knowledge/facts?root=   the root's stored facts, with author and origin
 *
 * Both are cached through `getOrSetCached` keyed on the project's knowledge version — the
 * token every write bumps (`writeKnowledge`, `deleteKnowledgeFact`, any fact upsert), so
 * new data changes the key and nothing waits on a TTL. The facts read names the root's
 * sources exactly as the graph does (`currentPerception`) and reads their facts in ONE
 * store query; its key also carries the root's scope digest, so a new review or a new
 * commit of the linked repo is a new key.
 */
import type { StoredFact } from '@seanhogg/builderforce-memory/knowledge';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { GRAPH_KV_TTL_SECONDS, currentPerception, sourcePathsOf, type KnowledgeGraphDeps } from './getKnowledgeGraph';
import type { KnowledgeScope } from './knowledgePorts';

type ListDeps = Pick<KnowledgeGraphDeps, 'cacheEnv' | 'tenantId' | 'projectId' | 'store' | 'version'>;

export function knowledgeScopesCacheKey(tenantId: number, projectId: number, version: string): string {
  return `ks:v1:${tenantId}:${projectId}:${version}`;
}

export function knowledgeFactsCacheKey(parts: { tenantId: number; projectId: number; rootId: string; scopeDigest: string; version: string }): string {
  return `kf:v1:${parts.tenantId}:${parts.projectId}:${parts.rootId}:${parts.scopeDigest}:${parts.version}`;
}

export async function listKnowledgeScopes(deps: ListDeps): Promise<KnowledgeScope[]> {
  const key = knowledgeScopesCacheKey(deps.tenantId, deps.projectId, await deps.version());
  return getOrSetCached(deps.cacheEnv, key, () => deps.store.scopes(), { kvTtlSeconds: GRAPH_KV_TTL_SECONDS });
}

/** The root's stored facts (`createdBy` + `origin` as recorded); null for an unknown root. */
export async function listKnowledgeFacts(deps: KnowledgeGraphDeps, rootId: string): Promise<StoredFact[] | null> {
  const root = await currentPerception(deps, rootId);
  if (!root) return null;
  const key = knowledgeFactsCacheKey({
    tenantId: deps.tenantId, projectId: deps.projectId, rootId, scopeDigest: root.scopeDigest, version: await deps.version(),
  });
  return getOrSetCached(deps.cacheEnv, key, async () => deps.store.facts(sourcePathsOf(await root.perceive(), rootId)), {
    kvTtlSeconds: GRAPH_KV_TTL_SECONDS,
  });
}
