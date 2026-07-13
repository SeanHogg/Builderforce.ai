/**
 * Bring a pull request's head branch up to date with its base branch before merge.
 * Provider APIs keep credentials server-side and preserve the PR/branch identity.
 */
import { buildGitApiBaseUrl } from './gitProxy';

export interface UpdatePullRequestBranchInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  number: number;
}

export type UpdatePullRequestBranchResult =
  | { ok: true; updated: boolean }
  | { ok: false; code: 'conflict' | 'unsupported' | 'provider_error'; reason: string };

/** Update/rebase the PR head through the provider. Bitbucket Cloud does not expose
 * an equivalent safe "update branch" endpoint, so it falls through to normal merge. */
export async function updatePullRequestBranch(
  input: UpdatePullRequestBranchInput,
): Promise<UpdatePullRequestBranchResult> {
  if (input.provider === 'bitbucket') {
    return { ok: false, code: 'unsupported', reason: 'update branch is not supported by Bitbucket Cloud' };
  }
  if (input.provider !== 'github' && input.provider !== 'gitlab') {
    return { ok: false, code: 'unsupported', reason: `update branch not implemented for provider '${input.provider}'` };
  }

  let url: string;
  try {
    const apiBase = buildGitApiBaseUrl(input.provider, input.host);
    url = input.provider === 'gitlab'
      ? `${apiBase}/projects/${encodeURIComponent(`${input.owner}/${input.repo}`)}/merge_requests/${input.number}/rebase`
      : `${apiBase}/repos/${input.owner}/${input.repo}/pulls/${input.number}/update-branch`;
  } catch (e) {
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/json',
    'User-Agent': 'BuilderForce-PR-Merge/1.0',
    'Content-Type': 'application/json',
  };

  // Avoid repeatedly enqueueing an asynchronous GitLab rebase, and avoid relying
  // on provider-specific 422 text to recognize an already-current GitHub branch.
  const detailUrl = input.provider === 'gitlab'
    ? url.replace(/\/rebase$/, '?include_diverged_commits_count=true&include_rebase_in_progress=true')
    : url.replace(/\/update-branch$/, '');
  const detailRes = await fetch(detailUrl, { headers }).catch(() => null);
  if (detailRes?.ok) {
    const detail = await detailRes.json().catch(() => null) as Record<string, unknown> | null;
    if (input.provider === 'gitlab') {
      if (detail?.rebase_in_progress === true) return { ok: true, updated: true };
      if (detail?.has_conflicts === true || (typeof detail?.merge_error === 'string' && detail.merge_error.length > 0)) {
        return { ok: false, code: 'conflict', reason: `could not rebase PR branch: ${String(detail.merge_error ?? 'merge conflicts')}` };
      }
      if (detail && Number(detail.diverged_commits_count) === 0) return { ok: true, updated: false };
    } else {
      const state = detail?.mergeable_state;
      if (state === 'dirty') return { ok: false, code: 'conflict', reason: 'could not update PR branch from its base: merge conflicts' };
      if (state === 'unknown' || state == null) return { ok: true, updated: true };
      if (typeof state === 'string' && state !== 'behind') return { ok: true, updated: false };
    }
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: '{}',
  }).catch(() => null);
  if (!res) return { ok: false, code: 'provider_error', reason: 'update branch request failed (network)' };

  if (res.ok) return { ok: true, updated: true };

  const text = await res.text().catch(() => '');
  // GitHub reports an already-current head as a validation response. It is safe to
  // continue to merge; all other 409/422 responses mean the provider could not
  // integrate the base automatically (normally a real content conflict).
  if (res.status === 422 && /not behind|up[ -]?to[ -]?date|already current/i.test(text)) {
    return { ok: true, updated: false };
  }
  if (res.status === 409 || res.status === 422) {
    return { ok: false, code: 'conflict', reason: `could not update PR branch from its base: ${text.slice(0, 200)}` };
  }
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
}
