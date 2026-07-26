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
 * would spend N billable runs to answer one question. Slots with no agent assignee are
 * still skipped — dispatching nobody is not a fix for a staffing gap — but they are now
 * REPORTED (see {@link SignoffDriveResult}) rather than silently dropped, because a
 * ticket blocked on unstaffed or human-owed roles is not "being worked on", it is
 * waiting on a person who was never told.
 *
 * Lives in its own module (rather than inside `ManagerService`) because BOTH the
 * manager's review pass and its stall-triage stage drive sign-offs, and a shared
 * import from either into the other would be circular.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { SignoffGateResult, SignoffOwnership } from './signoffGate';
import { classifySignoffOwnership, describeSignoffOwnership } from './signoffGate';
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
 * What driving the sign-offs achieved — and, when it achieved nothing, WHY.
 *
 * The bare `string[]` this used to return could not tell "the agent was asked" from
 * "there is no agent to ask", so every caller journalled the same unactionable line
 * either way. `ownership` carries the distinction to the feed, the stuck register and
 * the escalation decision.
 */
export interface SignoffDriveResult {
  /** Role names actually dispatched this call. Empty when nothing was dispatchable. */
  asked: string[];
  ownership: SignoffOwnership;
  /** True when at least one outstanding slot is agent-owned, asked or not. */
  dispatchable: boolean;
  /** One clause naming the blocker when nothing could be asked; '' otherwise. */
  blockedDetail: string;
}

/**
 * Which agent-owed slot to ask next. PURE.
 *
 * ALWAYS TAKING `dispatchable[0]` COULD NOT SATISFY A MULTI-ROLE GATE. `in_progress` is
 * the record that a slot has already been dispatched, and an asked-but-unanswered slot
 * stays outstanding — so the first-outstanding rule re-asked the SAME role on every pass
 * while slots 2..N were never asked once. On the measured tickets (10 required slots
 * each) that made "waiting on 10 of 10" a state the gate could never leave, however many
 * passes ran: nine of the ten roles had no path to being asked at all.
 *
 * So: prefer a slot nobody has asked yet, and fall back to re-asking only once every
 * agent-owed slot has had its turn.
 */
export function pickSignoffCandidate(ownership: SignoffOwnership): SignoffOwnership['dispatchable'][number] | null {
  return ownership.dispatchable.find((s) => s.state !== 'in_progress') ?? ownership.dispatchable[0] ?? null;
}

/**
 * Dispatch one outstanding agent-assigned role to record its verdict.
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
): Promise<SignoffDriveResult> {
  const ownership = classifySignoffOwnership(args.signoff.outstanding);
  const result: SignoffDriveResult = {
    asked: [],
    ownership,
    dispatchable: ownership.dispatchable.length > 0,
    blockedDetail: describeSignoffOwnership(ownership),
  };
  const candidate = pickSignoffCandidate(ownership);
  if (!candidate?.assigneeRef) return result;
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
    return { ...result, asked: [candidate.roleName] };
  } catch {
    return result;
  }
}
