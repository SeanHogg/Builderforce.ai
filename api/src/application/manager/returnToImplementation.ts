/**
 * returnToImplementation — THE one way the manager sends a review ticket back to be built.
 *
 * Two callers did this by hand (the conduct pass in `ManagerService` and the stall-triage
 * remedy in `triageStage`), each as a bare `status = in_progress` write followed by a lane
 * trigger. That was enough only while the managed producer pick re-dispatched a finished
 * producer by accident. A completed producer slot now stays closed
 * (`managedLaneRoles.isStageProductionDischarged`), so a return has to do two things the
 * bare write never did:
 *
 *  1. REFUSE AN INFRASTRUCTURE FAILURE INSTEAD OF RE-DISPATCHING INTO IT. A code ticket
 *     with no branch is returned because "it reached review with no implementation" —
 *     but when the ticket has no usable repository (none bound, or its credential does
 *     not resolve), no run CAN produce one. Returning it then is a loop: the producer
 *     re-runs, commits nowhere, reaches review with the same nothing, and is returned
 *     again. (The 2026-09-16 burst on project 11 recorded `ticket.prd.reconcile_needed`
 *     "no repo bound to this task" on 22 of the tickets being re-dispatched — there the
 *     re-dispatch itself came from the producer pick, but the missing repository was
 *     equally something no run could fix.) That condition belongs to a person (bind the
 *     repository / repair the credential), so the ticket is HELD and the reason is
 *     returned for the caller to surface.
 *  2. REOPEN THE PRODUCER EXPLICITLY. The return is recorded as a `changes_requested`
 *     verdict on the implementation stage's completed producer slot(s), with the reason
 *     (`reopenStageProducers`). That is what lets exactly one rework run be dispatched
 *     and credited — see `kanban/reopenProducerSlots.ts`.
 *
 * The restart itself stays with the caller, because each spends it from a different
 * budget (the conduct pass reserves a run; triage only races the executor when allowed).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus } from '../../domain/shared/types';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { resolveTicketRepoContext } from '../repos/commitFileAsPendingChange';
import { reopenStageProducers } from '../kanban/reopenProducerSlots';

export type ReturnToImplementationOutcome =
  /** Moved back to implementation; `reopenedRoles` are the producer slots reopened. */
  | { returned: true; reopenedRoles: string[] }
  /** HELD: an infrastructure condition means no run could produce the deliverable. */
  | { returned: false; blockedReason: string };

/**
 * Should this return be held because the deliverable cannot land? PURE.
 *
 * Only for work that is expected to produce code: a docs/analysis ticket's deliverable is
 * not a branch, so a missing repository is not what is holding it. An UNKNOWN repository
 * state (the lookup itself failed) is not a verdict — it falls through to the return,
 * which is the behaviour before this check existed.
 */
export function decideReturnBlock(input: {
  expectsCode: boolean;
  repo: { ok: true } | { ok: false; reason: string } | null;
}): string | null {
  if (!input.expectsCode || !input.repo || input.repo.ok) return null;
  return input.repo.reason;
}

/** The sentence a held return is journalled / escalated with. */
export function describeReturnBlock(reason: string): string {
  return `Needs attention: this ticket expects code but its repository is unavailable (${reason}), `
    + 'so no implementation run can land a branch. It is held instead of being re-dispatched — '
    + 'bind a repository to the project (or repair its credential) and the next pass returns it to implementation.';
}

export async function returnToImplementation(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    taskId: number;
    /** The lane the ticket is leaving; the move is conditional on it still being there. */
    fromStatus: string;
    expectsCode: boolean;
    /** Why it is being returned — recorded on the producer's reopened slot. */
    reason: string;
    actor: { kind: 'agent' | 'human'; ref: string | null; name: string };
  },
): Promise<ReturnToImplementationOutcome> {
  const repo = args.expectsCode
    ? await resolveTicketRepoContext(db, integrationCredentialSecret(env), args.tenantId, args.taskId)
      .then((r) => (r.ok ? { ok: true as const } : { ok: false as const, reason: r.reason }))
      .catch(() => null)
    : null;
  const blockedReason = decideReturnBlock({ expectsCode: args.expectsCode, repo });
  if (blockedReason) return { returned: false, blockedReason };

  await db.update(tasks)
    .set({ status: TaskStatus.IN_PROGRESS, completedAt: null, updatedAt: new Date() })
    .where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, args.taskId), eq(tasks.status, args.fromStatus)));
  const reopenedRoles = await reopenStageProducers(env, db, {
    tenantId: args.tenantId,
    taskId: args.taskId,
    stageKey: TaskStatus.IN_PROGRESS,
    reason: args.reason,
    actor: args.actor,
  });
  return { returned: true, reopenedRoles };
}
