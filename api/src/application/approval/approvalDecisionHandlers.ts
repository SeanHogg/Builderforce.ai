/**
 * WHAT A DECISION DOES, BY ACTION TYPE — the registry `decideApproval` consults.
 *
 * Deciding an approval is one generic act (status, reviewer, note, answer). What
 * the decision then CAUSES belongs to the domain that raised it: approving a
 * `task.execution` gate starts the run, approving a workflow-run gate starts the
 * workflow, approving a mailbox reply sends the draft. Those used to be `if`
 * branches inside the PATCH route; they are now entries in this table, so a new
 * approval kind adds a row here instead of a branch in the decision path.
 *
 * Each handler is a thin adapter over its domain's own function — the domain logic
 * stays where it was.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvals } from '../../infrastructure/database/schema';
import type { RuntimeService } from '../runtime/RuntimeService';
import { dispatchCloudRunForTask, type CloudDispatchOutcome } from '../runtime/dispatchCloudRun';
import { parseApprovalReplay } from '../runtime/executionApprovalGate';
import { approvalSubjectRef } from './approvalGate';
import {
  startApprovedWorkflowRun,
  WORKFLOW_RUN_ACTION_TYPE,
  WORKFLOW_RUN_SUBJECT_KEY,
} from '../workflow/workflowRunApproval';
import {
  rejectMailboxAutomationApproval,
  sendMailboxAutomationExecution,
} from '../mailbox/mailboxAutomationService';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export type ApprovalRow = typeof approvals.$inferSelect;
export type ApprovalDecisionStatus = 'approved' | 'rejected' | 'answered';

export interface ApprovalDecisionContext {
  db: Db;
  env: Env;
  tenantId: number;
  segmentId: string | null;
  userId: string;
  approval: ApprovalRow;
  status: ApprovalDecisionStatus;
  runtimeService: RuntimeService;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface ApprovalDecisionEffect {
  /** A run the decision started, so the caller can follow it. */
  startedExecutionId?: number | null;
  /** Why the run the decision should have started did not — the approver's answer. */
  startRefusal?: string | null;
  /** The domain refused the decision; the approval was put back and the caller is told why. */
  abort?: { httpStatus: 409; error: string };
}

export type ApprovalDecisionHandler = (ctx: ApprovalDecisionContext) => Promise<ApprovalDecisionEffect | void>;

function parseMailboxAutomationExecutionId(metadata: string | null): number | null {
  if (!metadata) return null;
  try {
    const value = Number((JSON.parse(metadata) as { mailboxAutomationExecutionId?: unknown }).mailboxAutomationExecutionId);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

/**
 * Approving the RUN gate must actually start the run — approval only unlocks the
 * gate, so without this the task would sit idle until a human clicked Run again.
 * Replays the original submit (stored on the approval) as the same agent + model.
 * `dispatchCloudRunForTask` calls `runtimeService.submit` directly (no gate), so
 * this cannot loop.
 */
const startApprovedTaskRun: ApprovalDecisionHandler = async (ctx) => {
  if (ctx.status !== 'approved') return;
  const replay = parseApprovalReplay(ctx.approval.metadata);
  if (!replay) return;
  const started = await dispatchCloudRunForTask(ctx.env, ctx.db, ctx.runtimeService, ctx.waitUntil, {
    taskId: replay.taskId,
    tenantId: ctx.tenantId,
    payload: replay.payload,
    agentHostId: replay.agentHostId,
    submittedBy: ctx.approval.requestedBy ?? ctx.userId,
    // A manager just approved THIS run — the same explicit human override "Run now"
    // carries, so it clears the failure breaker and the re-run cooldown. (The
    // cloud-run cap still applies: an approval is not an entitlement.)
    force: true,
  }).catch((): CloudDispatchOutcome => ({ executionId: null }));
  return {
    startedExecutionId: started.executionId,
    // An approval that silently starts nothing reads as though the decision did nothing.
    startRefusal: started.executionId == null ? started.refusal?.message ?? null : null,
  };
};

/** Same reason as the run gate: approving a workflow-run gate must START the workflow. */
const startApprovedWorkflow: ApprovalDecisionHandler = async (ctx) => {
  if (ctx.status !== 'approved') return;
  const definitionId = approvalSubjectRef(ctx.approval.metadata, WORKFLOW_RUN_SUBJECT_KEY);
  if (definitionId) {
    await startApprovedWorkflowRun(ctx.db, ctx.tenantId, ctx.segmentId, definitionId).catch(() => null);
  }
};

/**
 * A mailbox reply approval owns a persisted draft. Approval is the only transition
 * that may send it; a failed send puts the approval back to pending with the reason.
 */
const decideMailboxReply: ApprovalDecisionHandler = async (ctx) => {
  const { db, tenantId, approval } = ctx;
  if (ctx.status === 'rejected') {
    await rejectMailboxAutomationApproval(db, tenantId, approval.id);
    return;
  }
  const mailboxExecutionId = parseMailboxAutomationExecutionId(approval.metadata);
  if (ctx.status !== 'approved' || mailboxExecutionId == null) return;
  const sent = await sendMailboxAutomationExecution(ctx.env, db, tenantId, mailboxExecutionId);
  if (sent.ok) return;
  await db.update(approvals).set({ status: 'pending', reviewNote: sent.error, updatedAt: new Date() })
    .where(and(eq(approvals.id, approval.id), eq(approvals.tenantId, tenantId)));
  reportCaughtError(new Error(sent.error), {
    source: 'application/approval/approvalDecisionHandlers.ts', operation: 'sendApprovedMailboxReply',
  });
  return { abort: { httpStatus: 409, error: sent.error } };
};

/** The registry: action type → the domain effect of deciding it. Data, not branches. */
const DECISION_HANDLERS = new Map<string, ApprovalDecisionHandler>([
  ['task.execution', startApprovedTaskRun],
  [WORKFLOW_RUN_ACTION_TYPE, startApprovedWorkflow],
  ['mailbox.reply', decideMailboxReply],
]);

/** Add a domain's decision effect. One handler per action type; a second is a bug. */
export function registerApprovalDecisionHandler(actionType: string, handler: ApprovalDecisionHandler): void {
  if (DECISION_HANDLERS.has(actionType)) throw new Error(`approval decision handler already registered: ${actionType}`);
  DECISION_HANDLERS.set(actionType, handler);
}

export function approvalDecisionHandlerFor(actionType: string): ApprovalDecisionHandler | null {
  return DECISION_HANDLERS.get(actionType) ?? null;
}
