/**
 * An @-addressed agent carrying out an instruction in ITS OWN runtime.
 *
 * The addressed-reply loop (`BrainService.agentReply`) answers on the Worker with the
 * platform tools — it has no working tree. The agent's tree, shell and git live in its
 * RUNTIME: the container (or durable) run that did its work on the ticket branch. So a
 * chat instruction that needs them ("merge and push", "run the tests", "fix the build")
 * cannot be answered here; it has to be HANDED TO THAT RUNTIME. Before this the agent
 * could only reply "I don't have git tools", which was true of the reply and false of
 * the agent.
 *
 * The hand-off reuses the platform's one directive path — `POST /runtime/executions/
 * :id/messages` — so the three cases it already distinguishes apply unchanged:
 *   - a LIVE run of this agent is steered (the directive lands on its next step);
 *   - a PAUSED run (waiting on `ask_human`) is answered and resumed;
 *   - a TERMINAL run gets a FOLLOW-UP run carrying the directive, on the SAME agent,
 *     repo pin and ticket branch (`buildFollowUpPayload`), so "push your changes"
 *     acts on the branch the previous run actually left them on.
 * With no prior run of this agent on the chat's tickets, the ticket is started on it
 * (`run-now`, the same dispatcher `chats.dispatch_agent` uses) and the directive is
 * queued as the run's first steer, which the loop drains at its first step.
 *
 * Only the agent's OWN runs are ever touched: a run by another agent on the same
 * ticket is not this agent's work to steer. The route replays carry the triggering
 * human's role, so the approval gate and every authz check apply exactly as if the
 * human had pressed "Send" on the run themselves.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { chatTicketLinks, executions, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ExecutionStatus } from '../../domain/shared/types';
import { isTerminalExecutionStatus, parseCloudAgentRef } from '../runtime/cloudDispatch';
import { isLifecycleManagedTask } from '../kanban/managedExecutionGuard';
import { advertisedName } from '../llm/toolNaming';
import { replayRoute, type BuiltinCtx } from '../llm/builtinToolContext';

/** Ticket kinds that can be RUN (the same set `chats.dispatch_agent` accepts). */
const RUNNABLE_TICKET_KINDS = ['task', 'epic', 'gap'] as const;

export interface AgentRunCandidate {
  id: number;
  taskId: number;
  status: string;
  cloudAgentRef: string | null;
  payload: string | null;
  createdAt: Date;
}

export interface LinkedTaskCandidate {
  id: number;
  assignedAgentRef: string | null;
}

/** Who ran a run: the stamped column, else the ref pinned on its payload. */
function runAgentRef(run: AgentRunCandidate): string | undefined {
  return run.cloudAgentRef ?? parseCloudAgentRef(run.payload ?? undefined);
}

/**
 * The run to hand the directive to, among THIS agent's runs only: a live run (steer)
 * beats a paused one (resume) beats the newest terminal one (follow-up on its branch).
 * Runs by other agents are never candidates.
 */
export function pickAgentRun(runs: readonly AgentRunCandidate[], agentRef: string): AgentRunCandidate | null {
  const rank = (r: AgentRunCandidate): number =>
    r.status === ExecutionStatus.PAUSED ? 1 : isTerminalExecutionStatus(r.status) ? 2 : 0;
  return (
    runs
      .filter((r) => runAgentRef(r) === agentRef)
      .sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

/**
 * With no prior run: the ticket to START on. The one the caller named; else the ONE
 * linked ticket assigned to this agent; else the only linked runnable ticket.
 * Ambiguity is reported, never guessed — starting a run on the wrong ticket is work.
 */
export function pickTaskToStart(
  linked: readonly LinkedTaskCandidate[],
  agentRef: string,
  taskId?: number,
): { taskId: number } | { error: string } {
  if (taskId != null) return { taskId };
  const mine = linked.filter((t) => t.assignedAgentRef === agentRef);
  const only = (list: readonly LinkedTaskCandidate[]): LinkedTaskCandidate | undefined => (list.length === 1 ? list[0] : undefined);
  const chosen = only(mine) ?? (mine.length === 0 ? only(linked) : undefined);
  if (chosen) return { taskId: chosen.id };
  if (linked.length === 0) {
    return { error: `this chat has no runnable ticket linked to it and you have no run on it — link the ticket first (${advertisedName('chats.link_ticket')}), or pass taskId.` };
  }
  return { error: `this chat links ${linked.length} runnable tickets and none is unambiguously yours — pass the taskId the instruction is about (${advertisedName('chats.list_tickets')} shows them).` };
}

export type ExecuteAsAgentResult =
  | { mode: 'steered' | 'resumed' | 'rerun' | 'started'; executionId: number | null; taskId: number; watch: string }
  | { mode: 'awaiting_approval'; approvalId: unknown; taskId: number; reason?: unknown };

/** What the module needs from the world — injectable so the orchestration is testable. */
export interface AddressedAgentRunDeps {
  linkedRunnableTasks(chatId: number): Promise<LinkedTaskCandidate[]>;
  runsForTasks(taskIds: readonly number[]): Promise<AgentRunCandidate[]>;
  isLifecycleManaged(taskId: number): Promise<boolean>;
  replay(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<unknown>;
}

export function addressedAgentRunDeps(ctx: BuiltinCtx): AddressedAgentRunDeps {
  return {
    async linkedRunnableTasks(chatId) {
      const links = await ctx.db
        .select({ ref: chatTicketLinks.ticketRef })
        .from(chatTicketLinks)
        .where(and(
          eq(chatTicketLinks.tenantId, ctx.tenantId),
          eq(chatTicketLinks.chatId, chatId),
          inArray(chatTicketLinks.ticketKind, [...RUNNABLE_TICKET_KINDS]),
        ));
      const ids = links.map((l) => Number(l.ref)).filter((n) => Number.isSafeInteger(n) && n > 0);
      if (ids.length === 0) return [];
      return ctx.db
        .select({ id: tasks.id, assignedAgentRef: tasks.assignedAgentRef })
        .from(tasks)
        .where(scopedToTenant(tasks, ctx.tenantId, inArray(tasks.id, ids)));
    },
    async runsForTasks(taskIds) {
      if (taskIds.length === 0) return [];
      return ctx.db
        .select({
          id: executions.id,
          taskId: executions.taskId,
          status: executions.status,
          cloudAgentRef: executions.cloudAgentRef,
          payload: executions.payload,
          createdAt: executions.createdAt,
        })
        .from(executions)
        .where(and(eq(executions.tenantId, ctx.tenantId), inArray(executions.taskId, [...taskIds])))
        .orderBy(desc(executions.createdAt))
        .limit(50);
    },
    isLifecycleManaged: (taskId) => isLifecycleManagedTask(ctx.db, ctx.tenantId, taskId).catch(() => false),
    replay: (method, path, body) => replayRoute(ctx, method, path, body),
  };
}

function watchUrl(executionId: number | null): string {
  return executionId != null ? `/executions/${executionId}` : '/executions';
}

/** Decode the directive route's three answers into one result. */
function directiveOutcome(r: unknown, fallbackExecutionId: number, taskId: number): ExecuteAsAgentResult {
  const o = (r ?? {}) as { ok?: boolean; error?: string; steered?: boolean; resumed?: boolean; rerun?: { executionId?: number }; status?: string; approvalId?: unknown; reason?: unknown };
  if (o.error) throw new Error(o.error);
  if (o.status === 'awaiting_approval') return { mode: 'awaiting_approval', approvalId: o.approvalId, taskId, reason: o.reason };
  if (o.rerun?.executionId != null) return { mode: 'rerun', executionId: o.rerun.executionId, taskId, watch: watchUrl(o.rerun.executionId) };
  if (o.resumed) return { mode: 'resumed', executionId: fallbackExecutionId, taskId, watch: watchUrl(fallbackExecutionId) };
  return { mode: 'steered', executionId: fallbackExecutionId, taskId, watch: watchUrl(fallbackExecutionId) };
}

/**
 * Hand `directive` to the addressed agent's runtime. `ctx.agentRef` names the agent —
 * the addressed reply stamps it; a caller without one is not an agent and gets an error.
 */
export async function executeAsAddressedAgent(
  ctx: BuiltinCtx,
  input: { chatId: number; directive: string; taskId?: number },
  deps: AddressedAgentRunDeps = addressedAgentRunDeps(ctx),
): Promise<ExecuteAsAgentResult> {
  const agentRef = ctx.agentRef?.trim();
  if (!agentRef) throw new Error('Only an addressed agent may execute in its own runtime.');
  const directive = input.directive.trim();
  if (!directive) throw new Error('directive is required — pass the user\'s instruction verbatim.');

  const linked = await deps.linkedRunnableTasks(input.chatId);
  const taskIds = input.taskId != null ? [input.taskId] : linked.map((t) => t.id);
  const prior = pickAgentRun(await deps.runsForTasks(taskIds), agentRef);
  if (prior) {
    const r = await deps.replay('POST', `/api/runtime/executions/${prior.id}/messages`, { text: directive });
    return directiveOutcome(r, prior.id, prior.taskId);
  }

  const start = pickTaskToStart(linked, agentRef, input.taskId);
  if ('error' in start) throw new Error(start.error);
  // On a lifecycle-managed board the Assignee is the coordinator, never the executor —
  // the stage's authorized role decides who runs, and overwriting the assignment would
  // discard evidence recorded against the previous owner. Same rule as dispatch_agent.
  if (!(await deps.isLifecycleManaged(start.taskId))) {
    await deps.replay('PATCH', `/api/tasks/${start.taskId}`, { assignedAgentRef: agentRef });
  }
  const started = (await deps.replay('POST', `/api/tasks/${start.taskId}/run-now`, { chatId: input.chatId })) as { error?: string; executionId?: number | null };
  if (started?.error) throw new Error(started.error);
  const executionId = typeof started?.executionId === 'number' ? started.executionId : null;
  // The run's first steer: the loop drains pending steers at the top of every step, so
  // the directive is the first thing the fresh run reads after its ticket context.
  if (executionId != null) {
    await deps.replay('POST', `/api/runtime/executions/${executionId}/messages`, { text: directive });
  }
  return { mode: 'started', executionId, taskId: start.taskId, watch: watchUrl(executionId) };
}
