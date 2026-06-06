/**
 * createPullRequest — open a PR on the provider with the tenant's decrypted git
 * token, server-side. This closes the browser/cloud coding loop: the agent
 * pushes a branch through the git-proxy, then asks the API to open the PR (the
 * browser never holds the token, and the provider API call must run server-side
 * anyway for CORS + secret reasons).
 *
 * GitHub is implemented; bitbucket/gitlab return a typed `unsupported` result so
 * callers degrade to "branch pushed, open PR manually" rather than crashing.
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

/**
 * Open a GitHub pull request via the REST API. A 422 "A pull request already
 * exists" is treated as success-by-lookup so a retried dispatch is idempotent.
 */
export async function createPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
  if (input.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `PR creation not implemented for provider '${input.provider}'` };
  }

  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  const url = `${apiBase}/repos/${input.owner}/${input.repo}/pulls`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PR/1.0',
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body }),
  });

  if (res.ok) {
    const pr = (await res.json()) as { number?: number; html_url?: string };
    if (typeof pr.number === 'number' && typeof pr.html_url === 'string') {
      return { ok: true, number: pr.number, url: pr.html_url };
    }
    return { ok: false, code: 'provider_error', reason: 'GitHub returned a PR without number/url' };
  }

  // Idempotency: a PR for this head may already be open — resolve it instead.
  if (res.status === 422) {
    const existing = await findOpenPr(apiBase, headers, input);
    if (existing) return { ok: true, number: existing.number, url: existing.url };
  }

  const text = await res.text().catch(() => '');
  return { ok: false, code: 'provider_error', reason: `GitHub ${res.status}: ${text.slice(0, 300)}` };
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
