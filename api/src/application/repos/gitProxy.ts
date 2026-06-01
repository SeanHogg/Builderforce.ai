/**
 * gitProxy — PURE helpers for the server-side git smart-HTTP proxy.
 *
 * A browser agent runs isomorphic-git against `/api/git-proxy/:repoId/...`; the
 * proxy forwards to the real provider with the tenant's credential injected
 * SERVER-SIDE, so a push/clone token never reaches the browser (the security
 * boundary that makes in-browser coding safe). These helpers build the upstream
 * URL + auth header and gate which smart-HTTP paths are allowed; the route does
 * the streaming fetch.
 */

export type GitProvider = 'github' | 'bitbucket' | 'gitlab';

export interface ProxyRepo {
  provider: string;       // github | bitbucket | gitlab
  host: string | null;    // e.g. github.com, gitlab.example.com
  owner: string;
  repo: string;
}

/** The smart-HTTP sub-paths a git client legitimately requests. */
const ALLOWED_SUBPATHS = new Set(['info/refs', 'git-upload-pack', 'git-receive-pack']);

/** True iff `subPath` is a smart-HTTP endpoint we will proxy (no path escapes). */
export function isAllowedGitPath(subPath: string): boolean {
  const clean = subPath.replace(/^\/+/, '');
  if (clean.includes('..')) return false;
  return ALLOWED_SUBPATHS.has(clean);
}

function defaultHost(provider: string): string {
  switch (provider) {
    case 'gitlab': return 'gitlab.com';
    case 'bitbucket': return 'bitbucket.org';
    case 'github':
    default: return 'github.com';
  }
}

/**
 * Build the upstream git URL: `https://<host>/<owner>/<repo>.git/<subPath>`.
 * Throws on a disallowed sub-path so the route can 400 rather than proxy junk.
 */
export function buildUpstreamGitUrl(repo: ProxyRepo, subPath: string, query?: string): string {
  if (!isAllowedGitPath(subPath)) {
    throw new Error(`Disallowed git proxy path: ${subPath}`);
  }
  const host = (repo.host ?? '').trim() || defaultHost(repo.provider);
  const clean = subPath.replace(/^\/+/, '');
  const base = `https://${host}/${repo.owner}/${repo.repo}.git/${clean}`;
  return query ? `${base}?${query}` : base;
}

/**
 * Build the Authorization header value for the provider. GitHub/GitLab/Bitbucket
 * all accept HTTP Basic with the token; GitHub's convention is the
 * `x-access-token:<token>` username. Returned as a full header value.
 */
export function buildGitAuthHeader(provider: string, token: string): string {
  const user =
    provider === 'gitlab' ? 'oauth2'
    : provider === 'bitbucket' ? 'x-token-auth'
    : 'x-access-token';
  const basic = Buffer.from(`${user}:${token}`).toString('base64');
  return `Basic ${basic}`;
}

/** The service name for an info/refs advertisement, validated. */
export function parseGitService(query: string | null): 'git-upload-pack' | 'git-receive-pack' | null {
  if (!query) return null;
  const m = query.match(/service=(git-upload-pack|git-receive-pack)/);
  return (m?.[1] as 'git-upload-pack' | 'git-receive-pack' | undefined) ?? null;
}
