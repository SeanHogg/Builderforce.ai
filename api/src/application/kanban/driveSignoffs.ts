/**
 * driveSignoffs — ASK the outstanding roles to sign off.
 *
 * This is the step whose absence made the whole accountability model inert. Producer
 * credit is automatic (a terminal run with PR evidence completes the slot via
 * `attributeRunToManifest`), but a REVIEWER slot only clears when an agent records a
 * verdict — and nothing was ever asking one to. Measured consequence: 487 required
 * slots across the tenant, zero ever satisfied.
 *
 * So for each outstanding slot with a resolved agent assignee, dispatch that agent AS
 * the role with an explicit instruction to record its sign-off, using the ONE shared
 * request contract in `signoffRequest.ts` (whose `laneKey` is what makes the verdict
 * land on the lane-scoped manifest slot rather than nowhere).
 *
 * Bounded to ONE dispatch per call: sign-offs are sequential judgements, and a burst
 * would spend N billable runs to answer one question. Slots with no assignee are
 * skipped — that is an `unstaffed` staffing gap the accountability report already
 * raises, and dispatching nobody is not a fix for it.
 *
 * Lives in its own module (rather than inside `ManagerService`) because BOTH the
 * manager's review pass and its stall-triage stage drive sign-offs, and a shared
 * import from either into the other would be circular.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { SignoffGateResult } from './signoffGate';
import { buildSignoffRequestPayload } from './signoffRequest';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';

/** The minimal ticket shape a sign-off request needs. */
export interface SignoffTargetTask {
  id: number;
  title: string;
  status: string;
  githubPrUrl: string | null;
}

/**
 * Dispatch the first outstanding agent-assigned role to record its verdict.
 * Returns the role names actually asked (empty when nothing was dispatchable).
 * Never throws — a failed dispatch leaves the slot outstanding for the next pass.
 */
export async function driveOutstandingSignoffs(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: {
    tenantId: number;
    projectId: number;
    task: SignoffTargetTask;
    signoff: SignoffGateResult;
    managerRef: string | null;
  },
): Promise<string[]> {
  const candidate = args.signoff.outstanding.find((o) => o.assigneeKind === 'agent' && !!o.assigneeRef);
  if (!candidate?.assigneeRef) return [];
  try {
    // `candidate.stageKey` is the slot's OWN stage, which is the lane the verdict has
    // to match; the ticket's current status is only a fallback for a stage-less slot.
    const payload = buildSignoffRequestPayload({
      cloudAgentRef: candidate.assigneeRef,
      taskId: args.task.id,
      taskTitle: args.task.title,
      roleKey: candidate.roleKey,
      roleName: candidate.roleName,
      laneKey: candidate.stageKey ?? args.task.status,
      prUrl: args.task.githubPrUrl,
    });
    const deferred: Promise<unknown>[] = [];
    await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: args.task.id,
      tenantId: args.tenantId,
      payload,
      submittedBy: `manager:signoff-request:${args.managerRef ?? 'system'}`,
    });
    await Promise.allSettled(deferred);
    return [candidate.roleName];
  } catch {
    return [];
  }
}
