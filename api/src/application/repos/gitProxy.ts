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

/**
 * Which REST dialect a (provider, host) pair speaks. Bitbucket is TWO products
 * with two incompatible APIs — Cloud's `/2.0/repositories/:owner/:repo/...` and
 * Server's (Data Center's) `/rest/api/1.0/projects/:key/repos/:slug/...` — so the
 * provider string alone is not enough to shape a URL. Callers that only know the
 * Cloud path shapes must keep asking for `buildGitApiBaseUrl` WITHOUT
 * `allowBitbucketServer` so they still refuse out loud on a Server host, rather
 * than aiming Cloud-shaped paths at an API that has never had them.
 */
export type GitApiFlavor = 'github' | 'gitlab' | 'bitbucket-cloud' | 'bitbucket-server';

/** Resolve the REST dialect for a repo. Throws for a provider we have no API for. */
export function resolveGitApiFlavor(provider: string, host: string | null): GitApiFlavor {
  const h = (host ?? '').trim();
  if (provider === 'github') return 'github';
  if (provider === 'gitlab') return 'gitlab';
  if (provider === 'bitbucket') return !h || h === 'bitbucket.org' ? 'bitbucket-cloud' : 'bitbucket-server';
  throw new Error(`No REST API base for provider '${provider}'`);
}

export interface GitApiBaseOptions {
  /**
   * Opt in to the Bitbucket Server 1.0 base. OFF by default and deliberately so:
   * the returned base is NOT interchangeable with the Cloud one, so only a caller
   * that shapes Server paths itself (see `bitbucketServerRepoPath`) may set it.
   * Every other caller keeps the historical throw → typed `unsupported` refusal.
   */
  allowBitbucketServer?: boolean;
}

/**
 * Build the provider REST API base URL for a repo's host.
 *   - GitHub: api.github.com (cloud) or `https://<host>/api/v3` (Enterprise).
 *   - GitLab: `https://<host||gitlab.com>/api/v4` (cloud + self-managed).
 *   - Bitbucket Cloud: `https://api.bitbucket.org/2.0`.
 *   - Bitbucket Server (self-hosted): `https://<host>/rest/api/1.0`, but ONLY when
 *     the caller passes `allowBitbucketServer` to declare it speaks that dialect.
 */
export function buildGitApiBaseUrl(provider: string, host: string | null, opts: GitApiBaseOptions = {}): string {
  const h = (host ?? '').trim();
  const flavor = resolveGitApiFlavor(provider, host);
  if (flavor === 'github') {
    if (!h || h === 'github.com') return 'https://api.github.com';
    return `https://${h}/api/v3`;
  }
  if (flavor === 'gitlab') {
    return `https://${!h || h === 'gitlab.com' ? 'gitlab.com' : h}/api/v4`;
  }
  if (flavor === 'bitbucket-cloud') return 'https://api.bitbucket.org/2.0';
  if (!opts.allowBitbucketServer) {
    throw new Error('Bitbucket Server (self-hosted) REST API is not supported');
  }
  return `https://${h}/rest/api/1.0`;
}

/**
 * The repo-addressing path segment for Bitbucket Server: `/projects/:key/repos/:slug`.
 * The `owner` we hold for a Server repo IS the project key (or `~user` for a personal
 * repo, which is why the value is passed through verbatim rather than upper-cased).
 */
export function bitbucketServerRepoPath(owner: string, repo: string): string {
  return `/projects/${encodeURIComponent(owner)}/repos/${encodeURIComponent(repo)}`;
}

/**
 * Bitbucket Server keeps branch DELETION on a separate plugin API
 * (`/rest/branch-utils/1.0`), not on `/rest/api/1.0` — a delete aimed at the core
 * base 404s, which would read as "already gone" and silently lose the residue.
 */
export function buildBitbucketServerBranchUtilsBase(host: string | null): string {
  const h = (host ?? '').trim();
  if (!h) throw new Error('Bitbucket Server host is required');
  return `https://${h}/rest/branch-utils/1.0`;
}

/**
 * Stream a smart-HTTP git request to the upstream provider with the token
 * injected server-side. Shared by the tenant-JWT git-proxy (browser) and the
 * host-authed git-proxy (headless agentHost) so the upstream fetch + header
 * injection + response streaming live in ONE place. Returns a tagged shape the
 * caller maps to an HTTP response (so this stays free of any web framework).
 */
export async function executeGitProxy(opts: {
  repo: ProxyRepo;
  token: string;
  subPath: string;
  method: 'GET' | 'POST';
  query?: string;
  contentType?: string;
  body?: ArrayBuffer;
}): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  let upstreamUrl: string;
  try {
    upstreamUrl = buildUpstreamGitUrl(opts.repo, opts.subPath, opts.query || undefined);
  } catch {
    return { ok: false, error: 'Disallowed git path' };
  }

  const headers: Record<string, string> = {
    Authorization: buildGitAuthHeader(opts.repo.provider, opts.token),
    'User-Agent': 'BuilderForce-Git-Proxy/1.0',
  };
  if (opts.contentType) headers['Content-Type'] = opts.contentType;

  const init: RequestInit = { method: opts.method, headers };
  if (opts.method === 'POST') init.body = opts.body;

  const upstream = await fetch(upstreamUrl, init);
  const respHeaders = new Headers();
  const ct = upstream.headers.get('Content-Type');
  if (ct) respHeaders.set('Content-Type', ct);
  respHeaders.set('Cache-Control', 'no-cache');
  return { ok: true, response: new Response(upstream.body, { status: upstream.status, headers: respHeaders }) };
}

/** The service name for an info/refs advertisement, validated. */
export function parseGitService(query: string | null): 'git-upload-pack' | 'git-receive-pack' | null {
  if (!query) return null;
  const m = query.match(/service=(git-upload-pack|git-receive-pack)/);
  return (m?.[1] as 'git-upload-pack' | 'git-receive-pack' | undefined) ?? null;
}
