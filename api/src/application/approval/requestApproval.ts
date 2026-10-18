/**
 * RAISE AN APPROVAL — the one write path into `approvals` for anything outside the
 * server-side execution gate.
 *
 * Two doors used to raise one: `POST /api/approvals` and the agent-host
 * `POST /api/agent-hosts/:id/approval-request`. They had drifted: the host door
 * skipped the auto-approval rules, the `task.execution` forgery guard and the
 * Slack/email fan-out. Both are now adapters over {@link requestApproval}, so a
 * request means the same thing whichever door it came through.
 *
 * Authentication stays with the door (an agent-host key or a tenant JWT); this
 * function receives the resolved principal and applies everything else.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { approvals } from '../../infrastructure/database/schema';
import { normalizeRequestKind, type RequestKind } from '../../domain/approval/requestKind';
import { isSelfOwnedApproval } from '../../domain/approval/selfOwned';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { notifyApprovalRequested, notifyRequesterOfOwnApproval } from './approvalNotifier';
import { checkAutoApprovalRules } from './autoApprovalRules';

/** The relay binding is optional: tests and scripts run without one. */
export type ApprovalEnv = Env & { AGENT_HOST_RELAY?: DurableObjectNamespace<AgentHostRelayDO> };

export interface ApprovalRequestInput {
  tenantId: number;
  /** Set when an agent host raised it (machine principal, authenticated by its key). */
  agentHostId: number | null;
  /** The signed-in person who raised it; null for a machine caller. */
  callerUserId: string | null;
  requestedBy?: string | null;
  kind?: unknown;
  actionType?: string | null;
  description?: string | null;
  /** Stored whole as JSON. Only an object form is read by the auto-approval rules. */
  metadata?: unknown;
  expiresAt?: string | number | null;
}

export type ApprovalRequestResult =
  | { ok: true; approvalId: string; status: 'pending' | 'approved'; kind: RequestKind }
  | { ok: false; httpStatus: 400 | 403; error: string };

/**
 * Tell the host's connected browsers about an approval event. Best-effort: the row
 * is the record, the relay is a nudge.
 */
export function relayApprovalEvent(env: ApprovalEnv, agentHostId: number, message: Record<string, unknown>): void {
  if (!env.AGENT_HOST_RELAY) return;
  const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
  stub.fetch(new Request('https://internal/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })).catch((error) => {
    reportCaughtError(error, {
      source: 'application/approval/requestApproval.ts',
      operation: 'relayApprovalEvent',
      context: { details: { agentHostId, type: message.type } },
    });
  });
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function requestApproval(db: Db, env: ApprovalEnv, input: ApprovalRequestInput): Promise<ApprovalRequestResult> {
  const { tenantId, agentHostId, callerUserId } = input;
  const actionType = input.actionType ?? '';
  const description = input.description ?? '';
  if (!actionType || !description) {
    return { ok: false, httpStatus: 400, error: 'actionType and description are required' };
  }

  // `task.execution` is the RUN gate: an approved one lets a task dispatch without
  // further manager sign-off, and only `evaluateExecutionApprovalGate` may create one
  // (server-side). Accepting it from any door would let a caller mint a gate row and,
  // if a rule matched, clear the manager gate on a high/urgent ticket outright.
  if (actionType === 'task.execution') {
    return { ok: false, httpStatus: 400, error: `'task.execution' approvals are created by the execution gate, not by clients` };
  }

  const kind = normalizeRequestKind(input.kind);

  // A self-owned approval (a Synapse step on the caller's own desktop) belongs to the
  // signed-in person who raised it: a machine key cannot raise one, the requester is
  // the caller (never a body field), and no team rule may auto-approve it.
  const selfOwned = isSelfOwnedApproval(actionType);
  if (selfOwned && (agentHostId != null || !callerUserId)) {
    return { ok: false, httpStatus: 403, error: `'${actionType}' approvals are raised by a signed-in person` };
  }

  // Only 'approval' kinds auto-resolve; a question needs a human to actually answer.
  const autoApproved = kind === 'approval' && !selfOwned
    && await checkAutoApprovalRules(db, tenantId, actionType, asObject(input.metadata));

  const approvalId = crypto.randomUUID();
  const now = new Date();
  const status = autoApproved ? 'approved' : 'pending';

  await db.insert(approvals).values({
    id:          approvalId,
    tenantId,
    agentHostId,
    requestedBy: selfOwned ? callerUserId! : input.requestedBy ?? (agentHostId ? String(agentHostId) : null),
    kind,
    actionType,
    description,
    metadata:    input.metadata != null ? JSON.stringify(input.metadata) : null,
    expiresAt:   input.expiresAt ? new Date(input.expiresAt) : null,
    status,
    reviewedBy:  autoApproved ? 'auto-approval-rule' : null,
    reviewNote:  autoApproved ? 'Automatically approved by matching rule' : null,
    createdAt:   now,
    updatedAt:   now,
  });

  if (agentHostId) {
    relayApprovalEvent(env, agentHostId, {
      type: autoApproved ? 'approval.auto_approved' : 'approval.request',
      approvalId,
      kind,
      actionType,
      description,
      expiresAt: input.expiresAt,
      status,
    });
  }

  // A self-owned request tells its owner alone — never the team.
  if (selfOwned) {
    await notifyRequesterOfOwnApproval(env, db, { userId: callerUserId!, description });
  } else if (!autoApproved) {
    await notifyApprovalRequested(env, db, { tenantId, approvalId, kind, actionType, description });
  }

  return { ok: true, approvalId, status, kind };
}
