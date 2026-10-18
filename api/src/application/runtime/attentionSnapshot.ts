/**
 * THE cross-surface "what's live / what needs me" snapshot — `GET /api/runtime/attention`.
 *
 * Every surface (web Brain chat list + FloatingBrain badge, the board, the VS Code
 * sessions/tasks trees) reads this SAME signal, so a session's status follows the user
 * everywhere they multitask.
 *
 * Two derived states per work item, most-severe wins:
 *   'awaiting_input' — an execution is PAUSED on ask_human (a pending question/feedback
 *                      approval): a person must answer before it resumes.
 *   'running'        — an execution is pending/submitted/running.
 * Idle items are omitted to keep the payload bounded.
 *
 * ── CACHED, because it is POLLED ────────────────────────────────────────────────
 * Every open VS Code window and web tab polls this, so uncached it kept the core
 * database awake for as long as any of them was open — at Neon's 0.25 CU floor, the
 * difference between fitting the Free plan and not (ROADMAP, 2026-09-15). The snapshot
 * is served from the read-through cache under a per-tenant version token:
 *
 *   - {@link bumpExecutionState} orphans every cached snapshot of a tenant. It is called
 *     where the HEADLINE states change: the execution-lifecycle outbox drain (inline
 *     for every `RuntimeService` transition), a run pausing on a question, and that
 *     question being answered.
 *   - Everything else the TENANT part reads — chat↔ticket links, the manager's cadence,
 *     and the handful of status writers that bypass `RuntimeService` (listed in the
 *     2026-09-15 DONE entry) — is bounded by {@link ATTENTION_CACHE}'s TTL.
 *   - The caller's UNREAD counts are a separate cached part (`chatUnreadCache.ts`): a user
 *     key inside the tenant entry made nearly every idle poll miss, because the KV TTL
 *     equalled the poll interval. Split, the tenant part is shared by every poller and the
 *     unread part is invalidated by chat reads and message appends instead of by the clock.
 *   - `fresh` re-primes. Surfaces pass it when they KNOW state just changed (a realtime
 *     push, a platform write, regaining focus); it is throttled to one reload per few
 *     seconds per key ({@link readThroughFresh}) so a burst of windows cannot stampede Neon.
 *
 * `recentlyActive` is derived from the clock at read time, never cached.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { approvals, chatTicketLinks, executions, projectManagerConfigs, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { executionStateVersion } from './executionStateVersion';
import { liveExecution } from '../rehearsal/executionMode';
import { loadUnread, readUnreadCached, type UnreadSnapshot } from '../brain/chatUnreadCache';
import { readThroughFresh } from './freshReadThrough';

export type AttentionState = 'running' | 'awaiting_input';

export interface AttentionItem {
  state: AttentionState;
  executionId?: number;
  approvalId?: string;
}

export interface AttentionSnapshot {
  tasks: Record<number, AttentionItem>;
  chats: Record<number, AttentionItem & { taskId: number }>;
  chatUnread: Record<number, number>;
  counts: { running: number; awaiting: number; unread: number };
  manager: { lastRunAt: string | null; recentlyActive: boolean };
}

/** What is cached per tenant: everything user-independent except the clock-derived `recentlyActive`. */
interface TenantAttention {
  tasks: AttentionSnapshot['tasks'];
  chats: AttentionSnapshot['chats'];
  running: number;
  awaiting: number;
  managerLastRunAt: string | null;
}

/** The key embeds the execution-state version, so a status change orphans it; the TTL only
 *  bounds the writers that bypass the version bump. L1 is short so a bump reaches an isolate sooner. */
const ATTENTION_CACHE = { kvTtlSeconds: 300, l1TtlMs: 15_000 };

const LIMIT = 500;

const NO_UNREAD: UnreadSnapshot = { chatUnread: {}, total: 0 };

/** "Manager active" = a pass landed in the last 3 min (cron cadence is 5 min, a pass is seconds). */
const MANAGER_ACTIVE_WINDOW_MS = 3 * 60_000;

export async function readAttention(
  env: Env | undefined,
  db: Db,
  args: { tenantId: number; projectId?: number; userId?: string; fresh?: boolean },
): Promise<AttentionSnapshot> {
  if (!env) {
    const [tenant, unread] = await Promise.all([
      loadAttention(db, args.tenantId, args.projectId),
      args.userId ? loadUnread(db, args.tenantId, args.userId) : NO_UNREAD,
    ]);
    return compose(tenant, unread);
  }

  const version = await executionStateVersion(env, args.tenantId);
  const key = `attention:v:${version}:${args.tenantId}:${args.projectId ?? 'all'}`;
  // The caller's unread map is global (not project-scoped) and only for a real user; an
  // agentHost runtime token sees {}.
  const [tenant, unread] = await Promise.all([
    readThroughFresh(env, key, () => loadAttention(db, args.tenantId, args.projectId), ATTENTION_CACHE, args.fresh),
    args.userId ? readUnreadCached(env, db, args.tenantId, args.userId, args.fresh) : NO_UNREAD,
  ]);
  return compose(tenant, unread);
}

function compose(tenant: TenantAttention, unread: UnreadSnapshot): AttentionSnapshot {
  const { managerLastRunAt, running, awaiting, ...rest } = tenant;
  const recentlyActive = managerLastRunAt != null && Date.now() - new Date(managerLastRunAt).getTime() < MANAGER_ACTIVE_WINDOW_MS;
  return {
    ...rest,
    chatUnread: unread.chatUnread,
    counts: { running, awaiting, unread: unread.total },
    manager: { lastRunAt: managerLastRunAt, recentlyActive },
  };
}

async function loadAttention(db: Db, tenantId: number, projectId: number | undefined): Promise<TenantAttention> {
  // Steps 1, 2 and 5 are independent reads, so they start together — one round
  // trip of latency instead of three. Only the chat links (4) wait, on the task ids.
  // 1) Every non-terminal execution for the tenant (optionally one project), with its task.
  const execQuery = db
    .select({ id: executions.id, taskId: executions.taskId, status: executions.status })
    .from(executions)
    .innerJoin(tasks, eq(tasks.id, executions.taskId))
    .where(scopedToTenant(
      executions,
      tenantId,
      inArray(executions.status, ['pending', 'submitted', 'running', 'paused']),
      liveExecution(),
      projectId != null ? eq(tasks.projectId, projectId) : undefined,
    ))
    .orderBy(desc(executions.createdAt))
    .limit(LIMIT);

  // 2) Pending human questions (ask_human) — the authoritative "needs an answer" rows.
  const approvalQuery = db
    .select({ id: approvals.id, executionId: approvals.executionId })
    .from(approvals)
    .where(scopedToTenant(
      approvals,
      tenantId,
      eq(approvals.status, 'pending'),
      inArray(approvals.kind, ['question', 'feedback']),
    ))
    .limit(LIMIT);

  // 5) AI Manager cadence — the freshest `last managed` stamp across the manager's scope:
  // that project's stamp when project-scoped, MAX across the tenant otherwise.
  const managerQuery = db
    .select({ lastRunAt: sql<Date | null>`max(${projectManagerConfigs.lastRunAt})` })
    .from(projectManagerConfigs)
    .where(scopedToTenant(
      projectManagerConfigs,
      tenantId,
      projectId != null ? eq(projectManagerConfigs.projectId, projectId) : undefined,
    ));

  const [execRows, approvalRows, [mgrRow]] = await Promise.all([execQuery, approvalQuery, managerQuery]);

  // execId → approval (only executions surfaced above, so already project-scoped).
  const approvalByExec = new Map<number, string>();
  for (const a of approvalRows) if (a.executionId != null) approvalByExec.set(a.executionId, a.id);

  // 3) Fold into per-task state (awaiting_input wins over running).
  const taskState = new Map<number, AttentionItem>();
  const setState = (taskId: number, next: AttentionItem) => {
    const cur = taskState.get(taskId);
    if (!cur || (next.state === 'awaiting_input' && cur.state !== 'awaiting_input')) taskState.set(taskId, next);
    else if (cur.state === next.state && !cur.approvalId && next.approvalId) taskState.set(taskId, next);
  };
  for (const e of execRows) {
    if (e.taskId == null) continue;
    const approvalId = approvalByExec.get(e.id);
    // A paused run, or any run carrying a pending question, is awaiting a person.
    if (e.status === 'paused' || approvalId) setState(e.taskId, { state: 'awaiting_input', executionId: e.id, approvalId });
    else setState(e.taskId, { state: 'running', executionId: e.id });
  }

  // 4) Propagate task state onto the Brain chats linked to those tasks (chat_ticket_links).
  const taskIds = [...taskState.keys()];
  const chatState: Record<number, AttentionItem & { taskId: number }> = {};
  if (taskIds.length > 0) {
    const linkRows = await db
      .select({ chatId: chatTicketLinks.chatId, ticketRef: chatTicketLinks.ticketRef })
      .from(chatTicketLinks)
      .where(scopedToTenant(
        chatTicketLinks,
        tenantId,
        inArray(chatTicketLinks.ticketKind, ['task', 'epic', 'gap']),
        inArray(chatTicketLinks.ticketRef, taskIds.map(String)),
      ))
      .limit(LIMIT);
    for (const l of linkRows) {
      const taskId = Number(l.ticketRef);
      const item = taskState.get(taskId);
      if (!item) continue;
      const cur = chatState[l.chatId];
      if (!cur || (item.state === 'awaiting_input' && cur.state !== 'awaiting_input')) {
        chatState[l.chatId] = { ...item, taskId };
      }
    }
  }

  const tasksOut: Record<number, AttentionItem> = {};
  for (const [taskId, item] of taskState) tasksOut[taskId] = item;

  const managerLastRunAt = mgrRow?.lastRunAt ? new Date(mgrRow.lastRunAt).toISOString() : null;

  return {
    tasks: tasksOut,
    chats: chatState,
    running: [...taskState.values()].filter((i) => i.state === 'running').length,
    awaiting: [...taskState.values()].filter((i) => i.state === 'awaiting_input').length,
    managerLastRunAt,
  };
}
