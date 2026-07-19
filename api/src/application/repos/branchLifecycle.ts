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
 * GitHub, GitLab, and Bitbucket Cloud are implemented for all three operations.
 * Anything else (notably Bitbucket Server, which has no mapped REST base) returns
 * a typed `unsupported` result so the caller can record the residue rather than
 * silently no-op — a destructive operation that quietly does nothing is worse
 * than one that refuses out loud.
 */
import { buildGitApiBaseUrl } from './gitProxy';

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

/** Build the provider-specific delete-branch request. Pure + exported for tests. */
export function buildDeleteBranchRequest(input: DeleteBranchInput): { url: string; method: 'DELETE' } {
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  if (input.provider === 'gitlab') {
    // DELETE /projects/:id/repository/branches/:branch — GitLab wants the branch
    // FULLY encoded here (slash included) as a single path component.
    return {
      url: `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/repository/branches/${encodeURIComponent(input.branch)}`,
      method: 'DELETE',
    };
  }
  if (input.provider === 'bitbucket') {
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/refs/branches/${encodeRefPath(input.branch)}`,
      method: 'DELETE',
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

  let req: { url: string; method: 'DELETE' };
  try {
    req = buildDeleteBranchRequest(input);
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const res = await fetch(req.url, { method: req.method, headers: headers(input.token, 'BuilderForce-Branch-Delete/1.0') }).catch(() => null);
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
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  if (input.provider === 'gitlab') {
    // PUT /projects/:id/merge_requests/:iid with the `close` state event.
    return {
      url: `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/merge_requests/${input.number}`,
      method: 'PUT',
      body: { state_event: 'close' },
    };
  }
  if (input.provider === 'bitbucket') {
    // Bitbucket calls this "decline"; it is the same end state (PR no longer open).
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/pullrequests/${input.number}/decline`,
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

/** Hard cap. If a branch carries more commits than this we cannot prove authorship
 *  of all of them, so the listing is marked truncated and the teardown decision
 *  REFUSES rather than deleting on partial evidence. */
export const MAX_BRANCH_COMMITS = 100;

/** Build the provider-specific "commits on `branch` ahead of `base`" URL. Pure. */
export function buildListBranchCommitsUrl(input: ListBranchCommitsInput): string {
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  if (input.provider === 'gitlab') {
    return `${apiBase}/projects/${gitlabProject(input.owner, input.repo)}/repository/compare`
      + `?from=${encodeURIComponent(input.base)}&to=${encodeURIComponent(input.branch)}`;
  }
  if (input.provider === 'bitbucket') {
    // Bitbucket Cloud has no compare endpoint; `include`/`exclude` on /commits is
    // the documented equivalent of `base..branch`.
    return `${apiBase}/repositories/${input.owner}/${input.repo}/commits`
      + `?include=${encodeURIComponent(input.branch)}&exclude=${encodeURIComponent(input.base)}&pagelen=${MAX_BRANCH_COMMITS}`;
  }
  return `${apiBase}/repos/${input.owner}/${input.repo}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.branch)}`;
}

/** Parse a provider's commit-listing body into the shared `BranchCommit` shape. */
export function parseBranchCommits(provider: string, body: unknown): BranchCommit[] {
  const b = (body ?? {}) as Record<string, unknown>;
  if (provider === 'gitlab') {
    const list = (b.commits ?? []) as Array<{ id?: string; message?: string; title?: string; author_name?: string }>;
    return list.map((c) => ({ sha: c.id ?? '', message: c.message ?? c.title ?? '', authorName: c.author_name ?? null }));
  }
  if (provider === 'bitbucket') {
    const list = (b.values ?? []) as Array<{ hash?: string; message?: string; author?: { raw?: string; user?: { display_name?: string } } }>;
    return list.map((c) => ({ sha: c.hash ?? '', message: c.message ?? '', authorName: c.author?.user?.display_name ?? c.author?.raw ?? null }));
  }
  const list = (b.commits ?? []) as Array<{ sha?: string; commit?: { message?: string; author?: { name?: string } } }>;
  return list.map((c) => ({ sha: c.sha ?? '', message: c.commit?.message ?? '', authorName: c.commit?.author?.name ?? null }));
}

/**
 * List the commits `branch` carries ahead of `base`. This is the evidence the
 * teardown/revert decision runs on — if it cannot be obtained, nothing is deleted.
 *
 * A 404 (branch never pushed) is an EMPTY listing, not an error: there is simply
 * no branch, and the decision function turns that into a `branch_missing` refusal.
 */
export async function listBranchCommits(input: ListBranchCommitsInput): Promise<ListBranchCommitsResult> {
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `commit listing not implemented for provider '${input.provider}'` };
  }
  if (input.base.trim() === input.branch.trim()) {
    return { ok: true, commits: [], truncated: false };
  }

  let url: string;
  try {
    url = buildListBranchCommitsUrl(input);
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const res = await fetch(url, { headers: headers(input.token, 'BuilderForce-Branch-Commits/1.0') }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'commit-listing request failed (network)' };
  if (res.status === 404) return { ok: true, commits: [], truncated: false };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
  }
  const commits = parseBranchCommits(input.provider, await res.json().catch(() => null));
  const truncated = commits.length > MAX_BRANCH_COMMITS;
  return { ok: true, commits: truncated ? commits.slice(0, MAX_BRANCH_COMMITS) : commits, truncated };
}
