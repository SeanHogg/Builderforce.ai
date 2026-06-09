/**
 * mergeBranchToBase — merge a ticket branch into its base (e.g. `main`) via the
 * provider REST API, server-side with the tenant's decrypted token.
 *
 * This is the "auto-merge + deploy" step: pushing to the base branch is what
 * triggers the downstream CI/deploy (Cloudflare Pages, GitHub Actions, …), so a
 * successful merge here is what actually ships the agent's changes. GitHub-only;
 * other providers return a typed `unsupported` result so callers degrade
 * gracefully. Never throws.
 */
import { buildGitApiBaseUrl } from './gitProxy';

/**
 * Auto-merge policy. Default (flag off): the cloud run merges to the deploy
 * branch immediately on finish. When `CLOUD_AUTOMERGE_REQUIRE_GREEN` is set, the
 * run does NOT merge on finish — a successful CI/deploy webhook merges instead
 * ("merge only on green"). Single source of truth for both the immediate-merge
 * sites and the webhook's merge-on-green path.
 */
export function cloudAutoMergeRequiresGreen(env: unknown): boolean {
  const v = String((env as Record<string, unknown> | null)?.CLOUD_AUTOMERGE_REQUIRE_GREEN ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Master switch for "should a finished agent run auto-merge its branch at all?".
 * DEFAULT OFF — agent runs open a PR and STOP, leaving the merge to a human who
 * approves it in-product (or, when `CLOUD_AUTOMERGE_REQUIRE_GREEN`, to the green-CI
 * webhook). Set `CLOUD_AUTOMERGE_ENABLED=1` to opt back into hands-off
 * auto-merge + deploy. Single source of truth for both finalize sites (the cloud
 * runner and openTaskPullRequest), so the gate never drifts between them.
 */
export function cloudAutoMergeEnabled(env: unknown): boolean {
  const v = String((env as Record<string, unknown> | null)?.CLOUD_AUTOMERGE_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * After a PR is merged, validate the deploy-branch build and auto-dispatch a fix
 * run on failure. DEFAULT ON — set `CLOUD_AUTOFIX_ON_BUILD_FAILURE=0` (or 'false')
 * to disable the auto-dispatch (the build outcome is still recorded). Single source
 * of truth for the post-merge auto-fix gate.
 */
export function cloudAutofixOnBuildFailure(env: unknown): boolean {
  const v = String((env as Record<string, unknown> | null)?.CLOUD_AUTOFIX_ON_BUILD_FAILURE ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** Max automatic build-fix runs per task before flagging a human. */
export const MAX_AUTOFIX_ATTEMPTS = 2;

export interface MergeBranchInput {
  provider: string;
  host: string | null;
  owner: string;
  repo: string;
  token: string;
  /** The branch to merge INTO (the deploy branch, e.g. repo default `main`). */
  base: string;
  /** The branch to merge FROM (the ticket branch). */
  head: string;
  message?: string;
}

export type MergeBranchResult =
  | { ok: true; merged: boolean; sha: string | null; reason?: string }
  | { ok: false; code: 'unsupported' | 'conflict' | 'provider_error'; reason: string };

export async function mergeBranchToBase(input: MergeBranchInput): Promise<MergeBranchResult> {
  if (input.provider !== 'github') {
    return { ok: false, code: 'unsupported', reason: `merge not implemented for provider '${input.provider}'` };
  }
  const apiBase = buildGitApiBaseUrl(input.provider, input.host);
  const repoBase = `${apiBase}/repos/${input.owner}/${input.repo}`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-Merge/1.0',
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${repoBase}/merges`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base: input.base,
      head: input.head,
      commit_message: input.message ?? `Merge ${input.head} into ${input.base} (BuilderForce auto-merge)`,
    }),
  }).catch(() => null);

  if (!res) return { ok: false, code: 'provider_error', reason: 'merge request failed (network)' };

  // 201 = merged; 204 = base already contains head (nothing to merge — still a success).
  if (res.status === 204) return { ok: true, merged: false, sha: null, reason: 'base already up to date' };
  if (res.ok) {
    const sha = ((await res.json().catch(() => null)) as { sha?: string } | null)?.sha ?? null;
    return { ok: true, merged: true, sha };
  }
  if (res.status === 409) {
    const t = await res.text().catch(() => '');
    return { ok: false, code: 'conflict', reason: `merge conflict: ${t.slice(0, 200)}` };
  }
  const t = await res.text().catch(() => '');
  return { ok: false, code: 'provider_error', reason: `GitHub ${res.status}: ${t.slice(0, 200)}` };
}
