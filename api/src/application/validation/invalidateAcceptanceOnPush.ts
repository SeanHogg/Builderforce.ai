/**
 * invalidateAcceptanceOnPush — the webhook entry point for PRD 23 §5.2's "a newer PR head
 * invalidates acceptance evidence recorded against an older head".
 *
 * A GitHub `pull_request` `synchronize` event names the repo, the PR number and the new head
 * commit. This resolves the ticket(s) that PR belongs to (a repo may be linked by more than
 * one tenant) and hands the new head to `invalidateStaleAcceptance`, which reopens the
 * Validator slot through the sign-off ledger. The reconciliation sweep makes the same call
 * with the heads it reads from GitHub, so a missed webhook heals on the next tick.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests } from '../../infrastructure/database/schema';
import { resolveRepoLinks } from '../contributors/activityIngest';
import { invalidateStaleAcceptance } from '../kanban/validatorSlotBridge';

export async function invalidateAcceptanceOnPush(
  env: Env, db: Db, args: { repoFullName: string; prNumber: number; headSha: string },
): Promise<number[]> {
  if (!args.headSha || !Number.isInteger(args.prNumber)) return [];
  const reopened: number[] = [];
  for (const link of await resolveRepoLinks(db, args.repoFullName)) {
    if (!link.projectId) continue;
    const rows = await db.select({ taskId: pullRequests.taskId }).from(pullRequests).where(and(
      eq(pullRequests.tenantId, link.tenantId), eq(pullRequests.projectId, link.projectId),
      eq(pullRequests.number, args.prNumber), isNotNull(pullRequests.taskId),
    ));
    const heads = rows.map((r) => ({ taskId: r.taskId!, headSha: args.headSha }));
    reopened.push(...await invalidateStaleAcceptance(env, db, link.tenantId, heads));
  }
  return reopened;
}
