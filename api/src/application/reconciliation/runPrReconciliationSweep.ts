/** Incremental producer for the dedicated PR/Ticket Reconciler agent. */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { ideAgents, prReconciliationErrors, prReconciliationRuns, projectRepositories } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { loadSweepStamps, type StampFallback } from '../../infrastructure/cache/sweepStampLedger';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PR_RECONCILIATION_POLICY_VERSION, runPrTicketReconciliation } from './prReconciliationService';
import { activeGithubCooldown, githubCooldownFor, recordGithubCooldown } from './githubCredentialCooldown';

export interface PrReconciliationSweepResult {
  due: number;
  completed: number;
  failed: number;
  prs: number;
  findings: number;
  /** Repos skipped because GitHub is refusing/throttling their credential (see githubCredentialCooldown). */
  cooledDown: number;
}

const MAX_REPOS_PER_DAILY_SWEEP = 10;

/**
 * Minimum gap between two scheduled apply runs on one repository.
 *
 * It was a 4-minute "overlap lease" under a 5-minute tick, which is not a lease but
 * "every eligible repo, every active tick": each run inserted a `pr_reconciliation_runs`
 * row plus one `pr_reconciliation_items` row per open PR, which is how the tables
 * reached millions of writes. Nothing time-critical waits on this sweep — the merge
 * sweep polls a PR's live CI before an on-green merge, and PRs our agents open are
 * recorded when they are opened — so a 30-minute cadence costs only how quickly an
 * externally opened PR is inventoried.
 */
export const PR_RECONCILIATION_INTERVAL_MS = 30 * 60 * 1_000;

/**
 * KV key of the sweep's "last checked" ledger, per policy version — a policy bump makes
 * every repo due at once, which is what an old run row used to NOT postpone.
 *
 * THE CADENCE IS NOT THE RUN ROW ANY MORE. The run row used to be the schedule, so every
 * check had to write one — plus an item row per open PR — even when nothing had moved.
 * Checks are now stamped here, and a scheduled run records itself only when it changed
 * something or hit an error (`persist: 'on_change'`, see prReconciliationRunLedger). The
 * last recorded current-policy run is still read as a fallback, so a cold KV degrades
 * to the old cadence rather than to every tick.
 */
export const prReconciliationStampsKey = (policyVersion: number = PR_RECONCILIATION_POLICY_VERSION): string =>
  `sweep:pr-reconciler:checked:v${policyVersion}`;

/** When the scheduled reconciler last checked `repoId` (epoch ms) — the newer of its KV
 *  stamp and `fallback` (e.g. the latest recorded run) — or null when never. */
export async function prReconciliationLastCheckedAt(
  env: CacheEnv,
  db: Db,
  tenantId: number,
  repoId: string,
  fallback?: StampFallback,
): Promise<number | null> {
  // The KV ledger is platform-wide; answer only for a repo this tenant owns.
  const [owned] = await db.select({ id: projectRepositories.id }).from(projectRepositories)
    .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, tenantId))).limit(1);
  if (!owned) return null;
  const stamps = await loadSweepStamps(env, prReconciliationStampsKey());
  return stamps.lastChecked(repoId, fallback);
}

export async function runPrReconciliationSweep(env: Env, db: Db = buildDatabase(env)): Promise<PrReconciliationSweepResult> {
  // Authentication/authorization failures do not heal five minutes later. Back
  // off long enough for credentials to be repaired instead of flooding both the
  // system error table and GitHub (project 11 produced 2,000+ identical 403s).
  // A failed run is always recorded, so this read still sees it.
  const forbiddenCutoff = new Date(Date.now() - 6 * 60 * 60 * 1_000);
  // Every eligible repo, read uncapped: which are due is the stamp ledger's call. The
  // last recorded current-policy apply run rides along as the ledger's DB fallback.
  const candidates = await db.select({
    id: projectRepositories.id,
    tenantId: projectRepositories.tenantId,
    credentialId: projectRepositories.credentialId,
    lastRunAt: sql<Date | null>`(
      SELECT MAX(previous.started_at) FROM ${prReconciliationRuns} previous
      WHERE previous.repo_id = ${projectRepositories.id}
        AND previous.mode = 'apply'
        AND previous.summary ->> 'policyVersion' = ${String(PR_RECONCILIATION_POLICY_VERSION)}
    )`.mapWith(prReconciliationRuns.startedAt),
  })
    .from(projectRepositories)
    .innerJoin(ideAgents, and(
      eq(ideAgents.tenantId, projectRepositories.tenantId),
      eq(ideAgents.builtinKind, 'pr_reconciler'),
      eq(ideAgents.status, 'active'),
    ))
    .where(acrossTenants(projectRepositories, 'scheduled_sweep', and(
      eq(projectRepositories.provider, 'github'),
      isNotNull(projectRepositories.credentialId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${prReconciliationRuns} recent
        WHERE recent.repo_id = ${projectRepositories.id}
          AND recent.mode = 'apply'
          AND recent.status = 'failed' AND recent.started_at >= ${forbiddenCutoff}
          AND EXISTS (
            SELECT 1 FROM ${prReconciliationErrors} failure
            WHERE failure.run_id = recent.id
              AND failure.details ->> 'status' = '403'
          )
      )`,
    )));

  const stamps = await loadSweepStamps(env, prReconciliationStampsKey());
  // Never-checked first, then oldest-checked first: the per-tick cap rotates fairly.
  const repos = stamps.due(candidates, {
    id: (r) => r.id,
    fallback: (r) => r.lastRunAt,
    intervalMs: PR_RECONCILIATION_INTERVAL_MS,
    limit: candidates.length,
  });

  let completed = 0;
  let failed = 0;
  let prs = 0;
  let findings = 0;
  let cooledDown = 0;
  let attempted = 0;
  try {
    for (const repo of repos) {
      if (attempted >= MAX_REPOS_PER_DAILY_SWEEP) break;
      // A credential GitHub refused or throttled is skipped until its cooldown
      // lapses — silently: the refusal was reported once, when the cooldown began.
      // Not stamped, so it is first in line once the cooldown lapses.
      const credentialKey = repo.credentialId ?? `tenant-${repo.tenantId}`;
      if (await activeGithubCooldown(env, credentialKey)) {
        cooledDown++;
        continue;
      }
      attempted++;
      // Stamped on attempt, success or failure: a failing repo retries on the interval,
      // not every tick (each failure records a run with its error).
      stamps.stamp(repo.id);
      try {
        const result = await runPrTicketReconciliation(env, db, {
          tenantId: repo.tenantId,
          repoId: repo.id,
          mode: 'apply',
          autoApplyCloseCandidates: true,
          persist: 'on_change',
        });
        completed++;
        prs += result.summary.total ?? 0;
        findings += (result.summary.repair ?? 0)
          + (result.summary.infrastructure_failure ?? 0)
          + (result.summary.close_candidate ?? 0)
          + (result.summary.human_review ?? 0);
      } catch (error) {
        failed++;
        const cooldownSeconds = githubCooldownFor(error);
        if (cooldownSeconds != null) {
          // Refused/throttled: the failure is already on the run's diagnostics
          // (pr_reconciliation_errors). Start the cooldown and report it ONCE, as a
          // warning — cooled ticks skip this credential, so this is not the old
          // error report every 5 minutes until the PAT is fixed.
          const status = (error as { details?: { status?: unknown } }).details?.status;
          const record = await recordGithubCooldown(env, credentialKey, cooldownSeconds, {
            status: typeof status === 'number' ? status : null,
            reason: error instanceof Error ? error.message : String(error),
          });
          reportCaughtError(error, {
            source: 'application/reconciliation/runPrReconciliationSweep.ts',
            operation: 'runPrReconciliationSweep.cooldown',
            level: 'warning',
            context: {
              logMessage: '[pr-reconciliation] GitHub refused the credential; pausing its collection',
              details: { repoId: repo.id, tenantId: repo.tenantId, credentialId: repo.credentialId, status: record.status, until: record.until },
            },
          });
          continue;
        }
        reportCaughtError(error, {
          source: 'application/reconciliation/runPrReconciliationSweep.ts',
          operation: 'runPrReconciliationSweep',
          context: { repoId: repo.id, tenantId: repo.tenantId },
        });
      }
    }
  } finally {
    await stamps.save();
  }
  return { due: attempted + cooledDown, completed, failed, prs, findings, cooledDown };
}
