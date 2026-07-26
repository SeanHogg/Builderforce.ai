/**
 * reconcilePullRequestState — make our `pull_requests` row agree with the provider.
 *
 * WHY THIS EXISTS
 * Every write path that closes a PR row is one WE drive: our merge helper, our
 * revert, our inbound webhook. Nothing reconciled a PR that changed on the PROVIDER
 * — someone merging or closing it in the GitHub UI, a branch deleted, a repo
 * archived. So the row stayed `status = 'open'` forever.
 *
 * Measured against live GitHub on `seanhogg/builderforce.ai`: PRs #21, #22 and #23
 * are `closed` on GitHub and `open` in our table. Every "stuck open PR" count, the
 * manager's merge loop and the autonomy wiring audit's `prs_not_stranded` check all
 * read that column, so each of them over-reports — and the manager kept re-preparing
 * a branch for a PR that no longer exists to merge.
 *
 * This is a READ against the provider plus, at most, one corrective write. It is
 * best-effort by contract: a credential miss or provider error leaves the row exactly
 * as it was and reports `checked: false`, because guessing at PR state from a failed
 * fetch is how the drift would get worse rather than better.
 *
 * It also returns the provider's mergeability, since the caller has already paid for
 * the round-trip — that is what lets the manager tell a genuine conflict (`dirty`)
 * apart from GitHub simply not having computed mergeability yet (`unknown`), the
 * distinction behind the merge livelock this module's callers were built to break.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getPullRequestDetail, invalidatePullRequestDetail } from './getPullRequestDetail';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { markPullRequestMergedById, markPullRequestClosedById } from './recordPullRequestRow';

/** The minimal PR row shape the reconcile needs (same shape `pollPrCiStatus` takes). */
export interface ReconcilablePr {
  id: string;
  number: number | null;
  repoId: string | null;
  status: string | null;
  updatedAt: Date | string;
}

export interface ReconcileResult {
  /** False when the provider could not be reached — the row was NOT touched. */
  checked: boolean;
  /** True when our row disagreed with the provider and was corrected. */
  corrected: boolean;
  /** The provider's view: 'open' | 'closed' | 'merged' | null when unknown. */
  providerState: 'open' | 'closed' | 'merged' | null;
  /** GitHub's mergeability, once it has computed it. Null means "still computing". */
  mergeable: boolean | null;
  /** e.g. 'clean' | 'dirty' | 'behind' | 'unstable' | 'unknown'. */
  mergeableState: string | null;
  /** True for a real conflict — the branch cannot merge until someone resolves it. */
  conflicted: boolean;
}

const UNCHECKED: ReconcileResult = {
  checked: false, corrected: false, providerState: null,
  mergeable: null, mergeableState: null, conflicted: false,
};

/**
 * Read the PR from its provider and correct our row when they disagree.
 *
 * `forceFresh` busts the 30s detail cache first. The manager's steady-state pass does
 * NOT need that (a half-minute-stale view of a PR that has been open for days changes
 * nothing), but a caller about to act on mergeability should ask for the live value.
 */
export async function reconcilePullRequestState(
  env: Env,
  db: Db,
  tenantId: number,
  pr: ReconcilablePr,
  opts: { forceFresh?: boolean } = {},
): Promise<ReconcileResult> {
  if (!pr.repoId || pr.number == null) return UNCHECKED;

  try {
    const secret =
      (env as { INTEGRATION_ENCRYPTION_SECRET?: string }).INTEGRATION_ENCRYPTION_SECRET ??
      (env as { JWT_SECRET?: string }).JWT_SECRET ?? '';
    const resolved = await resolveRepoCredential(db, secret, tenantId, pr.repoId);
    if (isResolveError(resolved)) return UNCHECKED;

    const versionToken = pr.updatedAt instanceof Date ? pr.updatedAt.toISOString() : String(pr.updatedAt);
    if (opts.forceFresh) await invalidatePullRequestDetail(env, pr.id, versionToken).catch((error) => {
      console.error('[suppressed-error] application/repos/reconcilePullRequestState.ts:85 reconcilePullRequestState', { error });
    });

    const detail = await getPullRequestDetail(env, pr.id, versionToken, {
      provider: resolved.repo.provider, host: resolved.repo.host,
      owner: resolved.repo.owner, repo: resolved.repo.repo,
      token: resolved.token, number: pr.number,
    });
    if (!detail.supported || detail.error) return UNCHECKED;

    const providerState: 'open' | 'closed' | 'merged' | null =
      detail.merged ? 'merged'
        : detail.state === 'open' ? 'open'
          : detail.state === 'closed' ? 'closed'
            : null;

    // GitHub reports `mergeable: false` with `mergeable_state: 'dirty'` for a genuine
    // conflict. `unknown` means it has not computed one yet — emphatically NOT a
    // conflict, and treating it as one (or as success) is precisely the livelock.
    const conflicted = detail.mergeableState === 'dirty' || (detail.mergeable === false && detail.mergeableState !== 'unknown');

    const base: ReconcileResult = {
      checked: true, corrected: false, providerState,
      mergeable: detail.mergeable, mergeableState: detail.mergeableState, conflicted,
    };

    // Only correct a row we believe is OPEN. A row already closed/merged locally is
    // either correct or was closed deliberately; re-opening it from a provider read is
    // not this function's job.
    if (pr.status !== 'open' || providerState === 'open' || providerState == null) return base;

    if (providerState === 'merged') {
      await markPullRequestMergedById(db, pr.id, tenantId, { mergedBy: 'provider:reconcile' });
    } else {
      await markPullRequestClosedById(db, pr.id, tenantId);
    }
    return { ...base, corrected: true };
  } catch {
    return UNCHECKED;
  }
}
