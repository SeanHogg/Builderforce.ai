/**
 * cloudQuestionApproval — the approvals-queue row a paused cloud run waits on (extracted from `executionPause.ts`).
 *
 * A blocked cloud agent's `ask_human` call, or a governance gate's `require-approval` call, is recorded as ONE approval scoped
 * to its execution, in the SAME queue self-hosted agents use, so the answer routes back to this exact run.
 */
import { approvals } from '../../infrastructure/database/schema';
import { notifyApprovalRequested } from '../approval/approvalNotifier';
import { GOVERNANCE_GATE_ACTION } from '../../domain/approval/requestKind';
import { notifyExecutionSubscribers } from './executionEvents';
import { bumpExecutionState } from './executionStateVersion';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * How long an unanswered agent question waits before the /escalate sweep expires it
 * and alerts. Shorter than the 72h paused-run reap deadline on purpose: escalation
 * should get a human's attention well BEFORE the backstop kills the run.
 */
export const CLOUD_QUESTION_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * A blocked cloud agent's `ask_human` call: record a `question` approval scoped to
 * this execution (so the answer routes back to this exact run) into the SAME
 * approvals queue self-hosted agents use, fan out the team notification (Slack +
 * email), and surface the question on the live execution stream. Returns the new
 * approval id so the loop can carry it in the pause result. Best-effort on notify;
 * the row insert is the durable part.
 */
export async function createCloudQuestion(
  env: Env,
  db: Db,
  args: {
    tenantId: number; cloudAgentRef?: string; executionId: number;
    agentLabel: string; question: string; context?: string;
    /** `approval`: a governance gate's call needs an approver (resolved approved / rejected). Default `question`. */
    kind?: 'question' | 'approval';
  },
): Promise<string> {
  const kind = args.kind ?? 'question';
  const actionType = kind === 'approval' ? GOVERNANCE_GATE_ACTION : 'clarify.blocked';
  const approvalId = crypto.randomUUID();
  const now = new Date();
  // An agent's question MUST carry an expiry. `expiresAt` is caller-supplied and has
  // no default, and this path used to set none — so the /escalate sweep (which only
  // sees `expiresAt < now`) could never escalate an unanswered agent question. It sat
  // pending forever, and because `paused` counts as a LIVE run in evaluateTaskAutoRun
  // + laneRequirementGate, one ignored question silently froze all future autonomy on
  // that ticket. Escalation is the FIRST line here (it pings the manager); the 72h
  // paused-run reaper in staleExecutionReaper is the backstop that eventually frees
  // the ticket if nobody ever answers. Deliberately generous: a question asked on a
  // Friday afternoon must still be answerable on Monday morning.
  const expiresAt = new Date(now.getTime() + CLOUD_QUESTION_ESCALATE_AFTER_MS);
  const description = args.context?.trim()
    ? `${args.question.trim()}\n\nContext: ${args.context.trim()}`
    : args.question.trim();
  await db.insert(approvals).values({
    id:           approvalId,
    tenantId:     args.tenantId,
    // segment_id is set by the DB trigger (0056); omitted like the on-prem POST path.
    executionId:  args.executionId,
    cloudAgentRef: args.cloudAgentRef ?? null,
    requestedBy:  args.agentLabel,
    kind,
    actionType,
    description,
    status:       'pending',
    expiresAt,
    createdAt:    now,
    updatedAt:    now,
  });
  // The run now needs a person — every attention poller should show it at once.
  await bumpExecutionState(env, args.tenantId);

  await notifyApprovalRequested(env, db, {
    tenantId: args.tenantId, approvalId, kind,
    actionType, description,
  });

  // Mirror onto the live execution stream so an open panel shows the ask immediately.
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'assistant',
    text: `⏸ Paused — waiting on a human answer:\n${args.question.trim()}`,
    ts: now.toISOString(),
  });

  return approvalId;
}
