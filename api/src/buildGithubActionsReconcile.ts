/**
 * Composition-root binding of the GitHub Actions reconcile sweep: the sweep (application code) takes its `IExecutionRepository` port
 * injected; the cron wiring takes it from `buildExecutionRepository`, the ONE place the repository is constructed.
 */
import type { Db } from './infrastructure/database/connection';
import type { Env } from './env';
import { reconcileGithubActionsRuns, type ActionsReconcileResult } from './application/runtime/githubActionsReconcile';
import { buildExecutionRepository } from './buildExecutionRepository';

/** Fail the GitHub Actions dispatches GitHub never scheduled, landing each through the wired execution repository. */
export function runGithubActionsReconcile(env: Env, nowMs: number, db: Db): Promise<ActionsReconcileResult> {
  return reconcileGithubActionsRuns(env, nowMs, db, buildExecutionRepository(db));
}
