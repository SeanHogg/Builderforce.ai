/**
 * mergePullRequest — merge an OPEN pull request via the provider's PR-merge API,
 * server-side with the tenant's decrypted token. This is the "Approve & Merge"
 * action a human triggers in-product (the in-product replacement for clicking
 * "Merge" on GitHub).
 *
 * Distinct from {@link mergeBranchToBase}: that does a raw branch merge (POST
 * /merges) used by the legacy auto-merge path; this closes the actual PR with a
 * chosen merge method (squash | merge | rebase), so the PR shows as merged and the
 * branch history reflects the operator's choice.
 *
 * GitHub is implemented; other providers return a typed `unsupported` result so
 * callers degrade to "open the PR on the provider". Never throws.
 */
import { buildGitApiBaseUrl } from './gitProxy';

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export interface MergePrInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  number: number;
  /** Merge strategy. Defaults to 'squash' (cleanest history for agent branches). */
  method?: MergeMethod;
  /** Optional commit title/message for the squash/merge commit. */
  commitTitle?: string;
  commitMessage?: string;
}

export type MergePrResult =
  | { ok: true; merged: boolean; sha: string | null }
  | { ok: false; code: 'unsupported' | 'not_mergeable' | 'conflict' | 'provider_error'; reason: string };

const VALID_METHODS: ReadonlySet<MergeMethod> = new Set(['squash', 'merge', 'rebase']);

/** Normalize an arbitrary string to a valid merge method, defaulting to squash. */
export function normalizeMergeMethod(v: unknown): MergeMethod {
  return typeof v === 'string' && VALID_METHODS.has(v as MergeMethod) ? (v as MergeMethod) : 'squash';
}

export async function mergePullRequest(input: MergePrInput): Promise<MergePrResult> {
  if (input.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `merge not implemented for provider '${input.provider}'` };
  }

  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  const url = `${apiBase}/repos/${input.owner}/${input.repo}/pulls/${input.number}/merge`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-PR-Merge/1.0',
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      merge_method: normalizeMergeMethod(input.method),
      ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
      ...(input.commitMessage ? { commit_message: input.commitMessage } : {}),
    }),
  }).catch(() => null);

  if (!res) return { ok: false, code: 'provider_error', reason: 'merge request failed (network)' };

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { merged?: boolean; sha?: string } | null;
    return { ok: true, merged: body?.merged ?? true, sha: body?.sha ?? null };
  }

  // 405 = PR is not mergeable (e.g. checks/branch protection); 409 = head moved /
  // conflict. Map both to actionable codes so the route surfaces a 409 the UI can
  // explain rather than a generic failure.
  const text = await res.text().catch(() => '');
  if (res.status === 405) return { ok: false, code: 'not_mergeable', reason: `not mergeable: ${text.slice(0, 200)}` };
  if (res.status === 409) return { ok: false, code: 'conflict', reason: `merge conflict: ${text.slice(0, 200)}` };
  return { ok: false, code: 'provider_error', reason: `GitHub ${res.status}: ${text.slice(0, 200)}` };
}
