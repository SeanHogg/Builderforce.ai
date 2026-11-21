/**
 * The ticket LIST + BULK ARCHIVE tools — `tasks.list`, `tasks.archive_many`,
 * `tasks.archive_where` — spread into `builtinMcpService`'s `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A ticket-cleanup run burned 237 tool calls. `tasks.list` loaded EVERY ticket of the
 * tenant into memory and could only narrow by project/status, and `tasks.archive_many`
 * cost three queries per id and fired none of the cache invalidation the HTTP route
 * does, so the board kept showing 700 archived fan-out copies until the KV TTLs ran out.
 *
 *   • `tasks.list` filters, orders and pages IN SQL through the ONE filter contract
 *     (`application/task/taskListFilter.ts` → `TaskRepository.findPage` / `findIndexRows`).
 *   • `tasks.archive_many` and `tasks.archive_where` write through the ONE bulk archive
 *     path, `TaskService.archiveMany` (one `UPDATE … WHERE id IN (…)`).
 *   • `tasks.archive_where` archives by filter — dry run by default, demands a SELECTIVE
 *     filter, and refuses a write that would hit the whole workspace.
 *   • Both writes end in `afterTaskBulkWrite`, the same invalidation the route runs, so
 *     `callBuiltinTool` skips its generic `tasks.*` hook for them
 *     ({@link TASK_TOOLS_WITH_OWN_INVALIDATION}).
 *
 * ── SECURITY TICKETS: SAME GATE, AND NO ORACLE ───────────────────────────────────
 * A list surfaces a masked row (`maskSecurityTasks`). But a filter on a field the mask
 * hides (title, assignee) would reveal a hidden ticket through `total`, so for a caller
 * without clearance (`hasSecurityClearance` — the mask's own rule) those filters and
 * every bulk write exclude SECURITY tickets IN SQL. archive_many reports such ids in
 * `failed`: "masked for you" is exactly "you may not act on it".
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { projects, pullRequests, taskFileChanges, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import type { TaskListFilter, TaskQueryState } from '../../domain/task/ITaskRepository';
import { NotFoundError } from '../../domain/shared/errors';
import { TaskType } from '../../domain/shared/types';
import { buildTaskProgressBreakdown } from '../task/taskProgressBreakdown';
import {
  filterReadsMaskedFields, hasSelectiveField, parseTaskListFilter, SELECTIVE_FILTER_FIELDS, TASK_LIST_FILTER_PROPERTIES,
} from '../task/taskListFilter';
import { afterTaskBulkWrite } from '../task/afterTaskBulkWrite';
import type { BuiltinCtx, BuiltinTool } from './builtinToolContext';
import { hasSecurityClearance, maskSecurityTasks } from './builtinTaskVisibility';
import { idArg } from './builtinToolIds';
import { clampCount, clampLimit, snippet } from './listProjection';
import { clampIndexLimit, projectTaskIndexPage, taskIndexLines, TASK_INDEX_FORMAT } from './taskIndexProjection';

type Json = Record<string, unknown>;

const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

/** Most ids one `tasks.archive_many` call takes. */
export const ARCHIVE_MANY_MAX_IDS = 200;
/** Most tickets one `tasks.archive_where` call touches, and its default. */
export const ARCHIVE_WHERE_MAX_LIMIT = 2000;
export const ARCHIVE_WHERE_DEFAULT_LIMIT = 500;
/** Index lines a dry run shows. */
export const ARCHIVE_WHERE_SAMPLE = 20;

/** The bulk tools run `afterTaskBulkWrite` themselves; the generic `tasks.*` hook skips them. */
export const TASK_TOOLS_WITH_OWN_INVALIDATION: ReadonlySet<string> = new Set(['tasks.archive_many', 'tasks.archive_where']);

/** The filtered READS (the bulk write goes through `ctx.tasks.archiveMany`). */
const taskRepo = (ctx: BuiltinCtx): TaskRepository => new TaskRepository(ctx.db);

/** A page offset: a whole number ≥ 0 (anything else is 0) — it reaches SQL. */
const clampOffset = (v: unknown): number => {
  const n = v != null ? Number(v) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/** Hide SECURITY tickets in SQL for a caller without clearance. */
async function securityState(ctx: BuiltinCtx, needed: boolean): Promise<TaskQueryState> {
  return needed && !(await hasSecurityClearance(ctx)) ? { excludeTaskTypes: [TaskType.SECURITY] } : {};
}

/** Post-write invalidation off the result when the invocation can carry it, else inline. */
async function settle(ctx: BuiltinCtx, work: Promise<void>): Promise<void> {
  if (ctx.executionCtx?.waitUntil) ctx.executionCtx.waitUntil(work);
  else await work;
}

/**
 * An empty page for a named project: tell "no such project in this workspace" (missing
 * OR another tenant's — one answer, no existence oracle) from "no matching tickets".
 */
async function assertProjectInTenant(ctx: BuiltinCtx, filter: TaskListFilter, total: number): Promise<void> {
  if (filter.projectId === undefined || total > 0) return;
  const [found] = await ctx.db.select({ id: projects.id }).from(projects)
    .where(scopedToTenant(projects, ctx.tenantId, eq(projects.id, filter.projectId))).limit(1);
  if (!found) throw new NotFoundError('Project', filter.projectId);
}

/**
 * Project a full task row to the fields an orchestrator actually needs to plan
 * and route work. Drops the heavy/rarely-needed columns (full description,
 * git branch/PR, review + business-value metadata, timestamps) — fetch those
 * per-task with `tasks.get`.
 */
const TASK_LIST_FIELDS = [
  'id', 'projectId', 'key', 'title', 'status', 'priority', 'taskType',
  'parentTaskId', 'assignedUserId', 'assignedAgentRef', 'assignedAgentHostId',
  'storyPoints', 'dueDate', 'archived',
  // Present + true on a SECURITY ticket masked for a viewer without clearance.
  'restricted',
] as const;
function compactTask(plain: Json): Json {
  const out: Json = {};
  for (const f of TASK_LIST_FIELDS) if (plain[f] !== undefined) out[f] = plain[f];
  const s = snippet(plain.description);
  if (s) out.descriptionSnippet = s;
  return out;
}

/** Bulk-load the compact progress contract without turning tasks.list into N+1 queries. */
async function loadTaskProgress(ctx: BuiltinCtx, rows: Json[]): Promise<Map<number, ReturnType<typeof buildTaskProgressBreakdown>>> {
  const ids = rows.map((row) => Number(row.id)).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const [children, prs, codeRows] = await Promise.all([
    ctx.db.select({ parentTaskId: tasks.parentTaskId, status: tasks.status })
      .from(tasks).where(scopedToTenant(tasks, ctx.tenantId, inArray(tasks.parentTaskId, ids))),
    ctx.db.select({ taskId: pullRequests.taskId, status: pullRequests.status, buildStatus: pullRequests.buildStatus })
      .from(pullRequests)
      .where(and(eq(pullRequests.tenantId, ctx.tenantId), inArray(pullRequests.taskId, ids)))
      .orderBy(desc(pullRequests.updatedAt)),
    ctx.db.select({ taskId: taskFileChanges.taskId })
      .from(taskFileChanges)
      .where(and(
        eq(taskFileChanges.tenantId, ctx.tenantId),
        inArray(taskFileChanges.taskId, ids),
        sql`not (${taskFileChanges.path} ~* ${'(^|/)(prd\\.md|readme\\.md|roadmap\\.md|done\\.md)$|(^|/)(specs|docs)(/|$)|\\.mdx?$'})`,
      )),
  ]);
  const childStatuses = new Map<number, string[]>();
  for (const child of children) {
    if (child.parentTaskId == null) continue;
    const statuses = childStatuses.get(child.parentTaskId) ?? [];
    statuses.push(child.status);
    childStatuses.set(child.parentTaskId, statuses);
  }
  const latestPr = new Map<number, { status: string; buildStatus: string | null }>();
  for (const pr of prs) if (pr.taskId != null && !latestPr.has(pr.taskId)) latestPr.set(pr.taskId, pr);
  const codeTaskIds = new Set(codeRows.map((row) => row.taskId));
  return new Map(rows.map((row) => {
    const id = Number(row.id);
    const pr = latestPr.get(id);
    return [id, buildTaskProgressBreakdown({
      status: typeof row.status === 'string' ? row.status : null,
      childStatuses: childStatuses.get(id),
      codeDelivered: codeTaskIds.has(id),
      prStatus: pr?.status,
      buildStatus: pr?.buildStatus,
    })];
  }));
}

const FILTER_SUMMARY = 'projectId, status, scope, parentTaskId, topLevelOnly, titlePrefix / titleMatch (case-insensitive), createdBefore / createdAfter (ISO), assigned ("none"|"any"), isFanoutCopy (persona fan-out children), taskType';

export const TASK_BULK_TOOLS: BuiltinTool[] = [
  {
    tool: 'tasks.list', mutates: false,
    description: 'List tasks as a COMPACT projection (id/key/title/status/priority/type/parent/assignee/points/dueDate/archived + a short description snippet + progress). scope picks which tickets: "open" (default — work still owed), "closed" (done, cancelled or archived — a cancelled ticket counts as done and reads 100%), or "all". Every filter runs in the database: ' + FILTER_SUMMARY + ' — narrow with them instead of paging the whole board. Capped by limit (default 50, max 200). Tickets are ordered by id; PAGE with `offset` (the result carries `nextOffset` while truncated — repeat until it is absent). Pass fields:"slim" for a bulk read (no progress breakdown, 300-char description snippet), or fields:"index" to survey many tickets at once (one `id|status|type|parent|title` line each in a `lines` string and nothing else; up to 300 per page). The result is { tasks, total, returned, offset, truncated, nextOffset?, scope } (index mode returns { format, total, returned, offset, truncated, nextOffset?, scope, lines }). For COUNTS call tasks.census once instead of listing or guessing statuses. Use tasks.get for one task\'s full detail; to archive many tickets at once use tasks.archive_where (by filter) or tasks.archive_many (by ids); tasks.delete is permanent.',
    parameters: obj({ ...TASK_LIST_FILTER_PROPERTIES, limit: N, offset: N, fields: { type: 'string', enum: ['compact', 'slim', 'index'] } }),
    run: async (ctx, a) => {
      // An explicit status ("done") is its own scope — defaulting to open would empty it.
      const filter = parseTaskListFilter(a, 'open');
      const offset = clampOffset(a.offset);
      // A title/assignee filter must not count hidden SECURITY tickets (no oracle).
      const state = await securityState(ctx, filterReadsMaskedFields(filter));
      const repo = taskRepo(ctx);
      // SECURITY tickets are otherwise included but MASKED for a caller without
      // clearance (surfaced-not-hidden; governed by security_ticket_access). Masking
      // keeps the row, so the SQL page and its offsets stay exact.
      if (a.fields === 'index') {
        // One light line per ticket, paged to the tool-output policy's index budget.
        const { rows, total } = await repo.findIndexRows(ctx.tenantId, filter, { limit: clampIndexLimit(a.limit), offset }, state);
        await assertProjectInTenant(ctx, filter, total);
        return projectTaskIndexPage(await maskSecurityTasks(ctx, rows), offset, total, filter.scope);
      }
      const { tasks: found, total } = await repo.findPage(ctx.tenantId, filter, { limit: clampLimit(a.limit), offset }, state);
      await assertProjectInTenant(ctx, filter, total);
      const page = await maskSecurityTasks(ctx, found.map((t) => t.toPlain() as unknown as Json));
      const slim = a.fields === 'slim';
      // `slim` drops the progress breakdown (3 extra queries) and keeps a 300-char
      // snippet — built for bulk-reading every open ticket (e.g. roadmap alignment).
      const progress = slim ? new Map<number, unknown>() : await loadTaskProgress(ctx, page.filter((row) => row.restricted !== true));
      const projected = page.map((row) => ({
        ...compactTask(row),
        ...(slim && snippet(row.description, 300) ? { descriptionSnippet: snippet(row.description, 300) } : {}),
        ...(slim || row.restricted === true ? {} : { progress: progress.get(Number(row.id)) }),
      }));
      const end = offset + projected.length;
      const truncated = total > end;
      return { tasks: projected, total, returned: projected.length, offset, truncated, ...(truncated ? { nextOffset: end } : {}), scope: filter.scope };
    },
  },
  {
    tool: 'tasks.archive_many', mutates: true,
    description: `Archive (or restore with archived:false) MANY tasks in one call — up to ${ARCHIVE_MANY_MAX_IDS} ids, written in ONE statement. Archiving is recoverable and is the way to clear backlog noise (fan-out copies, duplicates, stale records). When the tickets share a trait (a title prefix, a parent, fan-out copies) use tasks.archive_where instead of collecting ids. Ids outside this workspace, unknown, or security tickets you are not cleared for are reported in \`failed\` and do not abort the rest. Returns { archived|restored:[ids], failed:[{id,error}], count }.`,
    parameters: obj({ ids: { type: 'array', items: N }, archived: B }, ['ids']),
    run: async (ctx, a) => {
      if (!Array.isArray(a.ids) || a.ids.length === 0) throw new Error('ids must be a non-empty array');
      if (a.ids.length > ARCHIVE_MANY_MAX_IDS) throw new Error(`ids is capped at ${ARCHIVE_MANY_MAX_IDS} per call`);
      const flag = typeof a.archived === 'boolean' ? a.archived : true;
      const parsed = (a.ids as unknown[]).map((raw) => {
        try {
          return { raw, id: idArg(raw, 'id') };
        } catch (e) {
          return { raw, error: e instanceof Error ? e.message : String(e) };
        }
      });
      const ids = [...new Set(parsed.flatMap((p) => (p.id !== undefined ? [p.id] : [])))];
      // Which ids are this tenant's, and which of those the caller may not act on: a
      // SECURITY ticket masked for this caller is reported, never written.
      const found = await maskSecurityTasks(ctx, await taskRepo(ctx).findTypesByIds(ctx.tenantId, ids));
      const restricted = new Set(found.filter((r) => (r as { restricted?: unknown }).restricted === true).map((r) => r.id));
      const writable = found.filter((r) => !restricted.has(r.id)).map((r) => r.id);
      const updated = writable.length ? await ctx.tasks.archiveMany(ctx.tenantId, writable, flag) : [];
      const hit = new Set(updated.map((r) => r.id));
      const done: number[] = [];
      const failed: Array<{ id: unknown; error: string }> = [];
      for (const p of parsed) {
        if (p.id !== undefined && hit.has(p.id)) done.push(p.id);
        else failed.push({ id: p.raw, error: p.error ?? (p.id !== undefined && restricted.has(p.id) ? 'restricted: a security ticket you are not cleared for' : 'Task not found') });
      }
      await settle(ctx, afterTaskBulkWrite(ctx.env, ctx.tenantId, updated.map((r) => r.projectId)));
      return { [flag ? 'archived' : 'restored']: done, failed, count: done.length };
    },
  },
  {
    tool: 'tasks.archive_where', mutates: true,
    description: `Archive (or restore with archived:false) every ticket matching a FILTER, in one statement — the way to clear fan-out copies, a duplicate batch, or stale tickets without listing ids. filter takes ${FILTER_SUMMARY}; it must name at least one SELECTIVE field (${SELECTIVE_FILTER_FIELDS.join(', ')}), and a write that would hit every ticket in the workspace is refused. dryRun defaults to TRUE: it returns { dryRun:true, count, matched, sample } (sample = up to ${ARCHIVE_WHERE_SAMPLE} \`id|status|type|parent|title\` lines) and changes nothing — check the sample, then repeat with dryRun:false, which returns { archived|restored: count, ids }. Only tickets whose state would change are touched; at most limit per call (default ${ARCHIVE_WHERE_DEFAULT_LIMIT}, max ${ARCHIVE_WHERE_MAX_LIMIT}; \`remaining\` reports what is left — call again). Security tickets you are not cleared for are never matched.`,
    parameters: obj({
      filter: obj({ ...TASK_LIST_FILTER_PROPERTIES }),
      archived: B,
      dryRun: B,
      limit: N,
    }, ['filter']),
    run: async (ctx, a) => {
      if (a.filter == null || typeof a.filter !== 'object' || Array.isArray(a.filter)) throw new Error('filter is required and must be an object');
      const filter = parseTaskListFilter(a.filter, 'all');
      const flag = typeof a.archived === 'boolean' ? a.archived : true;
      const verb = flag ? 'archive' : 'restore';
      if (!flag && filter.scope === 'open') {
        throw new Error('scope "open" excludes archived tickets, so there is nothing to restore — use scope "closed" or "all"');
      }
      if (!hasSelectiveField(filter)) {
        throw new Error(`filter must name at least one selective field (${SELECTIVE_FILTER_FIELDS.join(', ')}) — refusing to ${verb} a whole workspace`);
      }
      const dryRun = a.dryRun !== false;
      const limit = clampCount(a.limit, ARCHIVE_WHERE_DEFAULT_LIMIT, ARCHIVE_WHERE_MAX_LIMIT);

      const repo = taskRepo(ctx);
      // Only the rows the write would CHANGE (archiving skips already-archived tickets),
      // and never a SECURITY ticket this caller may not see — excluded IN SQL, so the
      // counts reveal nothing about it and `remaining` converges to 0.
      const state: TaskQueryState = { archived: !flag, ...(await securityState(ctx, true)) };
      const { rows, total } = await repo.findIndexRows(ctx.tenantId, filter, { limit }, state);
      const extras = total > rows.length ? { remaining: total - rows.length } : {};
      if (dryRun) {
        return {
          dryRun: true,
          count: rows.length,
          matched: total,
          format: TASK_INDEX_FORMAT,
          sample: taskIndexLines(rows.slice(0, ARCHIVE_WHERE_SAMPLE)),
          ...extras,
        };
      }
      // Belt to the selective-field braces: a filter that still matches EVERY ticket this
      // write could touch is a whole-workspace write, whatever fields it names.
      if (total > 0 && total === await repo.countMatching(ctx.tenantId, { scope: 'all' }, state)) {
        throw new Error(`the filter matches every ${flag ? 'non-archived' : 'archived'} ticket in this workspace (${total}) — refusing to ${verb} them all; narrow the filter`);
      }
      const updated = rows.length ? await ctx.tasks.archiveMany(ctx.tenantId, rows.map((r) => r.id), flag) : [];
      await settle(ctx, afterTaskBulkWrite(ctx.env, ctx.tenantId, updated.map((r) => r.projectId)));
      return { [flag ? 'archived' : 'restored']: updated.length, ids: updated.map((r) => r.id), ...extras };
    },
  },
];
