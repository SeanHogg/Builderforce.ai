import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * requestRoleRun — THE one way to ask an agent to work (or review) a ticket AS a role.
 *
 * Four call sites did this: the lane gate's approver path, its reviewer round-trip, its
 * producer dispatch, and the AI Manager's `driveOutstandingSignoffs`. They shared the
 * payload builders (`signoffRequest.ts`) but each hand-wrote the three steps that come
 * AFTER the payload — dispatch, record that the slot was asked, emit the activity — and
 * the copies had drifted into two distinct bugs:
 *
 *  1. `dispatchCloudRunForTask` RETURNS NULL when it refuses (monthly cloud-run cap,
 *     failure breaker, re-run cooldown). Two copies ignored the return value entirely and
 *     reported the role as dispatched anyway, so the manager feed said "Requested sign-off
 *     from Architect" on passes where nothing was ever started.
 *  2. Only the lane gate called `markRoleInProgress`. The manager's copy never did — and
 *     `pickSignoffCandidate` skips slots that are `in_progress` precisely to work through
 *     roles 1..N. With the marker never written, every pass re-picked slot #1: on a
 *     ten-role ticket, nine roles had no path to ever being asked, which is the measured
 *     "all reviewers assigned, none executing" state.
 *
 * So the sequence lives here once: dispatch → (only if a run actually started) mark the
 * slot in_progress and emit `ticket.role.dispatched` → return the execution id. A caller
 * that gets a null id back knows nothing happened and must say so — and now gets the
 * dispatcher's REASON with it, so "must say so" can be an actionable sentence rather than
 * the caller's guess.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { TicketParticipantsService } from './ticketParticipants';
import { buildProducerRequestPayload, buildSignoffRequestPayload } from './signoffRequest';
import { recordActivity, cloudAgentActor } from '../activity/activityLog';
import { dispatchCloudRunForTask, type CloudDispatchOutcome } from '../../presentation/routes/runtimeRoutes';

/** Whether the role is being asked to REVIEW the work or to PRODUCE it. */
export type RoleRunKind = 'reviewer' | 'producer';

export interface RoleRunRequest {
  tenantId: number;
  projectId: number;
  taskId: number;
  taskTitle?: string | null;
  roleKey: string;
  roleName: string;
  agentRef: string;
  model?: string | null;
  /** The lane whose accountability slot this run serves — see `signoffRequest.ts`. */
  laneKey: string | null;
  kind: RoleRunKind;
  submittedBy: string;
  prUrl?: string | null;
  /**
   * The backplane this run must execute on (`agent_hosts.id`), when the lane or the
   * caller pinned one. Null/absent = cloud, which is what every role run resolved to
   * before — the lane trigger resolved its lane's host and then dropped it on this path.
   */
  agentHostId?: number | null;
  /**
   * The Brain chat that asked for this run. Carried onto the payload so the run narrates
   * its lifecycle back into that conversation (`parseOriginatingChatId`) — without it a
   * chat-dispatched agent runs invisibly and cannot be followed or steered from the chat
   * that started it.
   */
  chatId?: number | null;
  /**
   * Override the failure breaker + re-run cooldown, exactly as a human's "Run now" does.
   * Only for a DELIBERATE, attempt-bounded override (the manager's breaker reset) — never
   * for an ordinary autonomous ask, which is what the breaker exists to stop.
   */
  force?: boolean;
}

/**
 * The dispatch payload for a role run. Exported because the lane trigger must hand the
 * governance approval gate the payload it is ACTUALLY about to dispatch — an approval
 * that later replays a differently-shaped payload is an approval for a different run.
 * One builder, so the gated payload and the dispatched one cannot drift.
 */
export function buildRoleRunPayload(req: RoleRunRequest): string {
  const spec = {
    cloudAgentRef: req.agentRef,
    model: req.model ?? null,
    taskId: req.taskId,
    taskTitle: req.taskTitle ?? null,
    roleKey: req.roleKey,
    roleName: req.roleName,
    laneKey: req.laneKey,
    prUrl: req.prUrl ?? null,
    chatId: req.chatId ?? null,
  };
  return req.kind === 'producer' ? buildProducerRequestPayload(spec) : buildSignoffRequestPayload(spec);
}

/**
 * Dispatch the role's run and record it. Returns the dispatcher's outcome — on a refusal
 * NOTHING is recorded, because a slot marked `in_progress` with no run behind it is a
 * slot nobody will ever ask again, and the refusal's reason travels back so the caller
 * can say which guard declined instead of inventing one.
 */
export async function requestRoleRun(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  participants: TicketParticipantsService,
  req: RoleRunRequest,
): Promise<CloudDispatchOutcome> {
  const payload = buildRoleRunPayload(req);

  const deferred: Promise<unknown>[] = [];
  const outcome = await dispatchCloudRunForTask(
    env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); },
    {
      taskId: req.taskId,
      tenantId: req.tenantId,
      payload,
      submittedBy: req.submittedBy,
      // The lane's staffed backplane. Dropping it sent a role run for an on-prem lane
      // to the cloud, which is the one thing the operator's runtime choice forbids.
      ...(req.agentHostId != null ? { agentHostId: req.agentHostId } : {}),
      ...(req.force ? { force: true } : {}),
    },
  ).catch(() => ({ executionId: null }) as CloudDispatchOutcome);
  await Promise.allSettled(deferred);
  const executionId = outcome.executionId;
  if (executionId == null) return { executionId: null, ...(outcome.refusal ? { refusal: outcome.refusal } : {}) };

  await participants
    .markRoleInProgress(env, req.tenantId, req.taskId, req.roleKey, req.laneKey, executionId)
    .catch((error) => { /* attribution is observability — never fail the dispatch on it */ 
      reportCaughtError(error, { source: "application/kanban/requestRoleRun.ts", operation: "requestRoleRun" });
    });
  await recordActivity(env, db, {
    tenantId: req.tenantId,
    projectId: req.projectId,
    actor: cloudAgentActor(req.agentRef, req.roleName),
    verb: 'ticket.role.dispatched',
    targetType: 'task',
    targetId: String(req.taskId),
    targetLabel: `#${req.taskId}`,
    summary: `${req.roleName} dispatched as ${req.kind} for ticket #${req.taskId}`.slice(0, 300),
    metadata: { roleKey: req.roleKey, responsibility: req.kind, agentRef: req.agentRef },
  }).catch((error) => {
    reportCaughtError(error, { source: "application/kanban/requestRoleRun.ts", operation: "requestRoleRun" });
  });
  return { executionId };
}
