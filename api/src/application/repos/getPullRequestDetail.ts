/**
 * getPullRequestDetail — fetch the LIVE state of a recorded PR from the provider
 * (status, mergeability, CI checks, diff stat) so the in-product Pull Request tab
 * can render review info and gate the "Approve & Merge" button.
 *
 * This is a read-heavy provider round-trip on a read path, so it is served through
 * the canonical read-through cache ({@link getOrSetCached} — L1 + KV), keyed by the
 * PR id + a version token (its `updatedAt`) so the entry ages out when the row
 * changes and a merge can bust it explicitly. GitHub has the richest detail
 * (mergeable + combined CI + diff stat). GitLab and Bitbucket Cloud now report the
 * same SIZE and CI signal from their own endpoints — GitLab's line counts derived from
 * the per-file diffs it returns instead of a count field, Bitbucket's from `/diffstat`
 * and `/statuses` — so the PR tab reads the same on all three instead of degrading to a
 * bare state pill. Unmapped providers (e.g. Bitbucket Server) return `supported: false`.
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
  /**
   * The MERGE commit's SHA, once the provider reports the PR merged.
   *
   * Post-merge build validation correlates a deploy-branch CI event back to its ticket
   * through `pull_requests.merge_sha`. A PR merged INSIDE the product records one; a PR
   * a human merged on the provider was reconciled as merged with that column left NULL,
   * so its post-merge build was never validated and its ticket never learned the deploy
   * broke. Reading it here is what lets reconciliation backfill it.
   */
  mergeSha: string | null;
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
  additions: null, deletions: null, changedFiles: null, checks: null, checksTotal: 0, headSha: null, mergeSha: null, error,
});

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PR-Detail/1.0',
  };
}

/** A PR's size, in the shape the detail exposes it. Nulls mean "not reported". */
interface DiffStat { additions: number | null; deletions: number | null; changedFiles: number | null }

const NO_STAT: DiffStat = { additions: null, deletions: null, changedFiles: null };

/**
 * GitLab MR size from the per-file unified diffs.
 *
 * GitLab has no additions/deletions field anywhere on the MR — only `changes_count`,
 * a FILE count — so the size had to be derived. `/changes` returns each file's unified
 * diff; a body line starting with a single `+`/`-` is an added/removed line, while
 * `+++`/`---` are the file headers and must not be counted (that off-by-N is the
 * classic way a hand-rolled diffstat over-reports by two per file).
 */
async function gitlabDiffStat(
  apiBase: string,
  projectId: string,
  number: number,
  headers: Record<string, string>,
): Promise<DiffStat> {
  const res = await fetch(`${apiBase}/projects/${projectId}/merge_requests/${number}/changes`, { headers }).catch(() => null);
  if (!res || !res.ok) return NO_STAT;
  const body = (await res.json().catch(() => null)) as { changes?: Array<{ diff?: string }> } | null;
  const changes = body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return NO_STAT;

  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    for (const line of (change.diff ?? '').split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
  }
  return { additions, deletions, changedFiles: changes.length };
}

/**
 * Bitbucket PR size from `/diffstat` — `size` is the file count and each entry
 * carries its own line counts.
 */
async function bitbucketDiffStat(prBase: string, headers: Record<string, string>): Promise<DiffStat> {
  const res = await fetch(`${prBase}/diffstat?pagelen=100`, { headers }).catch(() => null);
  if (!res || !res.ok) return NO_STAT;
  const body = (await res.json().catch(() => null)) as {
    size?: number;
    values?: Array<{ lines_added?: number; lines_removed?: number }>;
  } | null;
  const values = body?.values;
  if (!Array.isArray(values)) return NO_STAT;
  return {
    additions: values.reduce((n, v) => n + (v.lines_added ?? 0), 0),
    deletions: values.reduce((n, v) => n + (v.lines_removed ?? 0), 0),
    // `size` counts the WHOLE diffstat; `values` is only the first page of it.
    changedFiles: typeof body?.size === 'number' ? body.size : values.length,
  };
}

/**
 * Bitbucket combined build state from `/statuses` — the analogue of GitHub's combined
 * commit status. Any FAILED/ERROR wins, then any in-progress, else success.
 */
async function bitbucketChecks(
  prBase: string,
  headers: Record<string, string>,
): Promise<{ checks: PullRequestDetail['checks']; checksTotal: number }> {
  const res = await fetch(`${prBase}/statuses?pagelen=100`, { headers }).catch(() => null);
  if (!res || !res.ok) return { checks: null, checksTotal: 0 };
  const body = (await res.json().catch(() => null)) as { values?: Array<{ state?: string }> } | null;
  const states = (body?.values ?? []).map((v) => (v.state ?? '').toUpperCase());
  if (states.length === 0) return { checks: null, checksTotal: 0 };
  const checks: PullRequestDetail['checks'] =
    states.some((st) => st === 'FAILED' || st === 'ERROR') ? 'failure'
      : states.some((st) => st === 'INPROGRESS' || st === 'PENDING') ? 'pending'
        : states.some((st) => st === 'SUCCESSFUL') ? 'success'
          : null;
  return { checks, checksTotal: states.length };
}

/** GitLab MR detail — state/merged/mergeable + CI from the head pipeline, plus the
 *  per-file size derived from `/changes`. Never throws. */
async function fetchGitlabDetail(coords: PrCoords): Promise<PullRequestDetail> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl(coords.provider, coords.host); } catch (e) { return UNSUPPORTED(e instanceof Error ? e.message : 'unsupported host'); }
  const projectId = encodeURIComponent(`${coords.owner}/${coords.repo}`);
  const headers = { Authorization: `Bearer ${coords.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PR-Detail/1.0' };
  const res = await fetch(`${apiBase}/projects/${projectId}/merge_requests/${coords.number}`, { headers }).catch(() => null);
  if (!res || !res.ok) return UNSUPPORTED(res ? `GitLab ${res.status}` : 'network error');
  const mr = (await res.json().catch(() => null)) as {
    state?: string; merged_at?: string | null; merge_status?: string; changes_count?: string;
    merge_commit_sha?: string | null;
    head_pipeline?: { status?: string } | null;
  } | null;
  if (!mr) return UNSUPPORTED('malformed MR response');
  const pipe = mr.head_pipeline?.status;
  const checks: PullRequestDetail['checks'] =
    pipe === 'success' ? 'success' : pipe === 'failed' ? 'failure'
    : pipe === 'running' || pipe === 'pending' ? 'pending' : null;

  // GitLab reports `changes_count` (a FILE count) and nothing else, so an MR showed
  // "12 files" with no size — the reviewer could not tell a rename from a rewrite.
  // The per-file unified diffs are one call away and carry the line counts; summing
  // them here is what gives GitLab the same +/- the GitHub path already has.
  const stat = await gitlabDiffStat(apiBase, projectId, coords.number, headers);
  return {
    supported: true,
    state: mr.state === 'opened' ? 'open' : mr.state ?? null,
    merged: mr.state === 'merged' || !!mr.merged_at,
    draft: false,
    mergeable: mr.merge_status ? mr.merge_status === 'can_be_merged' : null,
    mergeableState: mr.merge_status ?? null,
    allowedMergeMethods: null,
    additions: stat.additions,
    deletions: stat.deletions,
    changedFiles: stat.changedFiles ?? (mr.changes_count ? Number(mr.changes_count) || null : null),
    checks,
    checksTotal: checks ? 1 : 0,
    // GitLab exposes `sha` on the MR, but nothing consumes a head SHA on this
    // provider today (the Checks API is GitHub-only), so it stays null rather
    // than adding an unused field to the parse.
    headSha: null,
    mergeSha: mr.merge_commit_sha ?? null,
  };
}

/** Bitbucket Cloud PR detail — state/merged, plus the diffstat and combined build
 *  state from their own endpoints (best-effort; absence degrades to nulls). Never throws. */
async function fetchBitbucketDetail(coords: PrCoords): Promise<PullRequestDetail> {
  let apiBase: string;
  try { apiBase = buildGitApiBaseUrl(coords.provider, coords.host); } catch (e) { return UNSUPPORTED(e instanceof Error ? e.message : 'unsupported host'); }
  const headers = { Authorization: `Bearer ${coords.token}`, Accept: 'application/json', 'User-Agent': 'BuilderForce-PR-Detail/1.0' };
  const prBase = `${apiBase}/repositories/${coords.owner}/${coords.repo}/pullrequests/${coords.number}`;
  const res = await fetch(prBase, { headers }).catch(() => null);
  if (!res || !res.ok) return UNSUPPORTED(res ? `Bitbucket ${res.status}` : 'network error');
  const pr = (await res.json().catch(() => null)) as { state?: string; merge_commit?: { hash?: string } | null } | null;
  if (!pr) return UNSUPPORTED('malformed PR response');

  // Bitbucket's PR object carries neither a diffstat nor a build state, so a
  // Bitbucket PR rendered as "state only" — no size, no CI — while the same screen
  // showed both for GitHub. Both are separate, cheap endpoints; fetched together so
  // one slow read does not serialise behind the other. Best-effort: absence is not
  // an error, it degrades to the nulls this returned before.
  const [stat, ci] = await Promise.all([
    bitbucketDiffStat(prBase, headers),
    bitbucketChecks(prBase, headers),
  ]);
  return {
    supported: true,
    state: pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : pr.state === 'DECLINED' ? 'closed' : pr.state ?? null,
    merged: pr.state === 'MERGED',
    draft: false,
    mergeable: null,
    mergeableState: null,
    allowedMergeMethods: null,
    additions: stat.additions,
    deletions: stat.deletions,
    changedFiles: stat.changedFiles,
    checks: ci.checks,
    checksTotal: ci.checksTotal,
    headSha: null,
    mergeSha: pr.merge_commit?.hash ?? null,
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
    merge_commit_sha?: string | null;
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
    // GitHub sets `merge_commit_sha` on an OPEN PR too (the test-merge commit), so it
    // is only meaningful once `merged` is true — reading it unconditionally would
    // record a sha that no deploy will ever run on.
    mergeSha: pr.merged ? pr.merge_commit_sha ?? null : null,
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
