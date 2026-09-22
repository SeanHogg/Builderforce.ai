/**
 * chatRunHistory — "who actually RAN for this conversation, and who started them?"
 *
 * A chat can file tickets, invite agents, assign them and still have nothing execute.
 * From inside the conversation those two outcomes look identical: the transcript shows
 * a well-staffed plan either way. The only fact that separates them lives in
 * `executions`, and until now nothing read it FROM a chat — the chat diagnostics report
 * named the invited agents and the linked tickets and then stopped, one join short of
 * the answer. A user reading it could see three agents and seven tickets and still not
 * learn that zero cloud runs had ever been started.
 *
 * ── WHY `submittedBy` IS THE POINT ───────────────────────────────────────────────
 * The interesting question is not only "did a run happen" but "WHICH PATHWAY started
 * it", and `executions.submitted_by` already records exactly that — `user:<id>` for a
 * human pressing Run, `system:lane-auto` for board autonomy, `system:coordinator` for
 * the manager's coordination pass, `manager:signoff-request:<ref>` for a sign-off. A
 * chat whose runs are all `system:lane-auto` was never driven from the conversation at
 * all; a chat with no runs and three invited agents has a staffing gap, not a runtime
 * one. Those have different fixes, so the history reports the raw label and lets the
 * reader see it rather than collapsing every start into "started".
 *
 * Read-only and bounded. It is NOT read-through cached, on purpose: its callers are the
 * diagnostics capture (one fetch per "Copy diagnostics" click) and the `chats.runs`
 * tool, and every field it returns — status, `produced`, `completedAt` — is live run
 * state that changes under the reader. A cached run status in a report whose entire job
 * is to say what is happening right now is worse than the query it saves.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { executions, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { linkedRunnableTickets } from './chatLinkedTickets';
import { resolveAgentIdentities } from './agentDisplayNames';
import { resolveChatAccess } from './chatAccess';
import { parseCloudAgentRef } from '../runtime/cloudDispatch';
import type { Db } from '../../infrastructure/database/connection';

/** How many runs one history read returns. Newest first — an old run explains less. */
export const CHAT_RUN_HISTORY_LIMIT = 25;

/**
 * The most rows ANY caller can ask for.
 *
 * `limit` reaches this module from a model-supplied tool argument, so it is untrusted
 * input on a table that holds thousands of rows per busy ticket. An unbounded result set
 * here is the ordinary way a read endpoint becomes an outage; the ceiling is generous
 * enough that nobody hits it while diagnosing a chat.
 */
export const MAX_CHAT_RUN_HISTORY_LIMIT = 200;

/** Coerce an untrusted `limit` into the supported range. */
export function clampChatRunHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return CHAT_RUN_HISTORY_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CHAT_RUN_HISTORY_LIMIT);
}

/** One execution started against a ticket this chat links. */
export interface ChatRunRecord {
  executionId: number;
  taskId: number;
  /** The ticket's title, so a reader does not have to look up an id to read the line. */
  taskTitle: string | null;
  /** The agent that actually ran it (`cloud_agent_ref`, else the ref pinned on the payload). */
  agentRef: string | null;
  /** That agent's display name — the ref itself when the agent is gone. */
  agentName: string | null;
  status: string;
  /**
   * WHICH dispatcher started this run, verbatim (`user:<id>`, `system:lane-auto`,
   * `system:coordinator`, `manager:signoff-request:<ref>`). Never normalised — the
   * distinction between a human-driven run and an autonomy-driven one is the whole
   * reason this field is reported.
   */
  submittedBy: string;
  /** The initiating surface ('agent' | 'vscode' | …), governed by the tenant kill switch. */
  source: string;
  /** Did the finished run leave anything behind (commit / PR / merge / lane move)? Null = not judged. */
  produced: boolean | null;
  /** First line of the failure, when there was one — capped, so a history stays readable. */
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** What the chat's runs add up to — the verdict a reader wants before the detail. */
export interface ChatRunHistory {
  /** Runnable tickets this chat links. Zero means the history could not be non-empty. */
  linkedRunnableTickets: number;
  /** Runs returned (capped at {@link CHAT_RUN_HISTORY_LIMIT}). */
  runs: ChatRunRecord[];
  /**
   * Distinct `submittedBy` labels across the returned runs, so a caller can say "every
   * run here was started by board autonomy, none from this conversation" without
   * re-deriving it from the list.
   */
  dispatchers: string[];
}

/**
 * An `executions` row, as far as this module reads it. Named so the SHAPING below can be
 * exercised without a database: the query is one thing to get right and the projection
 * is another, and only the second one carries rules (which agent ran it, how a failure is
 * trimmed, what "produced nothing" means).
 */
export interface ChatRunRow {
  id: number;
  taskId: number;
  status: string;
  submittedBy: string;
  source: string;
  cloudAgentRef: string | null;
  payload: string | null;
  produced: boolean | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** Longest failure text carried per run — a history is a summary, not a log. */
const MAX_ERROR_CHARS = 200;

/** First non-empty line of a failure, trimmed and capped. */
function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  if (!line) return null;
  return line.length > MAX_ERROR_CHARS ? `${line.slice(0, MAX_ERROR_CHARS)}…` : line;
}

/** ISO string, or null — the wire shape, so every surface formats one thing. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The agent a run RECORDS — the one that executed, not the ticket's current assignee.
 *
 * Stamped on `cloud_agent_ref` at dispatch; older rows carry it only on the payload.
 * Reading the assignee instead would name somebody who never ran: on a lifecycle-managed
 * board the assignee is the coordinator and the stage's authorized role is the executor,
 * so the two differ by design.
 */
export function runAgentRefOf(row: Pick<ChatRunRow, 'cloudAgentRef' | 'payload'>): string | null {
  return row.cloudAgentRef ?? parseCloudAgentRef(row.payload ?? undefined) ?? null;
}

/**
 * Project execution rows onto the reported shape. Pure — no clock, no I/O — so the rules
 * it encodes can be exercised directly.
 */
export function toChatRunRecords(
  rows: readonly ChatRunRow[],
  titles: ReadonlyMap<number, string | null>,
  names: ReadonlyMap<string, string>,
): ChatRunRecord[] {
  return rows.map((row) => {
    const agentRef = runAgentRefOf(row);
    return {
      executionId: row.id,
      taskId: row.taskId,
      taskTitle: titles.get(row.taskId) ?? null,
      agentRef,
      agentName: agentRef ? names.get(agentRef) ?? agentRef : null,
      status: row.status,
      submittedBy: row.submittedBy,
      source: row.source,
      produced: row.produced ?? null,
      errorMessage: firstLine(row.errorMessage),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/**
 * Every run started against a ticket this chat links, newest first.
 *
 * Four bounded queries, never N+1: the chat's runnable tickets (two, shared with the
 * addressed-agent hand-off), the executions for them in one `IN`, their titles in one
 * `IN`, and every distinct agent name in one `IN`.
 */
export async function readChatRunHistory(
  db: Db,
  tenantId: number,
  chatId: number,
  limit: number = CHAT_RUN_HISTORY_LIMIT,
): Promise<ChatRunHistory> {
  const linked = await linkedRunnableTickets(db, tenantId, chatId);
  if (linked.length === 0) return { linkedRunnableTickets: 0, runs: [], dispatchers: [] };
  const taskIds = linked.map((t) => t.id);

  const rows = await db
    .select({
      id: executions.id,
      taskId: executions.taskId,
      status: executions.status,
      submittedBy: executions.submittedBy,
      source: executions.source,
      cloudAgentRef: executions.cloudAgentRef,
      payload: executions.payload,
      produced: executions.produced,
      errorMessage: executions.errorMessage,
      startedAt: executions.startedAt,
      completedAt: executions.completedAt,
      createdAt: executions.createdAt,
    })
    .from(executions)
    .where(and(eq(executions.tenantId, tenantId), inArray(executions.taskId, taskIds)))
    .orderBy(desc(executions.createdAt))
    .limit(clampChatRunHistoryLimit(limit));

  if (rows.length === 0) {
    return { linkedRunnableTickets: linked.length, runs: [], dispatchers: [] };
  }

  // Titles for the tickets that actually appear in the returned runs — not for every
  // linked ticket, which on a busy chat is the larger set.
  const runTaskIds = [...new Set(rows.map((r) => r.taskId))];
  const titleRows = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, inArray(tasks.id, runTaskIds)));
  const titles = new Map(titleRows.map((t) => [t.id, t.title]));

  const identities = await resolveAgentIdentities(
    db,
    tenantId,
    rows.map(runAgentRefOf).filter((r): r is string => r != null),
  );
  const names = new Map([...identities].map(([ref, id]) => [ref, id.name] as const));

  const runs = toChatRunRecords(rows, titles, names);

  return {
    linkedRunnableTickets: linked.length,
    runs,
    dispatchers: [...new Set(runs.map((r) => r.submittedBy))],
  };
}

/**
 * The history for a chat the caller is allowed to see, or `null` when they are not.
 *
 * The access decision goes through {@link resolveChatAccess} — the ONE guard every other
 * chat-scoped read already uses — rather than a check written out here, so a run history
 * can never be reachable on a chat whose tickets and agents are not. The module owns its
 * own authorization for the same reason it owns its own query: a caller that has to
 * remember to gate it is a caller that will eventually forget.
 */
export async function readChatRunHistoryForCaller(
  db: Db,
  tenantId: number,
  chatId: number,
  userId: string | null,
  limit: number = CHAT_RUN_HISTORY_LIMIT,
): Promise<ChatRunHistory | null> {
  const chat = await resolveChatAccess(db, { chatId, tenantId, userId });
  if (!chat) return null;
  return readChatRunHistory(db, tenantId, chatId, limit);
}
