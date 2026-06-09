/**
 * getPullRequestDetail — fetch the LIVE state of a recorded PR from the provider
 * (status, mergeability, CI checks, diff stat) so the in-product Pull Request tab
 * can render review info and gate the "Approve & Merge" button.
 *
 * This is a read-heavy provider round-trip on a read path, so it is served through
 * the canonical read-through cache ({@link getOrSetCached} — L1 + KV), keyed by the
 * PR id + a version token (its `updatedAt`) so the entry ages out when the row
 * changes and a merge can bust it explicitly. GitHub-only; other providers return
 * `supported: false` so the UI degrades to "open on provider".
 */
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { buildGitApiBaseUrl } from './gitProxy';
import type { Env } from '../../env';

export interface PullRequestDetail {
  supported: boolean;
  /** open | closed (GitHub `state`). */
  state: string | null;
  merged: boolean;
  /** null while GitHub is still computing mergeability. */
  mergeable: boolean | null;
  mergeableState: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  /** Combined CI status for the head commit: success | failure | pending | null. */
  checks: 'success' | 'failure' | 'pending' | null;
  checksTotal: number;
  /** Reason the detail could not be fetched (kept for the UI to surface inline). */
  error?: string;
}

export interface PrCoords {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  number: number;
}

const UNSUPPORTED = (error?: string): PullRequestDetail => ({
  supported: false, state: null, merged: false, mergeable: null, mergeableState: null,
  additions: null, deletions: null, changedFiles: null, checks: null, checksTotal: 0, error,
});

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PR-Detail/1.0',
  };
}

/** Live fetch (uncached). Never throws — returns a typed `error` detail instead. */
async function fetchDetail(coords: PrCoords): Promise<PullRequestDetail> {
  if (coords.provider !== 'github') return UNSUPPORTED(`detail not implemented for provider '${coords.provider}'`);

  const apiBase = buildGitApiBaseUrl(coords.provider, coords.host);
  const repoBase = `${apiBase}/repos/${coords.owner}/${coords.repo}`;
  const headers = ghHeaders(coords.token);

  const prRes = await fetch(`${repoBase}/pulls/${coords.number}`, { headers }).catch(() => null);
  if (!prRes || !prRes.ok) {
    return UNSUPPORTED(prRes ? `GitHub ${prRes.status}` : 'network error');
  }
  const pr = (await prRes.json().catch(() => null)) as {
    state?: string; merged?: boolean; mergeable?: boolean | null; mergeable_state?: string;
    additions?: number; deletions?: number; changed_files?: number; head?: { sha?: string };
  } | null;
  if (!pr) return UNSUPPORTED('malformed PR response');

  // Combined CI status for the head commit (best-effort — absence is not an error).
  let checks: PullRequestDetail['checks'] = null;
  let checksTotal = 0;
  const sha = pr.head?.sha;
  if (sha) {
    const statusRes = await fetch(`${repoBase}/commits/${sha}/status`, { headers }).catch(() => null);
    if (statusRes?.ok) {
      const s = (await statusRes.json().catch(() => null)) as { state?: string; total_count?: number } | null;
      checksTotal = s?.total_count ?? 0;
      if (checksTotal > 0 && (s?.state === 'success' || s?.state === 'failure' || s?.state === 'pending')) {
        checks = s.state;
      }
    }
  }

  return {
    supported: true,
    state: pr.state ?? null,
    merged: pr.merged ?? false,
    mergeable: pr.mergeable ?? null,
    mergeableState: pr.mergeable_state ?? null,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changed_files ?? null,
    checks,
    checksTotal,
  };
}

function cacheKey(prId: string, versionToken: string): string {
  return `pr-detail:${prId}:${versionToken}`;
}

/**
 * Cached PR detail. `versionToken` should be the row's `updatedAt` (ISO/epoch) so
 * the entry naturally ages out on any write; {@link invalidatePullRequestDetail}
 * busts it explicitly after a merge.
 */
export async function getPullRequestDetail(
  env: Env,
  prId: string,
  versionToken: string,
  coords: PrCoords,
): Promise<PullRequestDetail> {
  return getOrSetCached(env, cacheKey(prId, versionToken), () => fetchDetail(coords), {
    kvTtlSeconds: 30,
    l1TtlMs: 10_000,
  });
}

/** Bust the cached detail for a PR (called after a merge flips the row). */
export async function invalidatePullRequestDetail(env: Env, prId: string, versionToken: string): Promise<void> {
  await invalidateCached(env, cacheKey(prId, versionToken));
}
