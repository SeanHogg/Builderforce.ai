/**
 * createPullRequest — open a PR on the provider with the tenant's decrypted git
 * token, server-side. This closes the browser/cloud coding loop: the agent
 * pushes a branch through the git-proxy, then asks the API to open the PR (the
 * browser never holds the token, and the provider API call must run server-side
 * anyway for CORS + secret reasons).
 *
 * GitHub, GitLab, Bitbucket Cloud and Bitbucket Server (self-hosted, whose
 * `/rest/api/1.0` dialect uses different paths AND a different request body) are
 * implemented; other providers return a typed `unsupported` result so callers
 * degrade to "branch pushed, open PR manually" rather than crashing.
 */
import { resolveRepoApiTarget } from './repoApiTarget';

export interface OpenPrInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  head: string;       // the branch the agent pushed
  base: string;       // the branch to merge into (repo default)
  title: string;
  body: string;
}

export type OpenPrResult =
  | { ok: true; number: number; url: string }
  | { ok: false; code: 'unsupported' | 'provider_error'; reason: string };

/** Build the provider-specific create-PR request (URL + body). Pure + exported
 *  so each provider's documented create endpoint/body is unit-testable. */
export function buildCreatePrRequest(input: OpenPrInput): { url: string; body: Record<string, unknown> } {
  const { flavor, ...api } = resolveRepoApiTarget(input);
  if (flavor === 'gitlab') {
    return {
      url: api.pullRequests(),
      body: { source_branch: input.head, target_branch: input.base, title: input.title, description: input.body },
    };
  }
  if (flavor === 'bitbucket-server') {
    // Server names branches as fully-qualified refs and repeats the repo coordinates
    // inside each ref (a PR may cross forks), so the body is nothing like Cloud's.
    const repository = { slug: input.repo, project: { key: input.owner } };
    return {
      url: api.pullRequests(),
      body: {
        title: input.title,
        description: input.body,
        fromRef: { id: `refs/heads/${input.head}`, repository },
        toRef: { id: `refs/heads/${input.base}`, repository },
      },
    };
  }
  if (flavor === 'bitbucket-cloud') {
    return {
      url: api.pullRequests(),
      body: {
        title: input.title,
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } },
        description: input.body,
      },
    };
  }
  return {
    url: api.pullRequests(),
    body: { title: input.title, head: input.head, base: input.base, body: input.body },
  };
}

/** Parse a provider's create-PR success body into `{ number, url }`. */
function parseCreatePrSuccess(provider: string, body: unknown): { number: number; url: string } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (provider === 'gitlab') {
    const number = b.iid as number | undefined;
    const url = b.web_url as string | undefined;
    return typeof number === 'number' && typeof url === 'string' ? { number, url } : null;
  }
  if (provider === 'bitbucket') {
    const number = b.id as number | undefined;
    // Cloud exposes the web link as `links.html.href`; Server as `links.self[0].href`.
    const links = b.links as { html?: { href?: string }; self?: Array<{ href?: string }> } | undefined;
    const url = links?.html?.href ?? links?.self?.[0]?.href;
    return typeof number === 'number' && typeof url === 'string' ? { number, url } : null;
  }
  const number = b.number as number | undefined;
  const url = b.html_url as string | undefined;
  return typeof number === 'number' && typeof url === 'string' ? { number, url } : null;
}

/**
 * Open a pull/merge request via the provider REST API. For GitHub a 422 "already
 * exists" is treated as success-by-lookup so a retried dispatch is idempotent;
 * GitLab/Bitbucket conflicts surface as a provider_error (caller degrades to
 * "open PR manually").
 */
export async function createPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
  const SUPPORTED = new Set(['github', 'gitlab', 'bitbucket']);
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `PR creation not implemented for provider '${input.provider}'` };
  }

  let req: { url: string; body: Record<string, unknown> };
  try {
    req = buildCreatePrRequest(input);
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/json',
    'User-Agent': 'BuilderForce-PR/1.0',
    'Content-Type': 'application/json',
  };

  const res = await fetch(req.url, { method: 'POST', headers, body: JSON.stringify(req.body) }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'PR-create request failed (network)' };

  if (res.ok) {
    const parsed = parseCreatePrSuccess(input.provider, await res.json().catch(() => null));
    if (parsed) return { ok: true, ...parsed };
    return { ok: false, code: 'provider_error', reason: `${input.provider} returned a PR without number/url` };
  }

  // Idempotency: a conflict-ish failure (GitHub 422 / GitLab+Bitbucket 409, some
  // 400s) usually means a PR for this head already exists — resolve it so a
  // retried create returns the existing PR instead of erroring. All three
  // providers now do this (was GitHub-only). A null lookup → fall to the error.
  if (res.status === 422 || res.status === 409 || res.status === 400) {
    const existing = await findOpenPr(headers, input);
    if (existing) return { ok: true, number: existing.number, url: existing.url };
  }

  const text = await res.text().catch(() => '');
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 300)}` };
}

/** Build the provider-specific "find the already-open PR for this head" request.
 *  The dialect comes from the SHAPED TARGET (not from sniffing `/rest/api/1.0`
 *  out of a base URL, which was the old way this function told the two Bitbucket
 *  editions apart). */
export function buildFindOpenPrUrl(input: OpenPrInput): string {
  const { flavor, ...api } = resolveRepoApiTarget(input);
  if (flavor === 'bitbucket-server') {
    // Server filters by the OUTGOING ref rather than a query language.
    return `${api.pullRequests()}?state=OPEN&direction=OUTGOING`
      + `&at=${encodeURIComponent(`refs/heads/${input.head}`)}`;
  }
  if (flavor === 'gitlab') {
    return `${api.pullRequests()}?state=opened&source_branch=${encodeURIComponent(input.head)}`
      + `&target_branch=${encodeURIComponent(input.base)}`;
  }
  if (flavor === 'bitbucket-cloud') {
    const q = encodeURIComponent(`source.branch.name="${input.head}" AND state="OPEN"`);
    return `${api.pullRequests()}?q=${q}`;
  }
  return `${api.pullRequests()}?state=open&head=${encodeURIComponent(`${input.owner}:${input.head}`)}`;
}

/** Resolve an already-open PR so retried creates are idempotent (all providers). */
async function findOpenPr(
  headers: Record<string, string>,
  input: OpenPrInput,
): Promise<{ number: number; url: string } | null> {
  let url: string;
  try { url = buildFindOpenPrUrl(input); } catch { return null; }
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null);
  // GitHub → array of pulls; GitLab → array of MRs; Bitbucket → { values: [...] }.
  const list = Array.isArray(body) ? body : ((body as { values?: unknown[] } | null)?.values ?? []);
  const first = (list as unknown[])[0];
  return first ? parseCreatePrSuccess(input.provider, first) : null;
}
