/**
 * DECIDE AN APPROVAL — approve, reject, or answer one `approvals` row.
 *
 * Extracted from the `PATCH /api/approvals/:id` handler, which had grown every
 * domain's side effect as an inline branch. The generic part lives here (who may
 * decide, the status transition, the sign-off bridge, the host relay, Slack); the
 * domain part is looked up by action type in `approvalDecisionHandlers.ts`.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { approvals } from '../../infrastructure/database/schema';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import { TenantRole } from '../../domain/shared/types';
import { normalizeRequestKind, isAnswerableKind } from '../../domain/approval/requestKind';
import { isSelfOwnedApproval, isApprovalVisibleTo } from '../../domain/approval/selfOwned';
import { memberHasPermission } from '../rbac/effectivePermissions';
import { resumePausedExecution } from '../runtime/executionResume';
import { bumpExecutionState } from '../runtime/executionStateVersion';
import { parseApprovalReplay } from '../runtime/executionApprovalGate';
import type { RuntimeService } from '../runtime/RuntimeService';
import { TicketAuditService } from '../audit/ticketAuditService';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { resolveMemberDisplayName } from '../kanban/roleCapability';
import { recordActivity, resolveHumanActor } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { sendSlackNotification } from './approvalNotifier';
import { relayApprovalEvent, type ApprovalEnv } from './requestApproval';
import { approvalDecisionHandlerFor, type ApprovalDecisionStatus, type ApprovalRow } from './approvalDecisionHandlers';

const SOURCE = 'application/approval/decideApproval.ts';

export interface DecideApprovalInput {
  tenantId: number;
  segmentId: string | null;
  approvalId: string;
  actor: { userId: string; role: string; isManager: boolean };
  status?: string;
  reviewNote?: string | null;
  responseText?: string | null;
  runtimeService: RuntimeService;
  waitUntil: (promise: Promise<unknown>) => void;
}

export type DecideApprovalResult =
  | { ok: true; row: ApprovalRow | undefined; startedExecutionId: number | null; startRefusal: string | null }
  | { ok: false; httpStatus: 400 | 403 | 404 | 409; error: string };

const isDecisionStatus = (s: unknown): s is ApprovalDecisionStatus =>
  s === 'approved' || s === 'rejected' || s === 'answered';

/** The role a role-attributed run's approval was raised for, or null. Drives the §5.8 bridge. */
function parseApprovalRoleKey(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as { roleKey?: unknown };
    return typeof m.roleKey === 'string' && m.roleKey.trim() ? m.roleKey.trim() : null;
  } catch {
    return null;
  }
}

/**
 * §5.8 — a human DECIDING a role-attributed execution gate records that role's
 * sign-off on the accountability ledger, exactly like an agent reviewer's sign-off.
 * Only when the approval carries an explicit roleKey — never inferred, so it cannot
 * forge a record. Best-effort: never blocks the decision.
 */
async function bridgeRoleSignoff(
  db: Db, env: ApprovalEnv, tenantId: number, userId: string,
  existing: ApprovalRow, status: 'approved' | 'rejected', reviewNote: string | null | undefined,
): Promise<void> {
  const roleKey = parseApprovalRoleKey(existing.metadata);
  const bridgeTaskId = parseApprovalReplay(existing.metadata)?.taskId;
  if (!roleKey || bridgeTaskId == null) return;
  const report = (error: unknown) => reportCaughtError(error, { source: SOURCE, operation: 'bridgeRoleSignoff' });
  try {
    const memberName = await resolveMemberDisplayName(db, tenantId, 'human', userId);
    await new TicketAuditService(db).recordSignoff(env, tenantId, {
      taskId: bridgeTaskId,
      roleKey,
      verdict: status === 'approved' ? 'approved' : 'changes_requested',
      memberKind: 'human',
      memberRef: userId,
      memberName,
      summary: reviewNote ?? (status === 'approved' ? 'Approved via human gate' : 'Changes requested via human gate'),
      contribution: existing.executionId ? { executionId: existing.executionId } : undefined,
    });
    const participants = new TicketParticipantsService(db);
    await participants.syncStates(env, tenantId, bridgeTaskId).catch(report);
    await participants.invalidate(env, bridgeTaskId).catch(report);
    await recordActivity(env, db, {
      tenantId, projectId: null,
      actor: await resolveHumanActor(env, db, tenantId, userId),
      verb: status === 'approved' ? 'ticket.role.completed' : 'ticket.signed_off',
      targetType: 'task', targetId: String(bridgeTaskId), targetLabel: `#${bridgeTaskId}`,
      summary: `${roleKey} ${status === 'approved' ? 'approved' : 'changes requested'} via human approval`.slice(0, 300),
      metadata: { roleKey, via: 'approval', verdict: status },
    }).catch(report);
  } catch (error) {
    report(error);
  }
}

export async function decideApproval(db: Db, env: ApprovalEnv, input: DecideApprovalInput): Promise<DecideApprovalResult> {
  const { tenantId, approvalId: id, actor } = input;
  const userId = actor.userId;
  const status = input.status;

  if (!isDecisionStatus(status)) {
    return { ok: false, httpStatus: 400, error: 'status must be "approved", "rejected", or "answered"' };
  }
  if (status === 'answered' && !input.responseText?.trim()) {
    return { ok: false, httpStatus: 400, error: 'responseText is required when answering' };
  }
  const [existing] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
  // A self-owned approval is invisible — and so unanswerable — to anyone but its owner.
  if (!existing || !isApprovalVisibleTo(existing, userId)) return { ok: false, httpStatus: 404, error: 'Approval not found' };

  // Approving/rejecting is the governance action (it can start a billable run);
  // ANSWERING a question merely steers a run that is already approved, so it stays
  // at the developer tier. It depends on the body AND the row, hence inline. A
  // self-owned approval is not governance: its owner decides it, whatever their role.
  if (status !== 'answered' && !isSelfOwnedApproval(existing.actionType)) {
    if (!actor.isManager) {
      return { ok: false, httpStatus: 403, error: `Requires at least '${TenantRole.MANAGER}' role to approve or reject a request` };
    }
    const mayApprove = await memberHasPermission(db, tenantId, userId, actor.role, PERMISSIONS.APPROVAL_APPROVE, env);
    if (!mayApprove) {
      return { ok: false, httpStatus: 403, error: `Requires the '${PERMISSIONS.APPROVAL_APPROVE}' permission` };
    }
  }

  if (existing.status !== 'pending') return { ok: false, httpStatus: 409, error: 'Request is not pending' };

  const kind = normalizeRequestKind(existing.kind);
  if (status === 'answered' && !isAnswerableKind(kind)) {
    return { ok: false, httpStatus: 400, error: `'answered' is only valid for question/feedback requests` };
  }
  if (status !== 'answered' && isAnswerableKind(kind)) {
    return { ok: false, httpStatus: 400, error: `${kind} requests are resolved with status 'answered' + responseText` };
  }

  const responseText = status === 'answered' ? input.responseText!.trim() : null;

  // The pending check above is a prior read: two concurrent decides both pass it.
  // The UPDATE itself is the claim — only the decide whose predicate still sees
  // `pending` wins a row, and the loser stops here, BEFORE any side effect
  // (resume, run start, audit, relay) can fire a second time.
  const claimed = await db
    .update(approvals)
    .set({ status, reviewedBy: userId, reviewNote: input.reviewNote ?? null, responseText, updatedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId), eq(approvals.status, 'pending')))
    .returning({ id: approvals.id });
  if (claimed.length === 0) return { ok: false, httpStatus: 409, error: 'Request is not pending' };
  // An answered run question clears an "awaiting input" flag on every attention poller.
  if (existing.executionId && isAnswerableKind(kind)) await bumpExecutionState(env, tenantId);

  // Resume a paused CLOUD run: the answer is delivered as a pending user turn the
  // loop drains on its next tick. (The on-prem relay below covers self-hosted agents.)
  if (existing.executionId && responseText) {
    await resumePausedExecution(env, db, {
      executionId: existing.executionId,
      tenantId,
      answer: responseText,
      approvalId: id,
      runtimeService: input.runtimeService,
    });
  }

  // The domain effect of this decision, by action type.
  const handler = approvalDecisionHandlerFor(existing.actionType);
  const effect = handler
    ? await handler({
      db, env, tenantId, segmentId: input.segmentId, userId, approval: existing, status,
      runtimeService: input.runtimeService, waitUntil: input.waitUntil,
    })
    : undefined;
  if (effect?.abort) return { ok: false, httpStatus: effect.abort.httpStatus, error: effect.abort.error };

  if (status === 'approved' || status === 'rejected') {
    await bridgeRoleSignoff(db, env, tenantId, userId, existing, status, input.reviewNote);
  }

  // Tell the agent host so its blocked gate resumes.
  if (existing.agentHostId) {
    relayApprovalEvent(env, existing.agentHostId, {
      type: 'approval.decision',
      approvalId: id,
      status,
      reviewNote: input.reviewNote,
      responseText,
      reviewedBy: userId,
    });
  }

  if (env.SLACK_APPROVAL_WEBHOOK_URL) {
    const icon = status === 'approved' ? ':white_check_mark:' : status === 'rejected' ? ':x:' : ':speech_balloon:';
    await sendSlackNotification(
      env.SLACK_APPROVAL_WEBHOOK_URL,
      `${icon} ${kind} *${status}* by ${userId}\n` +
      `Action: ${existing.actionType} — ${existing.description}` +
      (responseText ? `\nAnswer: ${responseText}` : '') +
      (input.reviewNote ? `\nNote: ${input.reviewNote}` : ''),
    );
  }

  const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
  return {
    ok: true,
    row,
    startedExecutionId: effect?.startedExecutionId ?? null,
    startRefusal: effect?.startRefusal ?? null,
  };
}
