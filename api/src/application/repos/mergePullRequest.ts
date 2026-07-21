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
 * GitHub, GitLab, Bitbucket Cloud and Bitbucket Server (self-hosted) are
 * implemented; other providers return a typed `unsupported` result so callers
 * degrade to "open the PR on the provider". Never throws.
 */
import { bitbucketServerRepoPath, buildGitApiBaseUrl, resolveGitApiFlavor } from './gitProxy';

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

/** Build the provider-specific merge request (URL + method + body). Pure +
 *  exported so the per-provider request construction is unit-testable without a
 *  live API. Endpoints per each provider's documented PR-merge API. */
export function buildMergeRequest(input: MergePrInput): { url: string; method: 'PUT' | 'POST'; body: Record<string, unknown> } {
  const flavor = resolveGitApiFlavor(input.provider, input.host);
  const apiBase = buildGitApiBaseUrl(input.provider, input.host, { allowBitbucketServer: true });
  const method = normalizeMergeMethod(input.method);
  if (flavor === 'bitbucket-server') {
    // Server has no per-request strategy — the merge strategy is a repository
    // setting there — so `method` cannot be honoured and is deliberately dropped
    // rather than sent and silently ignored. `version=-1` means "current version".
    return {
      url: `${apiBase}${bitbucketServerRepoPath(input.owner, input.repo)}/pull-requests/${input.number}/merge?version=-1`,
      method: 'POST',
      body: { ...(input.commitMessage ? { message: input.commitMessage } : {}) },
    };
  }
  if (flavor === 'gitlab') {
    // PUT /projects/:id/merge_requests/:iid/merge — `:id` is the URL-encoded
    // `owner/repo` path; GitLab squashes via a boolean (no rebase-on-merge here).
    const projectId = encodeURIComponent(`${input.owner}/${input.repo}`);
    return {
      url: `${apiBase}/projects/${projectId}/merge_requests/${input.number}/merge`,
      method: 'PUT',
      body: {
        squash: method === 'squash',
        ...(input.commitMessage ? { merge_commit_message: input.commitMessage } : {}),
      },
    };
  }
  if (flavor === 'bitbucket-cloud') {
    // POST /repositories/:owner/:repo/pullrequests/:id/merge — strategy names
    // differ: squash→squash, merge→merge_commit, rebase→fast_forward (closest).
    const strategy = method === 'merge' ? 'merge_commit' : method === 'rebase' ? 'fast_forward' : 'squash';
    return {
      url: `${apiBase}/repositories/${input.owner}/${input.repo}/pullrequests/${input.number}/merge`,
      method: 'POST',
      body: {
        merge_strategy: strategy,
        ...(input.commitMessage ? { message: input.commitMessage } : {}),
      },
    };
  }
  // GitHub (default): PUT /repos/:owner/:repo/pulls/:n/merge.
  return {
    url: `${apiBase}/repos/${input.owner}/${input.repo}/pulls/${input.number}/merge`,
    method: 'PUT',
    body: {
      merge_method: method,
      ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
      ...(input.commitMessage ? { commit_message: input.commitMessage } : {}),
    },
  };
}

/** Parse a provider's successful merge response into `{ merged, sha }`. */
function parseMergeSuccess(provider: string, body: unknown): { merged: boolean; sha: string | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (provider === 'gitlab') {
    const sha = (b.merge_commit_sha ?? b.sha) as string | undefined;
    return { merged: b.state === 'merged' || !!sha, sha: sha ?? null };
  }
  if (provider === 'bitbucket') {
    // Cloud → `merge_commit.hash`; Server → `properties.mergeCommit.id`.
    const sha = (b.merge_commit as { hash?: string } | undefined)?.hash
      ?? (b.properties as { mergeCommit?: { id?: string } } | undefined)?.mergeCommit?.id;
    return { merged: b.state === 'MERGED' || !!sha, sha: sha ?? null };
  }
  return { merged: (b.merged as boolean) ?? true, sha: (b.sha as string) ?? null };
}

export async function mergePullRequest(input: MergePrInput): Promise<MergePrResult> {
  const SUPPORTED = new Set(['github', 'gitlab', 'bitbucket']);
  if (!SUPPORTED.has(input.provider)) {
    return { ok: false, code: 'unsupported', reason: `merge not implemented for provider '${input.provider}'` };
  }

  let req: { url: string; method: 'PUT' | 'POST'; body: Record<string, unknown> };
  try {
    req = buildMergeRequest(input);
  } catch (e) {
    // A provider with no mapped REST base at all.
    return { ok: false, code: 'unsupported', reason: e instanceof Error ? e.message : 'unsupported host' };
  }

  const res = await fetch(req.url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: 'application/json',
      'User-Agent': 'BuilderForce-PR-Merge/1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req.body),
  }).catch(() => null);

  if (!res) return { ok: false, code: 'provider_error', reason: 'merge request failed (network)' };

  if (res.ok) {
    const body = await res.json().catch(() => null);
    return { ok: true, ...parseMergeSuccess(input.provider, body) };
  }

  // Map the common "can't merge" statuses to actionable codes so the route
  // surfaces a 409 the UI can explain. GitHub 405 / GitLab 405-406 = not
  // mergeable; 409 (all) = head moved / conflict.
  const text = await res.text().catch(() => '');
  if (res.status === 405 || res.status === 406) {
    const providerMessage = extractProviderMessage(text);
    const reason = input.provider === 'github'
      ? `GitHub could not merge this pull request${providerMessage ? `: ${providerMessage}` : ''}. Check for merge conflicts, draft status, required checks or reviews, branch rules or merge-queue requirements, and whether '${normalizeMergeMethod(input.method)}' merges are enabled. Open the pull request on GitHub for the exact blocker.`
      : `The pull request is not mergeable${providerMessage ? `: ${providerMessage}` : ''}. Check the provider for unresolved merge requirements.`;
    return { ok: false, code: 'not_mergeable', reason };
  }
  if (res.status === 409) return { ok: false, code: 'conflict', reason: `merge conflict: ${text.slice(0, 200)}` };
  return { ok: false, code: 'provider_error', reason: `${input.provider} ${res.status}: ${text.slice(0, 200)}` };
}

/** Extract the useful provider error without leaking a raw JSON envelope to the UI. */
function extractProviderMessage(text: string): string {
  if (!text.trim()) return '';
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === 'string') return body.message.trim().slice(0, 200);
  } catch { /* non-JSON provider response */ }
  return text.trim().slice(0, 200);
}
