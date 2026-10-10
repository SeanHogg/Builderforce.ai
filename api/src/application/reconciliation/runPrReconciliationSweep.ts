/** Incremental producer for the dedicated PR/Ticket Reconciler agent. */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { ideAgents, prReconciliationErrors, prReconciliationRuns, projectRepositories } from '../../infrastructure/database/schema';
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
 * Candidates read per tick. A cooled-down repo records no run, so it stays at
 * the head of the oldest-first order; reading a margin past the run budget keeps
 * a handful of throttled credentials from starving every other repository.
 */
const CANDIDATE_REPOS_PER_SWEEP = MAX_REPOS_PER_DAILY_SWEEP * 3;

export async function runPrReconciliationSweep(env: Env, db: Db = buildDatabase(env)): Promise<PrReconciliationSweepResult> {
  // The frequent cron is every five minutes. A four-minute lease prevents
  // overlap while ensuring PRs opened just after a run wait at most one tick.
  const cutoff = new Date(Date.now() - 4 * 60 * 1_000);
  // Authentication/authorization failures do not heal five minutes later. Back
  // off long enough for credentials to be repaired instead of flooding both the
  // system error table and GitHub (project 11 produced 2,000+ identical 403s).
  const forbiddenCutoff = new Date(Date.now() - 6 * 60 * 60 * 1_000);
  const repos = await db.select({
    id: projectRepositories.id,
    tenantId: projectRepositories.tenantId,
    credentialId: projectRepositories.credentialId,
  })
    .from(projectRepositories)
    .innerJoin(ideAgents, and(
      eq(ideAgents.tenantId, projectRepositories.tenantId),
      eq(ideAgents.builtinKind, 'pr_reconciler'),
      eq(ideAgents.status, 'active'),
    ))
    .where(and(
      eq(projectRepositories.provider, 'github'),
      isNotNull(projectRepositories.credentialId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${prReconciliationRuns} recent
        WHERE recent.repo_id = ${projectRepositories.id}
          AND recent.mode = 'apply'
          AND (
            (recent.summary ->> 'policyVersion' = ${String(PR_RECONCILIATION_POLICY_VERSION)}
              AND recent.started_at >= ${cutoff})
            OR (recent.status = 'failed' AND recent.started_at >= ${forbiddenCutoff}
              AND EXISTS (
                SELECT 1 FROM ${prReconciliationErrors} failure
                WHERE failure.run_id = recent.id
                  AND failure.details ->> 'status' = '403'
              ))
          )
      )`,
    ))
    .orderBy(sql`(
      SELECT MAX(previous.started_at) FROM ${prReconciliationRuns} previous
      WHERE previous.repo_id = ${projectRepositories.id}
    ) ASC NULLS FIRST`, projectRepositories.createdAt)
    .limit(CANDIDATE_REPOS_PER_SWEEP);

  let completed = 0;
  let failed = 0;
  let prs = 0;
  let findings = 0;
  let cooledDown = 0;
  let attempted = 0;
  for (const repo of repos) {
    if (attempted >= MAX_REPOS_PER_DAILY_SWEEP) break;
    // A credential GitHub refused or throttled is skipped until its cooldown
    // lapses — silently: the refusal was reported once, when the cooldown began.
    const credentialKey = repo.credentialId ?? `tenant-${repo.tenantId}`;
    if (await activeGithubCooldown(env, credentialKey)) {
      cooledDown++;
      continue;
    }
    attempted++;
    try {
      const result = await runPrTicketReconciliation(env, db, {
        tenantId: repo.tenantId,
        repoId: repo.id,
        mode: 'apply',
        autoApplyCloseCandidates: true,
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
  return { due: attempted + cooledDown, completed, failed, prs, findings, cooledDown };
}
