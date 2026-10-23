/**
 * Where built repo graphs live (PRD C5): R2, content-addressed by repository + commit
 * sha, with a small per-isolate L1 in front and one build in flight per key.
 *
 * A graph for a commit never changes, so the key needs no TTL and no invalidation —
 * a moved branch resolves to a new sha and therefore a new key. The key carries no
 * tenant: two tenants on the same repository and commit share one build. That is safe
 * because a caller only reaches a key after resolving the sha with ITS OWN credential
 * (`resolveRepoCommitSha`), which the git provider refuses without read access.
 */

import { REPO_GRAPH_VERSION, type SerializedRepoGraph } from '@builderforce/repo-map';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/repos/repoMapStore.ts';
/** Graphs are a few MB at most; a handful per isolate covers the runs it serves at once. */
const L1_MAX_ENTRIES = 4;

export interface RepoMapKeyParts {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  sha: string;
}

const keySegment = (s: string): string => encodeURIComponent(s.toLowerCase());

/** The R2 object key for one repository commit's graph. Versioned with the graph format. */
export function repoMapObjectKey(p: RepoMapKeyParts): string {
  return `repo-map/v${REPO_GRAPH_VERSION}/${keySegment(p.provider)}/${keySegment(p.host ?? '-')}/${keySegment(p.owner)}/${keySegment(p.repo)}/${p.sha}.json`;
}

const l1 = new Map<string, SerializedRepoGraph>();
const inFlight = new Map<string, Promise<SerializedRepoGraph | null>>();

function rememberL1(key: string, graph: SerializedRepoGraph): void {
  l1.delete(key);
  l1.set(key, graph);
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next().value;
    if (oldest === undefined) break;
    l1.delete(oldest);
  }
}

async function readR2(bucket: R2Bucket, key: string): Promise<SerializedRepoGraph | null> {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const parsed = (await obj.json()) as SerializedRepoGraph;
    return parsed?.version === REPO_GRAPH_VERSION ? parsed : null;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'readR2', level: 'warning', context: { key } });
    return null;
  }
}

async function writeR2(bucket: R2Bucket, key: string, graph: SerializedRepoGraph): Promise<void> {
  try {
    await bucket.put(key, JSON.stringify(graph), { httpMetadata: { contentType: 'application/json' } });
  } catch (error) {
    // The graph is still served from L1 and rebuilt on a later cold miss.
    reportCaughtError(error, { source: SOURCE, operation: 'writeR2', level: 'warning', context: { key } });
  }
}

/**
 * The graph for `key`: L1, then R2, then `build` (stored to R2 and L1). Concurrent
 * callers for one key share a single build. `build` returning null (the repo could not
 * be read) is not cached, so the next call tries again.
 */
export async function getOrBuildRepoGraph(
  env: Pick<Env, 'UPLOADS'>,
  key: string,
  build: () => Promise<SerializedRepoGraph | null>,
): Promise<SerializedRepoGraph | null> {
  const hot = l1.get(key);
  if (hot) {
    rememberL1(key, hot);
    return hot;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = (async () => {
    const stored = env.UPLOADS ? await readR2(env.UPLOADS, key) : null;
    const graph = stored ?? (await build());
    if (!graph) return null;
    if (!stored && env.UPLOADS) await writeR2(env.UPLOADS, key, graph);
    rememberL1(key, graph);
    return graph;
  })();
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

/** Test seam: forget every L1 entry. */
export function clearRepoGraphL1(): void {
  l1.clear();
}
