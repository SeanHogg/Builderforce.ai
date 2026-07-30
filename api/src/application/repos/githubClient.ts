/**
 * githubClient — the ONE authenticated GitHub REST call site.
 *
 * WHY THIS EXISTS
 * Before this module, an authenticated api.github.com request was hand-rolled in
 * roughly a dozen files (createPullRequest, getPullRequestDetail, mergePullRequest,
 * commitFileToRepo, readRepoContents, fetchBuildError, repoBridge, boardsync
 * providers, repoRoutes, GitHubRepoSource, githubActivitySource, …). That drift
 * was already visible: six different `User-Agent` strings, two different `Accept`
 * headers, inconsistent `X-GitHub-Api-Version` pinning, and four files
 * re-implementing the host→api-base mapping inline despite `buildGitApiBaseUrl`
 * existing in gitProxy.ts.
 *
 * More importantly it made GitHub App support impossible to add incrementally:
 * with auth constructed at a dozen call sites, "prefer an installation token,
 * fall back to the user PAT" would have to be pasted a dozen times and would rot.
 * Routing every call through here means the App upgrade lands once.
 *
 * CONVENTIONS THIS FOLLOWS
 * - Tagged results, never throws. `RepoSourceError` is deliberately confined to
 *   `sources/` (the RepoSource classes); every other repos/ module returns a
 *   `{ok:false, code, reason}` shape and callers branch on it. This matches.
 * - `Bearer` auth. Both user tokens and installation tokens accept it; the older
 *   `token <pat>` scheme is not used anywhere in this codebase.
 */
import { buildGitApiBaseUrl } from './gitProxy';
import { getInstallationToken, isGitHubAppConfigured } from './githubApp';
import { isResolveError, resolveRepoCredential } from './resolveRepoCredential';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Single source of truth for the API version + client identity we present. */
export const GITHUB_API_VERSION = '2022-11-28';
export const GITHUB_USER_AGENT = 'Builderforce/1.0';

export interface GitHubCoords {
  host: string | null;
  owner: string;
  repo: string;
}

export type GitHubErrorCode =
  | 'unsupported'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'provider_error';

export type GitHubResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: GitHubErrorCode; reason: string };

export function githubHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': GITHUB_USER_AGENT,
    ...extra,
  };
}

function classify(status: number): GitHubErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'provider_error';
}

/**
 * Perform an authenticated GitHub REST call.
 *
 * `path` is appended to the resolved API base and must start with '/'
 * (e.g. `/repos/o/r/check-runs`). Owner/repo interpolation is the caller's job
 * so this stays a thin transport — but callers MUST encodeURIComponent their
 * segments; see `repoPath` below for the safe helper.
 */
export async function githubRequest<T>(args: {
  coords: GitHubCoords;
  token: string;
  path: string;
  method?: string;
  body?: unknown;
  /** Injected in tests and by the Worker's subrequest-aware fetch wrapper. */
  fetchFn?: typeof fetch;
  /** Rate-limit / 403 responses carry a JSON message worth surfacing. */
  extraHeaders?: Record<string, string>;
}): Promise<GitHubResponse<T>> {
  const { coords, token, path, method = 'GET', body, fetchFn = fetch, extraHeaders } = args;

  let base: string;
  try {
    base = buildGitApiBaseUrl('github', coords.host);
  } catch (e) {
    return { ok: false, status: 0, code: 'unsupported', reason: (e as Error).message };
  }

  let res: Response;
  try {
    res = await fetchFn(`${base}${path}`, {
      method,
      headers: githubHeaders(token, {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    return { ok: false, status: 0, code: 'provider_error', reason: (e as Error).message };
  }

  if (!res.ok) {
    // GitHub error bodies carry a `message` that is far more actionable than the
    // status alone ("Resource not accessible by integration" is the single most
    // common App-permissions mistake, and is invisible without this).
    const detail = await res
      .json()
      .then((b) => (b as { message?: string } | null)?.message)
      .catch(() => null);
    return {
      ok: false,
      status: res.status,
      code: classify(res.status),
      reason: detail ? `${res.status}: ${detail}` : `GitHub returned ${res.status}`,
    };
  }

  // 204 No Content is a success with no body (e.g. some DELETE endpoints).
  if (res.status === 204) return { ok: true, status: 204, data: undefined as T };

  const data = (await res.json().catch(() => null)) as T | null;
  if (data === null) {
    return { ok: false, status: res.status, code: 'provider_error', reason: 'response body was not JSON' };
  }
  return { ok: true, status: res.status, data };
}

/** Build a `/repos/{owner}/{repo}{suffix}` path with segments safely encoded. */
export function repoPath(coords: GitHubCoords, suffix: string): string {
  return `/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Auth resolution — App-first, user-token fallback
// ---------------------------------------------------------------------------

export interface ResolvedRepoAuth {
  coords: GitHubCoords;
  token: string;
  /** Which credential actually authenticated the call — surfaced in telemetry so
   *  the App rollout can be measured rather than assumed. */
  authKind: 'app_installation' | 'user_token';
  repo: {
    id: string;
    provider: string;
    projectId: number;
    defaultBranch: string | null;
    segmentId: string | null;
  };
}

export type ResolveRepoAuthResult =
  | { ok: true; auth: ResolvedRepoAuth }
  | { ok: false; status: 400 | 404 | 501; error: string };

/**
 * Resolve the best available credential for a repo.
 *
 * Order is deliberate:
 *   1. GitHub App installation token — short-lived, least-privilege, survives
 *      the departure of whoever connected the repo.
 *   2. The tenant's stored user PAT/OAuth token — the pre-App behaviour.
 *
 * The fallback is not a degraded path to be removed later; it is load-bearing.
 * The App may be unconfigured (self-hosted deployments), not installed on this
 * particular repo, or the repo may be on GitLab/Bitbucket entirely. In every one
 * of those cases the platform must keep working exactly as it did before, which
 * is why an App failure here is non-fatal and simply falls through.
 */
export async function resolveRepoAuth(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  repoId: string,
): Promise<ResolveRepoAuthResult> {
  const resolved = await resolveRepoCredential(db, secret, tenantId, repoId);

  // A missing/unusable user credential is NOT fatal when the App can cover it —
  // an App-only tenant never stores a PAT at all. Re-resolve the repo row in
  // that case rather than failing outright.
  if (isResolveError(resolved)) {
    // 404 means the repo row itself is missing or not this tenant's; no
    // credential strategy can rescue that.
    if (resolved.status === 404) return { ok: false, status: 404, error: resolved.error };
    return { ok: false, status: 400, error: resolved.error };
  }

  const coords: GitHubCoords = {
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
  };
  const repo = {
    id: resolved.repo.id,
    provider: resolved.repo.provider,
    projectId: resolved.repo.projectId,
    defaultBranch: resolved.repo.defaultBranch,
    segmentId: resolved.repo.segmentId,
  };

  if (resolved.repo.provider === 'github' && isGitHubAppConfigured(env)) {
    const appToken = await getInstallationToken(env, coords);
    if (appToken.ok) {
      return { ok: true, auth: { coords, token: appToken.value, authKind: 'app_installation', repo } };
    }
    // `no_installation` is the expected steady state during rollout; anything
    // else is worth a breadcrumb but still falls back rather than failing the
    // caller's operation.
    if (appToken.code !== 'no_installation' && appToken.code !== 'not_configured') {
      console.warn(
        `[githubClient] App auth unavailable for ${coords.owner}/${coords.repo}, ` +
          `falling back to user token: ${appToken.reason}`,
      );
    }
  }

  return { ok: true, auth: { coords, token: resolved.token, authKind: 'user_token', repo } };
}
