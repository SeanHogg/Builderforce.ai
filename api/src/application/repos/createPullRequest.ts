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
import { reportedFallback } from '../observability/caughtErrorReporter';
import { resolveRepoApiTarget } from './repoApiTarget';

const SOURCE = 'application/repos/createPullRequest.ts';

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
  /** Open as a draft: GitHub `draft`, GitLab a `Draft:` title — only where {@link markReadyForReview} can undo it. Bitbucket opens a normal PR. */
  draft?: boolean;
}

export type OpenPrResult =
  /** `existing` is set (true) only when the provider REFUSED the create because a PR for this head was already open and
   *  this is that PR: the call did not create it. `draft` then says whether that existing PR is a draft (where the provider tells). */
  | { ok: true; number: number; url: string; existing?: true; draft?: boolean }
  /** `draft_unsupported`: a draft was asked for and the repository cannot have one (GitHub, private repo on a free plan). */
  | { ok: false; code: 'unsupported' | 'provider_error' | 'draft_unsupported'; reason: string };

/** The ONE provider request header set for the PR calls (create, lookup, mark-ready). */
export function prRequestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'BuilderForce-PR/1.0',
    'Content-Type': 'application/json',
  };
}

/** Build the provider-specific create-PR request (URL + body). Pure + exported
 *  so each provider's documented create endpoint/body is unit-testable. */
export function buildCreatePrRequest(input: OpenPrInput): { url: string; body: Record<string, unknown> } {
  const { flavor, ...api } = resolveRepoApiTarget(input);
  if (flavor === 'gitlab') {
    return {
      url: api.pullRequests(),
      body: { source_branch: input.head, target_branch: input.base, title: input.draft ? `Draft: ${input.title}` : input.title, description: input.body },
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
    body: { title: input.title, head: input.head, base: input.base, body: input.body, ...(input.draft ? { draft: true } : {}) },
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

  const headers = prRequestHeaders(input.token);

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
    if (existing) return { ok: true, number: existing.number, url: existing.url, existing: true, ...(existing.draft !== undefined ? { draft: existing.draft } : {}) };
  }

  const text = await res.text().catch(() => '');
  // GitHub refuses a draft on a private repository of a free plan with a 422 that names drafts.
  if (input.draft && res.status === 422 && /draft/i.test(text)) {
    return { ok: false, code: 'draft_unsupported', reason: `github 422: ${text.slice(0, 300)}` };
  }
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
): Promise<{ number: number; url: string; draft?: boolean; body?: string } | null> {
  let url: string;
  try { url = buildFindOpenPrUrl(input); } catch { return null; }
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null);
  // GitHub → array of pulls; GitLab → array of MRs; Bitbucket → { values: [...] }.
  const list = Array.isArray(body) ? body : ((body as { values?: unknown[] } | null)?.values ?? []);
  const first = (list as unknown[])[0];
  const parsed = first ? parseCreatePrSuccess(input.provider, first) : null;
  if (!parsed) return null;
  const { draft, body: text, description } = first as { draft?: unknown; body?: unknown; description?: unknown };
  const prBody = typeof text === 'string' ? text : typeof description === 'string' ? description : undefined;
  return { ...parsed, ...(typeof draft === 'boolean' ? { draft } : {}), ...(prBody !== undefined ? { body: prBody } : {}) };
}

/** The open PR for a head branch, with whether it is a draft and its body (the sweep's proof that a PR is the platform's own). Null when none. */
export async function lookupOpenPullRequest(input: OpenPrInput): Promise<{ number: number; url: string; draft?: boolean; body?: string } | null> {
  return findOpenPr(prRequestHeaders(input.token), input);
}

/** The `Draft:` marker GitLab puts on a draft merge request's title. */
const GITLAB_DRAFT_PREFIX = /^\s*(?:Draft:|\[Draft\]|\(Draft\))\s*/i;

export type MarkReadyResult = { ok: true } | { ok: false; reason: string };

/**
 * Take a PR the run opened as a draft out of draft, once its work is done. GitHub has no REST for this: the
 * GraphQL `markPullRequestReadyForReview` takes the PR's node id. GitLab has no draft flag, so the `Draft:`
 * title prefix is removed. Bitbucket needs nothing (it never opens a draft). A PR that is already ready is left
 * alone. `text` also sets the PR's final title and body, so a PR opened early for a build reads like any other.
 * Never throws.
 */
export async function markReadyForReview(input: Omit<OpenPrInput, 'head' | 'base' | 'title' | 'body' | 'draft'> & { number: number; text?: { title: string; body: string } }): Promise<MarkReadyResult> {
  try {
    if (input.provider === 'bitbucket') return await applyBitbucketText(input);
    if (input.provider !== 'github' && input.provider !== 'gitlab') return { ok: false, reason: `ready-for-review not implemented for provider '${input.provider}'` };
    const api = resolveRepoApiTarget(input);
    const headers = prRequestHeaders(input.token);
    const current = await fetch(api.pullRequest(input.number), { headers }).catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.readPr', context: { provider: input.provider, number: input.number } }));
    if (!current?.ok) return { ok: false, reason: `could not read PR #${input.number}${current ? ` (${current.status})` : ''}` };
    const pr = (await current.json().catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.parsePr', context: { provider: input.provider, number: input.number } }))) as { node_id?: string; title?: string; draft?: boolean } | null;
    if (api.flavor === 'gitlab') {
      const title = pr?.title ?? '';
      if (!GITLAB_DRAFT_PREFIX.test(title) && !input.text) return { ok: true };
      const update = { title: input.text?.title ?? title.replace(GITLAB_DRAFT_PREFIX, ''), ...(input.text ? { description: input.text.body } : {}) };
      const res = await fetch(api.pullRequest(input.number), { method: 'PUT', headers, body: JSON.stringify(update) }).catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.gitlabUndraft', context: { provider: input.provider, number: input.number } }));
      return res?.ok ? { ok: true } : { ok: false, reason: `gitlab ${res?.status ?? 'network'}: could not take the merge request out of draft` };
    }
    // Already ready (a human got there first): nothing to undo, and the mutation would be refused.
    if (pr?.draft !== false) {
      if (!pr?.node_id) return { ok: false, reason: 'GitHub returned no node id for the PR' };
      const res = await fetch(`${api.apiBase.replace(/\/v3\/?$/, '')}/graphql`, {
        method: 'POST', headers,
        body: JSON.stringify({
          query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }',
          variables: { id: pr.node_id },
        }),
      }).catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.githubGraphql', context: { provider: input.provider, number: input.number } }));
      const body = (await res?.json().catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.parseGraphql', context: { provider: input.provider, number: input.number } }))) as { errors?: Array<{ message?: string }> } | null;
      if (!res?.ok || body?.errors?.length) return { ok: false, reason: `github ${res?.status ?? 'network'}: ${body?.errors?.[0]?.message ?? 'mark ready failed'}`.slice(0, 300) };
    }
    if (input.text) {
      const patched = await fetch(api.pullRequest(input.number), { method: 'PATCH', headers, body: JSON.stringify({ title: input.text.title, body: input.text.body }) }).catch(reportedFallback(null, { source: SOURCE, operation: 'markReady.patchText', context: { provider: input.provider, number: input.number } }));
      if (!patched?.ok) return { ok: false, reason: `github ${patched?.status ?? 'network'}: could not update the PR title and body` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'mark ready failed' };
  }
}

/** Bitbucket never opens a draft, so there is nothing to undo: only the final text is applied (Server needs the PR's current `version`). */
async function applyBitbucketText(input: Parameters<typeof markReadyForReview>[0]): Promise<MarkReadyResult> {
  if (!input.text) return { ok: true };
  const api = resolveRepoApiTarget(input);
  const headers = prRequestHeaders(input.token);
  const update: Record<string, unknown> = { title: input.text.title, description: input.text.body };
  if (api.flavor === 'bitbucket-server') {
    const current = await fetch(api.pullRequest(input.number), { headers }).catch(reportedFallback(null, { source: SOURCE, operation: 'bitbucketText.readPr', context: { provider: input.provider, number: input.number } }));
    const pr = current?.ok ? (await current.json().catch(reportedFallback(null, { source: SOURCE, operation: 'bitbucketText.parsePr', context: { provider: input.provider, number: input.number } }))) as { version?: number; reviewers?: unknown } | null : null;
    if (typeof pr?.version !== 'number') return { ok: false, reason: `could not read PR #${input.number} to update it` };
    update.version = pr.version;
    if (pr.reviewers) update.reviewers = pr.reviewers; // Server drops reviewers a PUT leaves out
  }
  const res = await fetch(api.pullRequest(input.number), { method: 'PUT', headers, body: JSON.stringify(update) }).catch(reportedFallback(null, { source: SOURCE, operation: 'bitbucketText.put', context: { provider: input.provider, number: input.number } }));
  return res?.ok ? { ok: true } : { ok: false, reason: `bitbucket ${res?.status ?? 'network'}: could not update the PR title and description` };
}
