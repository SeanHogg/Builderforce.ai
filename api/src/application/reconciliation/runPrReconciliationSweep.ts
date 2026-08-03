/** Incremental producer for the dedicated PR/Ticket Reconciler agent. */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ideAgents, prReconciliationRuns, projectRepositories } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PR_RECONCILIATION_POLICY_VERSION, runPrTicketReconciliation } from './prReconciliationService';

export interface PrReconciliationSweepResult {
  due: number;
  completed: number;
  failed: number;
  prs: number;
  findings: number;
}

const MAX_REPOS_PER_DAILY_SWEEP = 10;

export async function runPrReconciliationSweep(env: Env): Promise<PrReconciliationSweepResult> {
  const db = buildDatabase(env);
  // The frequent cron is every five minutes. A four-minute lease prevents
  // overlap while ensuring PRs opened just after a run wait at most one tick.
  const cutoff = new Date(Date.now() - 4 * 60 * 1_000);
  const repos = await db.select({ id: projectRepositories.id, tenantId: projectRepositories.tenantId })
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
          AND recent.summary ->> 'policyVersion' = ${String(PR_RECONCILIATION_POLICY_VERSION)}
          AND recent.started_at >= ${cutoff}
      )`,
    ))
    .orderBy(sql`(
      SELECT MAX(previous.started_at) FROM ${prReconciliationRuns} previous
      WHERE previous.repo_id = ${projectRepositories.id}
    ) ASC NULLS FIRST`, projectRepositories.createdAt)
    .limit(MAX_REPOS_PER_DAILY_SWEEP);

  let completed = 0;
  let failed = 0;
  let prs = 0;
  let findings = 0;
  for (const repo of repos) {
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
      reportCaughtError(error, {
        source: 'application/reconciliation/runPrReconciliationSweep.ts',
        operation: 'runPrReconciliationSweep',
        context: { repoId: repo.id, tenantId: repo.tenantId },
      });
    }
  }
  return { due: repos.length, completed, failed, prs, findings };
}
