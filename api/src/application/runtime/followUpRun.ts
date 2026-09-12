/**
 * Start a FOLLOW-UP run that carries a directive, on the same agent, repo pin and ticket
 * branch as the run it follows.
 *
 * ONE implementation for the two ways a directive reaches a finished run:
 *   - a person presses "Send" on a terminal run (`POST /runtime/executions/:id/messages`,
 *     which is also what `chats.execute_as_agent` replays), and
 *   - a steer that arrived after a live run's last turn (`lateSteerFollowUp.ts`) —
 *     operator decision 2026-09-12: spend the tokens rather than drop it.
 * Both are HUMAN-DIRECTED: the run is submitted under the person who wrote the directive.
 *
 * Order matters and is deliberate:
 *   1. ENTITLEMENTS first (token allowance, then the monthly cloud-run cap for a run
 *      that is not pinned to a host). These are billing facts a person cannot click
 *      past, and they are checked BEFORE a row exists — a refused follow-up is not a
 *      failed run, and no approval should be opened for a run that could never start.
 *   2. The governance APPROVAL gate (high/urgent tickets on a gated board). The payload
 *      it persists is the follow-up payload, so approving replays THIS run.
 *   3. Submit, echo the directive onto the new run's thread (display-only: it is already
 *      the run's headline instruction), record it as a PRD revision, dispatch.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { RuntimeService } from './RuntimeService';
import { buildFollowUpPayload } from './cloudDispatch';
import { evaluateExecutionApprovalGate } from './executionApprovalGate';
import { checkTenantTokenGate } from '../llm/tenantTokenAvailability';
import { enforceCloudRunCap, type CloudRunCapResult } from './cloudRunLedger';
import { startDispatchedExecution, type ExecutionTaskRow, type SubmittedExecution } from './dispatchCloudRun';
import { enqueueExecutionMessage } from './executionSteering';
import { recordPrdDirective } from './cloudAgent/prd';
import { AUTO_RUN_REASON_TEXT } from '../swimlane/evaluateAutoRun';

/** The run a follow-up continues from — what its payload and targeting are built from. */
export interface FollowUpPriorRun {
  id: number;
  payload: string | null;
  agentHostId: number | null;
  source?: string | null;
}

/** The refusals a follow-up honours: billing entitlements (cf. `ENTITLEMENT_REFUSALS`). */
export type FollowUpEntitlementRefusal = 'cloud_run_limit' | 'tenant_token_limit';

export type FollowUpRunOutcome =
  | { kind: 'started'; executionId: number; dispatch: unknown }
  | { kind: 'awaiting_approval'; approvalId: string; reason: string }
  | { kind: 'refused'; reason: FollowUpEntitlementRefusal; message: string };

export interface FollowUpRunArgs {
  tenantId: number;
  prior: FollowUpPriorRun;
  taskRow: ExecutionTaskRow;
  directive: string;
  /** The person directing the follow-up — the run's `submitted_by` and the acting user
   *  the token gate (and its superadmin bypass) is evaluated for. */
  submittedBy: string;
  /** Label for the PRD revision — the agent that ran the prior execution. */
  agentLabel: string;
}

export async function startFollowUpRun(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  waitUntil: (p: Promise<unknown>) => void,
  args: FollowUpRunArgs,
): Promise<FollowUpRunOutcome> {
  const { tenantId, prior, taskRow, directive, submittedBy, agentLabel } = args;

  // (1) Entitlements — before any row exists.
  const tokenBlock = await checkTenantTokenGate(db, tenantId, { actingUserId: submittedBy }, env);
  if (tokenBlock) return { kind: 'refused', reason: 'tenant_token_limit', message: tokenBlock.error };

  // On-prem runs execute on the user's own machine and are unlimited by policy, so only
  // a cloud-bound follow-up is held to the cloud-run cap (same rule as the dispatcher).
  const hostPinned = (prior.agentHostId ?? taskRow.assignedAgentHostId) != null;
  let cloudGate: CloudRunCapResult | undefined;
  if (!hostPinned) {
    cloudGate = await enforceCloudRunCap(db, tenantId, env);
    if (!cloudGate.allowed) {
      return {
        kind: 'refused',
        reason: 'cloud_run_limit',
        message: `${cloudGate.used}/${cloudGate.limit} runs used on the ${cloudGate.effectivePlan} plan. ${AUTO_RUN_REASON_TEXT.cloud_run_limit}`,
      };
    }
  }

  // (2) Governance gate, over the payload the run will actually carry.
  const payload = buildFollowUpPayload(prior.payload, { directive, priorExecutionId: prior.id });
  const gate = await evaluateExecutionApprovalGate(db, tenantId, submittedBy, taskRow, prior.agentHostId, { payload });
  if (!gate.allowed) return { kind: 'awaiting_approval', approvalId: gate.approvalId, reason: gate.reason };

  // (3) Start it.
  const execution = await runtimeService.submit({
    taskId: taskRow.id,
    agentHostId: prior.agentHostId ?? undefined,
    tenantId,
    submittedBy,
    payload,
    source: prior.source === 'vscode' || prior.source === 'brain' ? prior.source : 'agent',
  });
  await enqueueExecutionMessage(db, { executionId: execution.id, tenantId, role: 'user', text: directive, pending: false, sentBy: submittedBy });
  waitUntil(recordPrdDirective(env, db, {
    executionId: execution.id, tenantId, projectId: taskRow.projectId, taskId: taskRow.id,
    taskTitle: taskRow.title, agentLabel, directive,
  }));
  const dispatch = await startDispatchedExecution(
    env, db, runtimeService, waitUntil, tenantId,
    execution as SubmittedExecution, taskRow, payload,
    cloudGate ? { cloudGate } : undefined,
  );
  return { kind: 'started', executionId: execution.id, dispatch };
}
