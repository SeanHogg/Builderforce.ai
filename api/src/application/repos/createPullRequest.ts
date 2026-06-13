/**
 * createPullRequest — open a PR on the provider with the tenant's decrypted git
 * token, server-side. This closes the browser/cloud coding loop: the agent
 * pushes a branch through the git-proxy, then asks the API to open the PR (the
 * browser never holds the token, and the provider API call must run server-side
 * anyway for CORS + secret reasons).
 *
 * GitHub, GitLab, and Bitbucket Cloud are implemented; other providers (e.g.
 * Bitbucket Server) return a typed `unsupported` result so callers degrade to
 * "branch pushed, open PR manually" rather than crashing.
 */
import { buildGitApiBaseUrl } from './gitProxy';

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
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  if (input.provider === 'gitlab') {
    const projectId = encodeURIComponent(`${input.owner}/${input.repo}`);
    return {
      url: `${apiBase}/projects/${projectId}/merge_requests`,
      body: { source_branch: input.head, target_branch: input.base, title: input.title, description: input.body },
    };
  }
  if (input.provider === 'bitbucket') {
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/pullrequests`,
      body: {
        title: input.title,
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } },
        description: input.body,
      },
    };
  }
  return {
    url: `${apiBase}/repos/${input.owner}/${input.repo}/pulls`,
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
    const url = ((b.links as { html?: { href?: string } } | undefined)?.html?.href) as string | undefined;
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

  // Idempotency (GitHub): a PR for this head may already be open — resolve it.
  if (input.provider === 'github' && res.status === 422) {
    const existing = await findOpenPr(buildGitApiBaseUrl(input.provider, input.host), headers, input);
    if (existing) return { ok: true, number: existing.number, url: existing.url };
  }

  const text = await res.text().catch(() => '');
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 300)}` };
}

/** Look up an already-open PR for `owner:head` so retries are idempotent. */
async function findOpenPr(
  apiBase: string,
  headers: Record<string, string>,
  input: OpenPrInput,
): Promise<{ number: number; url: string } | null> {
  const q = `${apiBase}/repos/${input.owner}/${input.repo}/pulls?state=open&head=${encodeURIComponent(`${input.owner}:${input.head}`)}`;
  const res = await fetch(q, { headers });
  if (!res.ok) return null;
  const list = (await res.json()) as Array<{ number?: number; html_url?: string }>;
  const first = list[0];
  if (first && typeof first.number === 'number' && typeof first.html_url === 'string') {
    return { number: first.number, url: first.html_url };
  }
  return null;
}
