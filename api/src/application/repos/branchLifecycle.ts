/**
 * branchLifecycle — the DESTRUCTIVE half of the repo-provider surface: delete a
 * branch, close a pull/merge request, and list the commits a branch carries ahead
 * of its base (the evidence any destructive decision is made on).
 *
 * These exist so an autonomous run can be cleaned up or undone. Everything here
 * follows the established convention in this directory (see `createPullRequest`,
 * `mergePullRequest`): a pure `build*Request` builder per operation so each
 * provider's documented endpoint is unit-testable without a live API, a thin
 * `fetch` executor, a discriminated `{ ok: true … } | { ok: false; code; reason }`
 * result, and NEVER a throw.
 *
 * GitHub, GitLab, Bitbucket Cloud AND Bitbucket Server (self-hosted Data Center,
 * whose `/rest/api/1.0` dialect is a different API with different path shapes) are
 * implemented for all three operations. Anything else returns a typed `unsupported`
 * result so the caller can record the residue rather than silently no-op — a
 * destructive operation that quietly does nothing is worse than one that refuses
 * out loud.
 */
import {
  bitbucketServerRepoPath, buildBitbucketServerBranchUtilsBase, buildGitApiBaseUrl,
  resolveGitApiFlavor, type GitApiFlavor,
} from './gitProxy';

const SUPPORTED: ReadonlySet<string> = new Set(['github', 'gitlab', 'bitbucket']);

/** Common provider addressing for every operation in this module. */
export interface RepoTarget {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
}

function gitlabProject(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

/** Resolve the REST dialect + its API base in one step. Every builder below goes
 *  through this so the Bitbucket Cloud/Server split is decided ONCE. Throws on an
 *  unmapped provider, which each executor maps to `unsupported`. */
function apiFor(target: { provider: string; host: string | null }): { flavor: GitApiFlavor; apiBase: string } {
  const flavor = resolveGitApiFlavor(target.provider, target.host);
  return { flavor, apiBase: buildGitApiBaseUrl(target.provider, target.host, { allowBitbucketServer: true }) };
}

/** Encode a ref for a URL PATH segment while preserving its slashes — a ticket
 *  branch is `builderforce/task-12`, and collapsing that slash 404s. */
function encodeRefPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function headers(token: string, agent: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': agent,
    'Content-Type': 'application/json',
  };
}

// ── delete branch ─────────────────────────────────────────────────────────────

export interface DeleteBranchInput extends RepoTarget {
  branch: string;
}

export type DeleteBranchResult =
  | { ok: true; deleted: boolean }
  | { ok: false; code: 'unsupported' | 'not_found' | 'protected' | 'provider_error'; reason: string };

/** Build the provider-specific delete-branch request. Pure + exported for tests.
 *  `body` is present only for Bitbucket Server, which names the ref in the payload
 *  rather than the path. */
export function buildDeleteBranchRequest(input: DeleteBranchInput): { url: string; method: 'DELETE'; body?: Record<string, unknown> } {
  const { flavor, apiBase } = apiFor(input);
  if (flavor === 'gitlab') {
    // DELETE /projects/:id/repository/branches/:branch — GitLab wants the branch
    // FULLY encoded here (slash included) as a single path component.
    return {
      url: `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/repository/branches/${encodeURIComponent(input.branch)}`,
      method: 'DELETE',
    };
  }
  if (flavor === 'bitbucket-cloud') {
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/refs/branches/${encodeRefPath(input.branch)}`,
      method: 'DELETE',
    };
  }
  if (flavor === 'bitbucket-server') {
    // Bitbucket Server keeps branch deletion on the branch-utils plugin API, and
    // takes the ref in the BODY (fully qualified). `dryRun: false` is explicit so
    // the destructive intent is visible in the request, not just its absence.
    return {
      url: `${buildBitbucketServerBranchUtilsBase(input.host)}${bitbucketServerRepoPath(input.owner, input.repo)}/branches`,
      method: 'DELETE',
      body: { name: `refs/heads/${input.branch}`, dryRun: false },
    };
  }
  // GitHub: DELETE /repos/:owner/:repo/git/refs/heads/:branch.
  return {
    url: `${apiBase}/repos/${input.owner}/${input.repo}/git/refs/heads/${encodeRefPath(input.branch)}`,
    method: 'DELETE',
  };
}

/**
 * Delete a branch. A 404 is reported as `ok: true, deleted: false` — the branch is
 * already gone, which is the caller's desired end state, so a retried teardown is
 * idempotent. A 403/405 (branch protection, or a token without the right scope) is
 * surfaced as `protected` so the caller records residue instead of retrying.
 *
 * SAFETY: this function performs NO safety checks of its own. Every precondition
 * (not the default branch, no open PR, no foreign commits) is decided ONCE in
 * {@link decideBranchTeardown} and must be satisfied before calling this.
 */
export async function deleteBranch(input: DeleteBranchInput): Promise<DeleteBranchResult> {
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `branch delete not implemented for provider '${input.provider}'` };
  }
  if (!input.branch.trim()) {
    return { ok: false, code: 'provider_error', reason: 'branch name is empty' };
  }

  let req: { url: string; method: 'DELETE'; body?: Record<string, unknown> };
  try {
    req = buildDeleteBranchRequest(input);
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const res = await fetch(req.url, {
    method: req.method,
    headers: headers(input.token, 'BuilderForce-Branch-Delete/1.0'),
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'branch-delete request failed (network)' };
  if (res.ok || res.status === 204) return { ok: true, deleted: true };
  if (res.status === 404) return { ok: true, deleted: false };
  const text = await res.text().catch(() => '');
  if (res.status === 403 || res.status === 405) {
    return { ok: false, code: 'protected', reason: `${input.provider} refused the delete (protected branch or insufficient scope): ${text.slice(0, 200)}` };
  }
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
}

// ── close pull request ────────────────────────────────────────────────────────

export interface ClosePrInput extends RepoTarget {
  number: number;
}

export type ClosePrResult =
  | { ok: true; closed: boolean }
  | { ok: false; code: 'unsupported' | 'not_found' | 'already_merged' | 'provider_error'; reason: string };

/** Build the provider-specific close-PR request. Pure + exported for tests. */
export function buildClosePrRequest(input: ClosePrInput): { url: string; method: 'PATCH' | 'PUT' | 'POST'; body: Record<string, unknown> } {
  const { flavor, apiBase } = apiFor(input);
  if (flavor === 'gitlab') {
    // PUT /projects/:id/merge_requests/:iid with the `close` state event.
    return {
      url: `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/merge_requests/${input.number}`,
      method: 'PUT',
      body: { state_event: 'close' },
    };
  }
  if (flavor === 'bitbucket-cloud') {
    // Bitbucket calls this "decline"; it is the same end state (PR no longer open).
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/pullrequests/${input.number}/decline`,
      method: 'POST',
      body: {},
    };
  }
  if (flavor === 'bitbucket-server') {
    // Server's decline is optimistic-locking: `version=-1` means "whatever the
    // current version is", which is what we want — we are declining the PR
    // outright, not merging a concurrent edit.
    return {
      url: `${apiBase}${bitbucketServerRepoPath(input.owner, input.repo)}/pull-requests/${input.number}/decline?version=-1`,
      method: 'POST',
      body: {},
    };
  }
  // GitHub: PATCH /repos/:owner/:repo/pulls/:n { state: 'closed' }.
  return {
    url: `${apiBase}/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
    method: 'PATCH',
    body: { state: 'closed' },
  };
}

/**
 * Close (GitHub/GitLab) or decline (Bitbucket) an open pull request.
 *
 * A MERGED pull request cannot be closed and must never be silently treated as
 * closed — providers answer with a 405/409/422 in that case, which is mapped to
 * `already_merged` so the caller can refuse the whole revert rather than proceed
 * to delete a branch whose work is already on the default branch.
 */
export async function closePullRequest(input: ClosePrInput): Promise<ClosePrResult> {
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `PR close not implemented for provider '${input.provider}'` };
  }

  let req: { url: string; method: 'PATCH' | 'PUT' | 'POST'; body: Record<string, unknown> };
  try {
    req = buildClosePrRequest(input);
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const res = await fetch(req.url, {
    method: req.method,
    headers: headers(input.token, 'BuilderForce-PR-Close/1.0'),
    body: JSON.stringify(req.body),
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'PR-close request failed (network)' };
  if (res.ok) return { ok: true, closed: true };
  if (res.status === 404) return { ok: false, code: 'not_found', reason: `pull request #${input.number} not found` };

  const text = await res.text().catch(() => '');
  // A merged PR is terminal on every provider: GitHub 422, GitLab 405/422,
  // Bitbucket 555/409 on decline. Detect on the message rather than the status
  // alone, since the same statuses cover other validation failures.
  if (/merged/i.test(text) && (res.status === 405 || res.status === 409 || res.status === 422)) {
    return { ok: false, code: 'already_merged', reason: `pull request #${input.number} is already merged and cannot be closed` };
  }
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
}

// ── list branch commits (the evidence for a destructive decision) ──────────────

export interface BranchCommit {
  sha: string;
  message: string;
  authorName: string | null;
}

export interface ListBranchCommitsInput extends RepoTarget {
  /** The base the branch forked from — only commits AHEAD of this are returned. */
  base: string;
  branch: string;
}

export type ListBranchCommitsResult =
  | { ok: true; commits: BranchCommit[]; truncated: boolean }
  | { ok: false; code: 'unsupported' | 'provider_error'; reason: string };

/** Commits requested per provider page. Every provider caps its page size at 100,
 *  so this is the largest page any of them will honour. */
export const MAX_BRANCH_COMMITS = 100;

/**
 * ABSOLUTE upper bound across all pages. Pagination exists so a long agent branch
 * can still be verified; this bound exists so a pathological branch (or a provider
 * that keeps handing back a `next`) cannot spin the loop forever inside a Worker
 * request. Hitting it is NOT a licence to delete: the listing comes back
 * `truncated`, which {@link decideBranchTeardown} still turns into a
 * `commits_unverifiable` refusal. Partial evidence keeps the branch.
 */
export const MAX_TOTAL_BRANCH_COMMITS = 1000;

/** Pages we will ever request — derived, so the two constants cannot drift. */
const MAX_COMMIT_PAGES = Math.ceil(MAX_TOTAL_BRANCH_COMMITS / MAX_BRANCH_COMMITS);

/**
 * Build the provider-specific "commits on `branch` ahead of `base`" URL for a
 * 1-based `page`. Pure.
 *
 * GitLab uses `/repository/commits?ref_name=<base>..<branch>` rather than
 * `/repository/compare`: compare returns ONE unpaginated (and provider-capped)
 * payload, so it can never verify a long branch, while the commits endpoint pages.
 */
export function buildListBranchCommitsUrl(input: ListBranchCommitsInput, page = 1): string {
  const { flavor, apiBase } = apiFor(input);
  if (flavor === 'gitlab') {
    return `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/repository/commits`
      + `?ref_name=${encodeURIComponent(`${input.base}..${input.branch}`)}`
      + `&per_page=${MAX_BRANCH_COMMITS}&page=${page}`;
  }
  if (flavor === 'bitbucket-cloud') {
    // Bitbucket Cloud has no compare endpoint; `include`/`exclude` on /commits is
    // the documented equivalent of `base..branch`.
    return `${apiBase}/repositories/${input.owner}/${input.repo}/commits`
      + `?include=${encodeURIComponent(input.branch)}&exclude=${encodeURIComponent(input.base)}`
      + `&pagelen=${MAX_BRANCH_COMMITS}&page=${page}`;
  }
  if (flavor === 'bitbucket-server') {
    // Server pages by absolute offset (`start`), not page number.
    return `${apiBase}${bitbucketServerRepoPath(input.owner, input.repo)}/commits`
      + `?until=${encodeURIComponent(input.branch)}&since=${encodeURIComponent(input.base)}`
      + `&limit=${MAX_BRANCH_COMMITS}&start=${(page - 1) * MAX_BRANCH_COMMITS}`;
  }
  return `${apiBase}/repos/${input.owner}/${input.repo}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.branch)}`
    + `?per_page=${MAX_BRANCH_COMMITS}&page=${page}`;
}

/** Parse a provider's commit-listing body into the shared `BranchCommit` shape.
 *  Tolerates both shapes each provider can answer with — GitLab's paged commits
 *  endpoint returns a bare ARRAY while compare wraps it in `{ commits }`, and
 *  Bitbucket Cloud (`hash`/`author.raw`) and Server (`id`/`author.displayName`)
 *  share the `values` envelope with different keys. */
export function parseBranchCommits(provider: string, body: unknown): BranchCommit[] {
  const b = (body ?? {}) as Record<string, unknown>;
  if (provider === 'gitlab') {
    const list = (Array.isArray(body) ? body : b.commits ?? []) as Array<{ id?: string; message?: string; title?: string; author_name?: string }>;
    return list.map((c) => ({ sha: c.id ?? '', message: c.message ?? c.title ?? '', authorName: c.author_name ?? null }));
  }
  if (provider === 'bitbucket') {
    const list = (b.values ?? []) as Array<{
      hash?: string; id?: string; message?: string;
      author?: { raw?: string; displayName?: string; name?: string; user?: { display_name?: string } };
    }>;
    return list.map((c) => ({
      sha: c.hash ?? c.id ?? '',
      message: c.message ?? '',
      authorName: c.author?.user?.display_name ?? c.author?.displayName ?? c.author?.raw ?? c.author?.name ?? null,
    }));
  }
  const list = (b.commits ?? []) as Array<{ sha?: string; commit?: { message?: string; author?: { name?: string } } }>;
  return list.map((c) => ({ sha: c.sha ?? '', message: c.commit?.message ?? '', authorName: c.commit?.author?.name ?? null }));
}

/**
 * Whether a page body is the LAST one. Prefer the provider's own signal where it
 * has one (Bitbucket Server's `isLastPage`, Cloud's `next`, GitHub's
 * `total_commits`) and fall back to a short page — a full page with no signal is
 * assumed to have more behind it, so the loop is only stopped by real evidence or
 * by {@link MAX_TOTAL_BRANCH_COMMITS}.
 */
function isLastCommitPage(flavor: GitApiFlavor, body: unknown, pageCount: number, collected: number): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  if (flavor === 'bitbucket-server') {
    if (typeof b.isLastPage === 'boolean') return b.isLastPage;
  } else if (flavor === 'bitbucket-cloud') {
    if (typeof b.next === 'string' && b.next) return false;
    if ('next' in b) return true;
  } else if (flavor === 'github') {
    const total = b.total_commits;
    if (typeof total === 'number') return collected >= total;
  }
  return pageCount < MAX_BRANCH_COMMITS;
}

/**
 * List the commits `branch` carries ahead of `base`, following the provider's
 * pagination up to {@link MAX_TOTAL_BRANCH_COMMITS}. This is the evidence the
 * teardown/revert decision runs on — if it cannot be obtained, nothing is deleted.
 *
 * A 404 (branch never pushed) is an EMPTY listing, not an error: there is simply
 * no branch, and the decision function turns that into a `branch_missing` refusal.
 * A 404 on a LATER page is different — the branch moved under us mid-listing — so
 * it is reported as truncated evidence rather than as a shorter, falsely complete
 * list.
 */
export async function listBranchCommits(input: ListBranchCommitsInput): Promise<ListBranchCommitsResult> {
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `commit listing not implemented for provider '${input.provider}'` };
  }
  if (input.base.trim() === input.branch.trim()) {
    return { ok: true, commits: [], truncated: false };
  }

  let flavor: GitApiFlavor;
  try {
    flavor = resolveGitApiFlavor(input.provider, input.host);
    buildListBranchCommitsUrl(input, 1); // fail fast on an unmappable host
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const collected: BranchCommit[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const res = await fetch(buildListBranchCommitsUrl(input, page), {
      headers: headers(input.token, 'BuilderForce-Branch-Commits/1.0'),
    }).catch(() => null);
    if (!res) return { ok: false, code: 'provider_error', reason: 'commit-listing request failed (network)' };
    if (res.status === 404) {
      if (page === 1) return { ok: true, commits: [], truncated: false };
      return { ok: true, commits: collected, truncated: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
    }

    const body = await res.json().catch(() => null);
    const pageCommits = parseBranchCommits(input.provider, body);
    // De-duplicate across pages: a branch that gains a commit mid-listing shifts
    // every later page by one, which would otherwise double-count a commit and
    // make an honest branch look like it carries more work than it does.
    for (const c of pageCommits) {
      if (c.sha && seen.has(c.sha)) continue;
      if (c.sha) seen.add(c.sha);
      collected.push(c);
    }
    if (pageCommits.length === 0) return { ok: true, commits: collected, truncated: false };
    if (isLastCommitPage(flavor, body, pageCommits.length, collected.length)) {
      return { ok: true, commits: collected, truncated: false };
    }
    if (collected.length >= MAX_TOTAL_BRANCH_COMMITS) break;
  }

  // The absolute bound was reached with the provider still offering more. The
  // evidence is incomplete, so it is reported as such and the branch is kept.
  return { ok: true, commits: collected.slice(0, MAX_TOTAL_BRANCH_COMMITS), truncated: true };
}
