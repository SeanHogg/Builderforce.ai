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
 * ── WHERE IT RAN IS THE OTHER HALF ─────────────────────────────────────
 * "A run happened" does not say what the run could DO. Every cloud run is the one engine
 * on the durable runner, and what it could do depends on its SANDBOX: with one (the
 * Cloudflare Container, or the repo's Actions runner) it has a shell and a working tree,
 * so it can grep, build, type-check and test before finishing; with none it edits over
 * the git API and provably cannot run a build. A chat whose every run had no sandbox and
 * produced a plausible-looking diff that was never compiled reads, from the transcript
 * alone, exactly like one that ran the full toolchain. So the history reports `executor`
 * and `sandbox` (both stamped on the payload) and the on-prem `agent_host_id`.
 *
 * Live cloud SUB-AGENTS of this chat ride the same read: rows with `parent_execution_id`
 * whose payload `chatId` is the chat, mapped to the existing `ChatSubagentVM` shape
 * (`key` / `handle` / `name` / `label` / `owner`). The web Agents list has nowhere else
 * to learn them — VS Code already has its local run registry; the API did not.
 *
 * Read-only and bounded. {@link readChatRunHistory} itself is NOT cached: the diagnostics
 * capture (one fetch per "Copy diagnostics" click) and the `chats.runs` tool want live
 * state. The POLLED route (`GET /chats/:id/runs`, every 4-30 s per open chat) goes through
 * {@link readChatRunHistoryCached}, which is keyed on the tenant's execution-state version
 * (every run status change orphans it) and the chat's structure token (links / agents /
 * members), so an unchanged poll costs no statement at all.
 */

import { and, desc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { agentHosts, executions, ideAgents, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TERMINAL_EXECUTION_STATUSES } from '../../domain/execution/Execution';
import { linkedTaskIdsSql } from './chatLinkedTickets';
import { resolveAgentIdentities } from './agentDisplayNames';
import { resolveChatAccess } from './chatAccess';
import { cachedChatRead } from './chatCacheVersions';
import { executionStateVersion } from '../runtime/executionStateVersion';
import { parseCloudChild } from '../runtime/cloudChildRuns';
import { parseCloudAgentRef, parseExecutor, parseOriginatingChatId, parseRunSandbox } from '../runtime/cloudDispatch';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

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

/** How many live child executions one history read will consider. Fan-out is capped. */
export const CHAT_LIVE_SUBAGENT_LIMIT = 50;

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
  /**
   * WHERE it executed: 'durable' (the one cloud runtime) | 'github_actions'. Null for a
   * run dispatched before the executor was stamped, or one delivered to an on-prem host —
   * see {@link ChatRunRecord.hostName}.
   */
  executor: string | null;
  /**
   * What served its shell and working tree: 'container' | 'actions' | 'none'. Null for a
   * run that predates the stamp. Reported because it decides what the run was CAPABLE
   * of: a run with `none` edited over the git API and could not build or test.
   */
  sandbox: string | null;
  /** The on-prem machine this run was delivered to, when it was one. */
  hostId: number | null;
  /** That machine's name — the id alone is as unreadable as a raw agent uuid was. */
  hostName: string | null;
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
  /**
   * Distinct executors across the returned runs, so a caller can state "every run here
   * was durable — none of them could build what it wrote" without walking the list.
   */
  executors: string[];
  /**
   * Live cloud sub-agents of this chat — child executions (`parent_execution_id` set)
   * whose payload `chatId` is this chat and that have not settled. Same shape as the
   * Agents roster's `ChatSubagentVM`; not a second schema.
   */
  subagents: ChatSubagentRecord[];
}

/** One live child, as the Agents list renders it (`ChatSubagentVM` on the wire). */
export interface ChatSubagentRecord {
  key: string;
  handle: string;
  name: string;
  label: string;
  owner: string;
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
  agentHostId: number | null;
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
  hostNames: ReadonlyMap<number, string> = new Map(),
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
      // `parseExecutor` rejects anything not in the known set, so a payload stamped by an
      // older build (the in-request Worker executor, now removed) reads as "unknown"
      // rather than asserting a surface that no longer exists.
      executor: parseExecutor(row.payload ?? undefined) ?? null,
      sandbox: parseRunSandbox(row.payload) ?? null,
      hostId: row.agentHostId ?? null,
      hostName: row.agentHostId != null ? hostNames.get(row.agentHostId) ?? null : null,
      produced: row.produced ?? null,
      errorMessage: firstLine(row.errorMessage),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Project a child execution onto the Agents-list shape. Pure — the query is one thing
 * to get right; this is the other (which name, and never inventing a row the payload
 * does not actually describe as a sub-agent).
 */
export function toChatSubagentRecord(row: { id: number; payload: string | null }): ChatSubagentRecord | null {
  const spec = parseCloudChild(row.payload);
  if (!spec) return null;
  const name = [spec.asAgent?.name, spec.persona?.name, spec.label].find(nonEmpty);
  if (!nonEmpty(spec.handle) || !name || !nonEmpty(spec.label) || !nonEmpty(spec.owner)) return null;
  return { key: String(row.id), handle: spec.handle, name, label: spec.label, owner: spec.owner };
}

/**
 * Keep only children whose payload `chatId` is this chat. The SQL prefilter is a LIKE;
 * this is the exact match, so `"chatId":7` never pulls in chat 70.
 */
export function liveChatSubagentsOf(
  chatId: number,
  rows: readonly { id: number; payload: string | null }[],
): ChatSubagentRecord[] {
  return rows.flatMap((row) => {
    if (parseOriginatingChatId(row.payload) !== chatId) return [];
    const rec = toChatSubagentRecord(row);
    return rec ? [rec] : [];
  });
}

async function readLiveChatSubagents(db: Db, tenantId: number, chatId: number): Promise<ChatSubagentRecord[]> {
  // Not `liveExecution()` — that helper excludes children (`parent_execution_id` set),
  // which are exactly the rows this read wants. Mode still has to be live so a
  // rehearsal fan-out never appears on the roster.
  const rows = await db
    .select({ id: executions.id, payload: executions.payload })
    .from(executions)
    .where(scopedToTenant(
      executions,
      tenantId,
      eq(executions.mode, 'live'),
      isNotNull(executions.parentExecutionId),
      notInArray(executions.status, [...TERMINAL_EXECUTION_STATUSES]),
      sql`${executions.payload} like ${`%"chatId":${chatId}%`}`,
    ))
    .orderBy(desc(executions.createdAt))
    .limit(CHAT_LIVE_SUBAGENT_LIMIT);
  return liveChatSubagentsOf(chatId, rows);
}

/**
 * Every run started against a ticket this chat links, newest first.
 *
 * Bounded statements, never N+1: the runs come back in ONE query that already carries each
 * ticket's title, the on-prem host name and the agent name (joins, not follow-up `IN`s),
 * with the chat's runnable-ticket count riding along as a scalar subquery. Live sub-agents
 * are the second statement. Only a legacy run that records its agent on the payload alone
 * (no `cloud_agent_ref`) costs a third lookup; a chat with no runs costs a count.
 */
export async function readChatRunHistory(
  db: Db,
  tenantId: number,
  chatId: number,
  limit: number = CHAT_RUN_HISTORY_LIMIT,
): Promise<ChatRunHistory> {
  const linkedIds = linkedTaskIdsSql(tenantId, chatId);
  const [rows, subagents] = await Promise.all([
    db
      .select({
        id: executions.id,
        taskId: executions.taskId,
        status: executions.status,
        submittedBy: executions.submittedBy,
        source: executions.source,
        cloudAgentRef: executions.cloudAgentRef,
        agentHostId: executions.agentHostId,
        payload: executions.payload,
        produced: executions.produced,
        errorMessage: executions.errorMessage,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
        createdAt: executions.createdAt,
        taskTitle: tasks.title,
        hostName: agentHosts.name,
        agentName: ideAgents.name,
        linkedCount: sql<number>`(select count(*)::int from ${tasks} lt where lt.tenant_id = ${tenantId} and lt.id in ${linkedIds})`,
      })
      .from(executions)
      .innerJoin(tasks, and(eq(tasks.id, executions.taskId), eq(tasks.tenantId, tenantId)))
      .leftJoin(agentHosts, and(eq(agentHosts.id, executions.agentHostId), eq(agentHosts.tenantId, tenantId)))
      .leftJoin(ideAgents, and(eq(ideAgents.id, executions.cloudAgentRef), eq(ideAgents.tenantId, tenantId)))
      .where(and(eq(executions.tenantId, tenantId), sql`${executions.taskId} in ${linkedIds}`))
      .orderBy(desc(executions.createdAt))
      .limit(clampChatRunHistoryLimit(limit)),
    readLiveChatSubagents(db, tenantId, chatId),
  ]);

  if (rows.length === 0) {
    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, sql`${tasks.id} in ${linkedIds}`));
    return { linkedRunnableTickets: Number(counted?.n ?? 0), runs: [], dispatchers: [], executors: [], subagents };
  }

  const titles = new Map(rows.map((r) => [r.taskId, r.taskTitle] as const));
  const hostNames = new Map(rows.flatMap((r) => (r.agentHostId != null && r.hostName != null ? [[r.agentHostId, r.hostName] as const] : [])));
  const names = new Map<string, string>(rows.flatMap((r) => (r.cloudAgentRef && r.agentName ? [[r.cloudAgentRef, r.agentName] as const] : [])));
  // Older rows carry the agent on the payload only; resolve those (rarely any) in one `IN`.
  const payloadOnly = rows.filter((r) => !r.cloudAgentRef).map(runAgentRefOf).filter((r): r is string => r != null);
  if (payloadOnly.length > 0) {
    for (const [ref, id] of await resolveAgentIdentities(db, tenantId, payloadOnly)) names.set(ref, id.name);
  }

  const runs = toChatRunRecords(rows, titles, names, hostNames);

  return {
    linkedRunnableTickets: Number(rows[0]!.linkedCount ?? 0),
    runs,
    dispatchers: [...new Set(runs.map((r) => r.submittedBy))],
    executors: [...new Set(runs.map((r) => r.executor ?? (r.hostId != null ? 'on-prem' : 'unknown')))],
    subagents,
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

/**
 * {@link readChatRunHistoryForCaller} for the polled route. Per (chat, user): the access
 * verdict is inside the cached value, so a hit is zero statements. A denial (`null`) is
 * never cached. Keyed on the tenant's execution-state version, which every run status
 * change bumps; `produced` / failure text landing without a status change ages out with
 * the cache TTL.
 */
export async function readChatRunHistoryCached(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  chatId: number,
  userId: string,
  limit: number = CHAT_RUN_HISTORY_LIMIT,
): Promise<ChatRunHistory | null> {
  const execVersion = env ? await executionStateVersion(env, tenantId) : '-';
  return cachedChatRead(
    env,
    'runs',
    { tenantId, chatId, userId, variant: String(clampChatRunHistoryLimit(limit)), tokens: [execVersion] },
    () => readChatRunHistoryForCaller(db, tenantId, chatId, userId, limit),
    (history) => history !== null,
  );
}
