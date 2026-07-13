/**
 * pollPrCiStatus — actively fetch a recorded PR's live CI verdict from the provider
 * and persist it to `pull_requests.build_status`.
 *
 * The `on_green` PR merge policy waits for CI to pass. Historically the only thing
 * that flipped `build_status` to 'success' was the inbound CI webhook — so a repo
 * without the BuilderForce webhook installed (or one whose delivery was dropped) left
 * every `on_green` PR stuck open forever. This helper makes the AI Manager
 * self-sufficient: on each pass it POLLS the provider's combined commit status for any
 * `on_green` PR that isn't already green, writes the result back through the shared
 * {@link setPullRequestBuildStatus} (so DORA/deployment bookkeeping stays consistent),
 * and returns the fresh verdict so the caller can merge without waiting for a webhook.
 *
 * Best-effort by contract: any failure (no repo binding, credential miss, provider
 * error) returns the previously-recorded status unchanged and never throws.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getPullRequestDetail } from './getPullRequestDetail';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { setPullRequestBuildStatus } from './recordPullRequestRow';

/** The minimal PR row shape the poll needs. */
export interface PollablePr {
  id: string;
  number: number | null;
  repoId: string | null;
  buildStatus: string | null;
  updatedAt: Date | string;
}

/**
 * Resolve the live CI verdict for a PR, persisting it when it changed. Returns the
 * effective build status: 'success' | 'failure' | 'pending' | the prior value | null.
 * Skips the provider round-trip entirely when the row is already 'success' (terminal
 * for on_green) or has no repo/number to query.
 */
export async function pollPrCiStatus(env: Env, db: Db, tenantId: number, pr: PollablePr): Promise<string | null> {
  // Already green — nothing to poll; the caller can merge.
  if (pr.buildStatus === 'success') return 'success';
  if (!pr.repoId || pr.number == null) return pr.buildStatus;

  try {
    const secret =
      (env as { INTEGRATION_ENCRYPTION_SECRET?: string }).INTEGRATION_ENCRYPTION_SECRET ??
      (env as { JWT_SECRET?: string }).JWT_SECRET ?? '';
    const resolved = await resolveRepoCredential(db, secret, tenantId, pr.repoId);
    if (isResolveError(resolved)) return pr.buildStatus;

    const versionToken = pr.updatedAt instanceof Date ? pr.updatedAt.toISOString() : String(pr.updatedAt);
    const detail = await getPullRequestDetail(env, pr.id, versionToken, {
      provider: resolved.repo.provider, host: resolved.repo.host,
      owner: resolved.repo.owner, repo: resolved.repo.repo,
      token: resolved.token, number: pr.number,
    });

    // `checks` is the combined head-commit status ('success' | 'failure' | 'pending'),
    // or null when the provider reports no checks configured. Treat "no checks" as
    // green — an on_green policy on a repo with no CI must not deadlock.
    const live = detail.checks ?? (detail.checksTotal === 0 ? 'success' : null);
    if (live && live !== pr.buildStatus) {
      await setPullRequestBuildStatus(db, pr.id, live).catch(() => {});
    }
    return live ?? pr.buildStatus;
  } catch {
    return pr.buildStatus;
  }
}
