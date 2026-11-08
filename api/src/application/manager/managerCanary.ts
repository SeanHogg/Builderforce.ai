/**
 * managerCanary — PRD 23 §5.6/§7: the mode an operator enables to prove one lifecycle
 * (dispatch -> signoff -> acceptance) WITHOUT merging or closing anything.
 *
 * While `project_manager_configs.canary` is true for a project, the two unattended
 * destructive PR acts are disabled for it:
 *
 *   • automatic MERGE   (`repos/prMergeSweep.ts`), and
 *   • automatic CLOSE   (`reconciliation/prReconciliationService.ts`, the high-confidence
 *     close-candidate policy).
 *
 * Everything upstream of those acts (reconciliation, reviewer dispatch, sign-off, acceptance)
 * keeps running, which is the point: the canary shows the loop converging up to the moment it
 * would have acted, and the journal records what it WOULD have done (`canary_would_merge` /
 * `canary_would_close`, once per PR/state) so the operator can compare it with the disposition
 * report before turning merge and close on. A human explicitly approving a close or a merge is
 * not unattended and is not blocked.
 *
 * Default OFF. The flag lives in the manager policy (`EffectiveManagerPolicy.canary`,
 * project-only); {@link isManagerCanary} reads it directly for callers that hold no policy.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectManagerConfigs } from '../../infrastructure/database/schema';
import { recordManagerActionOnChange, stateFingerprint } from './managerActionJournal';

/** `manager_actions.action_type` values (must fit varchar(24)). */
export const CANARY_WOULD_MERGE_ACTION = 'canary_would_merge';
export const CANARY_WOULD_CLOSE_ACTION = 'canary_would_close';

/** Is this project in canary mode? One indexed read of the project's manager config row. */
export async function isManagerCanary(db: Db, scope: { tenantId: number; projectId: number }): Promise<boolean> {
  const [row] = await db.select({ canary: projectManagerConfigs.canary }).from(projectManagerConfigs)
    .where(and(eq(projectManagerConfigs.tenantId, scope.tenantId), eq(projectManagerConfigs.projectId, scope.projectId)))
    .limit(1);
  return row?.canary === true;
}

export interface CanaryPrSubject {
  tenantId: number;
  projectId: number;
  prId: string;
  prNumber: number | null;
  taskId: number | null;
  runTaskId?: number | null;
}

/**
 * Journal that the canary withheld an act. Logged ONCE per PR and act (the fingerprint is
 * the act plus the PR identity), so the five-minute sweep does not re-file the same line.
 */
export async function logCanaryWouldAct(
  db: Db, act: 'merge' | 'close', subject: CanaryPrSubject, detail: Record<string, unknown> = {},
): Promise<void> {
  await recordManagerActionOnChange(db, {
    tenantId: subject.tenantId, projectId: subject.projectId, taskId: subject.taskId,
    prId: subject.prId, runTaskId: subject.runTaskId ?? null,
    actionType: act === 'merge' ? CANARY_WOULD_MERGE_ACTION : CANARY_WOULD_CLOSE_ACTION,
    stateKey: `canary:${act}:${subject.prId}`,
    fingerprint: stateFingerprint([act, subject.prId]),
    summary: `Canary: would have ${act === 'merge' ? 'merged' : 'closed'} PR #${subject.prNumber ?? '?'}${subject.taskId != null ? ` (ticket #${subject.taskId})` : ''}; held because this project is in canary mode.`,
    detail: { canary: true, act, ...detail },
  });
}

/**
 * The merge-step guard. True when the merge must NOT happen (canary on); the would-have-merged
 * line is journalled. `canary` comes from the already-resolved policy, so the merge loop pays
 * no extra read per PR.
 */
export async function holdMergeForCanary(
  db: Db, canary: boolean, subject: CanaryPrSubject,
): Promise<boolean> {
  if (!canary) return false;
  await logCanaryWouldAct(db, 'merge', subject);
  return true;
}
