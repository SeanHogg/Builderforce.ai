/**
 * getPullRequestDetail — fetch the LIVE state of a recorded PR from the provider
 * (status, mergeability, CI checks, diff stat) so the in-product Pull Request tab
 * can render review info and gate the "Approve & Merge" button.
 *
 * This is a read-heavy provider round-trip on a read path, so it is served through
 * the canonical read-through cache ({@link getOrSetCached} — L1 + KV), keyed by the
 * PR id + a version token (its `updatedAt`) so the entry ages out when the row
 * changes and a merge can bust it explicitly. GitHub has the richest detail
 * (mergeable + combined CI + diff stat); GitLab/Bitbucket Cloud return core
 * state/merged (+ GitLab mergeable/pipeline) so the PR tab + merge gate work for
 * them too. Unmapped providers (e.g. Bitbucket Server) return `supported: false`.
 */
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { buildGitApiBaseUrl } from './gitProxy';
import type { Env } from '../../env';

export interface PullRequestDetail {
  supported: boolean;
  /** open | closed (GitHub `state`). */
  state: string | null;
  merged: boolean;
  draft: boolean;
  /** null while GitHub is still computing mergeability. */
  mergeable: boolean | null;
  mergeableState: string | null;
  /** Merge strategies enabled by the repository, when the provider exposes them. */
  allowedMergeMethods: Array<'squash' | 'merge' | 'rebase'> | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  /** Combined CI status for the head commit: success | failure | pending | null. */
  checks: 'success' | 'failure' | 'pending' | null;
  checksTotal: number;
  /**
   * SHA of the PR head commit. Required to publish a Check Run (the Checks API
   * targets a commit, not a PR) — see application/checks/publishCheckRun.ts.
   *
   * CAUTION: this rides the same 30s-TTL cache as the rest of the detail, so a
   * force-push can leave it stale for up to that window. Callers that must hit
   * the exact current head — anything writing a check run — should bust the
   * cache first via `invalidatePullRequestDetail`, because a check posted to a
   * superseded SHA silently never appears on the PR.
   */
  headSha: string | null;
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
  supported: false, state: null, merged: false, draft: false, mergeable: null, mergeableState: null, allowedMergeMethods: null,
  additions: null, deletions: null, changedFiles: null, checks: null, checksTotal: 0, headSha: null, error,
});

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PR-Detail/1.0',
  };
}

/** GitLab MR detail — core fields (state/merged/mergeable/changedFiles + CI from
 *  the head pipeline). Rich per-file additions/deletions need the /changes call;
 *  left null (best-effort). Never throws. */
async function fetchGitlabDetail(coords: PrCoords): Promise<PullRequestDetail> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl(coords.provider, coords.host); } catch (e) { return UNSUPPORTED(e instanceof Error ? e.message : 'unsupported host'); }
  const projectId = encodeURIComponent(`${coords.owner}/${coords.repo}`);
  const headers = { Authorization: `Bearer ${coords.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PR-Detail/1.0' };
  const res = await fetch(`${apiBase}/projects/${projectId}/merge_requests/${coords.number}`, { headers }).catch(() => null);
  if (!res || !res.ok) return UNSUPPORTED(res ? `GitLab ${res.status}` : 'network error');
  const mr = (await res.json().catch(() => null)) as {
    state?: string; merged_at?: string | null; merge_status?: string; changes_count?: string;
    head_pipeline?: { status?: string } | null;
  } | null;
  if (!mr) return UNSUPPORTED('malformed MR response');
  const pipe = mr.head_pipeline?.status;
  const checks: PullRequestDetail['checks'] =
    pipe === 'success' ? 'success' : pipe === 'failed' ? 'failure'
    : pipe === 'running' || pipe === 'pending' ? 'pending' : null;
  return {
    supported: true,
    state: mr.state === 'opened' ? 'open' : mr.state ?? null,
    merged: mr.state === 'merged' || !!mr.merged_at,
    draft: false,
    mergeable: mr.merge_status ? mr.merge_status === 'can_be_merged' : null,
    mergeableState: mr.merge_status ?? null,
    allowedMergeMethods: null,
    additions: null,
    deletions: null,
    changedFiles: mr.changes_count ? Number(mr.changes_count) || null : null,
    checks,
    checksTotal: checks ? 1 : 0,
    // GitLab exposes `sha` on the MR, but nothing consumes a head SHA on this
    // provider today (the Checks API is GitHub-only), so it stays null rather
    // than adding an unused field to the parse.
    headSha: null,
  };
}

/** Bitbucket Cloud PR detail — core state/merged. Diff stat + build statuses need
 *  extra calls; left null (best-effort). Never throws. */
async function fetchBitbucketDetail(coords: PrCoords): Promise<PullRequestDetail> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl(coords.provider, coords.host); } catch (e) { return UNSUPPORTED(e instanceof Error ? e.message : 'unsupported host'); }
  const headers = { Authorization: `Bearer ${coords.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PR-Detail/1.0' };
  const res = await fetch(`${apiBase}/repositories/${coords.owner}/${coords.repo}/pullrequests/${coords.number}`, { headers }).catch(() => null);
  if (!res || !res.ok) return UNSUPPORTED(res ? `Bitbucket ${res.status}` : 'network error');
  const pr = (await res.json().catch(() => null)) as { state?: string } | null;
  if (!pr) return UNSUPPORTED('malformed PR response');
  return {
    supported: true,
    state: pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : pr.state === 'DECLINED' ? 'closed' : pr.state ?? null,
    merged: pr.state === 'MERGED',
    draft: false,
    mergeable: null,
    mergeableState: null,
    allowedMergeMethods: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    checks: null,
    checksTotal: 0,
    headSha: null,
  };
}

/** Live fetch (uncached). Never throws — returns a typed `error` detail instead. */
async function fetchDetail(coords: PrCoords): Promise<PullRequestDetail> {
  if (coords.provider === 'gitlab') return fetchGitlabDetail(coords);
  if (coords.provider === 'bitbucket') return fetchBitbucketDetail(coords);
  if (coords.provider !== 'github') return UNSUPPORTED(`detail not implemented for provider '${coords.provider}'`);

  const apiBase = buildGitApiBaseUrl(coords.provider, coords.host);
  const repoBase = `${apiBase}/repos/${coords.owner}/${coords.repo}`;
  const headers = ghHeaders(coords.token);

  const prRes = await fetch(`${repoBase}/pulls/${coords.number}`, { headers }).catch(() => null);
  if (!prRes || !prRes.ok) {
    return UNSUPPORTED(prRes ? `GitHub ${prRes.status}` : 'network error');
  }
  const pr = (await prRes.json().catch(() => null)) as {
    state?: string; merged?: boolean; draft?: boolean; mergeable?: boolean | null; mergeable_state?: string;
    additions?: number; deletions?: number; changed_files?: number; head?: { sha?: string };
    base?: { repo?: { allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean } };
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
    draft: pr.draft ?? false,
    mergeable: pr.mergeable ?? null,
    mergeableState: pr.mergeable_state ?? null,
    allowedMergeMethods: pr.base?.repo ? [
      ...(pr.base.repo.allow_squash_merge !== false ? ['squash' as const] : []),
      ...(pr.base.repo.allow_merge_commit !== false ? ['merge' as const] : []),
      ...(pr.base.repo.allow_rebase_merge !== false ? ['rebase' as const] : []),
    ] : null,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changed_files ?? null,
    checks,
    checksTotal,
    headSha: sha ?? null,
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
