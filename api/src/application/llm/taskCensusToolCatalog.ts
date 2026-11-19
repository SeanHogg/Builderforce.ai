/**
 * The TICKET CENSUS tool — "how many tickets are in each lane?", spread into
 * `builtinMcpService`'s `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Asked for the open-ticket status breakdown of a 1,253-ticket project (VS Code chat
 * #273), two different models called `tasks.list { limit: 1 }` once per GUESSED status
 * — backlog, todo, ready, review, needs_review, in_progress, in_review, blocked — 13
 * calls, several for statuses the board does not have. Paging `tasks.list` instead
 * costs ~18 index pages for the same project. A count is a server-side question; this
 * row answers it in one call with the statuses that ACTUALLY occur, never a guessed set.
 *
 * ── SAME SCOPE, SAME GATE ────────────────────────────────────────────────────────
 * `scope` is `tasks.list`'s scope (the agent-loop helpers, not a copy), so "open" means
 * the same tickets in both tools and a census total equals the `total` of the matching
 * `tasks.list` call. Rows pass the shared SECURITY mask first; a masked ticket keeps
 * its lane and type (the board shows those too) but its assignee is withheld, so it
 * counts under `(restricted)` when grouping by assignee.
 *
 * ── NOT CACHED ───────────────────────────────────────────────────────────────────
 * `tasks.list`'s data path (`TaskService.listTasks`) is not behind `getOrSetCached`, and
 * this deliberately reads the same path: the census is polled while agents move tickets
 * turn by turn, so a cached count would disagree with the `tasks.list` page the model
 * reads next — the exact contradiction a census exists to remove.
 */
import { parseTaskListScope, scopeNeedsArchived, taskInScope, TASK_LIST_SCOPES } from '@builderforce/agent-loop';
import type { BuiltinCtx, BuiltinTool } from './builtinToolContext';
import { maskSecurityTasks } from './builtinTaskVisibility';
import { idArg } from './builtinToolIds';

type Json = Record<string, unknown>;

const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

export const TASK_CENSUS_GROUP_BY = ['status', 'type', 'parent', 'assignee'] as const;
export type TaskCensusGroupBy = (typeof TASK_CENSUS_GROUP_BY)[number];

/** Most `groups` one census returns; the rest are summed into `otherGroups`. A parent
 *  or assignee breakdown on a big board can have hundreds of keys. */
export const MAX_CENSUS_GROUPS = 100;

const NONE = '(none)';
const UNASSIGNED = '(unassigned)';
const RESTRICTED = '(restricted)';

function groupKey(row: Json, by: TaskCensusGroupBy): string {
  switch (by) {
    case 'status': return typeof row.status === 'string' && row.status ? row.status : NONE;
    case 'type': return typeof row.taskType === 'string' && row.taskType ? row.taskType : NONE;
    case 'parent': return row.parentTaskId != null ? String(row.parentTaskId) : NONE;
    case 'assignee':
      if (row.restricted === true) return RESTRICTED;
      if (row.assignedUserId != null && row.assignedUserId !== '') return `user:${String(row.assignedUserId)}`;
      if (row.assignedAgentRef != null && row.assignedAgentRef !== '') return `agent:${String(row.assignedAgentRef)}`;
      return UNASSIGNED;
  }
}

/** Count keys, largest first (ties by key). Status/type keys are never integer-like, so
 *  `byStatus`/`byType` keep this order as objects; `groups` is an array (see TaskCensus). */
function countBy(rows: readonly Json[], by: TaskCensusGroupBy): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = groupKey(row, by);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export interface TaskCensus {
  scope: string;
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  groupBy?: TaskCensusGroupBy;
  /** Largest first. An ARRAY, not an object: integer-like keys (parent ids) would be
   *  re-sorted numerically by JSON object key order and lose that ranking. */
  groups?: Array<{ key: string; count: number }>;
  /** Tickets in groups beyond {@link MAX_CENSUS_GROUPS}, when the breakdown was cut. */
  otherGroups?: number;
}

/** The census over rows already in scope and masked. Pure. */
export function buildTaskCensus(rows: readonly Json[], scope: string, groupBy?: TaskCensusGroupBy): TaskCensus {
  const census: TaskCensus = {
    scope,
    total: rows.length,
    byStatus: Object.fromEntries(countBy(rows, 'status')),
    byType: Object.fromEntries(countBy(rows, 'type')),
  };
  if (groupBy) {
    const all = countBy(rows, groupBy);
    const kept = all.slice(0, MAX_CENSUS_GROUPS);
    census.groupBy = groupBy;
    census.groups = kept.map(([key, count]) => ({ key, count }));
    if (all.length > kept.length) census.otherGroups = all.slice(kept.length).reduce((n, [, c]) => n + c, 0);
  }
  return census;
}

export const TASK_CENSUS_TOOLS: BuiltinTool[] = [
  {
    tool: 'tasks.census',
    mutates: false,
    description:
      'COUNT tickets in ONE call — use this, never tasks.list, for "how many tickets / what is the status breakdown". '
      + 'Returns { scope, total, byStatus, byType } with only the statuses and types that actually occur (do not guess status names), '
      + 'plus { groupBy, groups: [{ key, count }] largest first, otherGroups? } when groupBy is status | type | parent | assignee. '
      + 'scope is the same as tasks.list: "open" (default — work still owed), "closed" (done, cancelled or archived) or "all". '
      + 'Omit projectId to count the whole workspace. Counts only — list the tickets themselves with tasks.list.',
    parameters: obj({
      projectId: N,
      scope: { type: 'string', enum: [...TASK_LIST_SCOPES] },
      groupBy: { type: 'string', enum: [...TASK_CENSUS_GROUP_BY] },
    }),
    run: async (ctx: BuiltinCtx, a: Json) => {
      const scope = parseTaskListScope(a.scope, 'open');
      const groupBy = (TASK_CENSUS_GROUP_BY as readonly string[]).includes(String(a.groupBy))
        ? (a.groupBy as TaskCensusGroupBy)
        : undefined;
      if (a.groupBy != null && !groupBy) {
        throw new Error(`groupBy must be one of ${TASK_CENSUS_GROUP_BY.join(', ')}`);
      }
      const projectId = a.projectId != null ? idArg(a.projectId, 'projectId') : undefined;
      const all = await ctx.tasks.listTasks(ctx.tenantId, projectId, scopeNeedsArchived(scope));
      const inScope = all
        .map((t) => t.toPlain() as unknown as Json)
        .filter((r) => taskInScope({ status: r.status as string | undefined, archived: r.archived as boolean | undefined }, scope));
      const rows = await maskSecurityTasks(ctx, inScope);
      return { ...(projectId != null ? { projectId } : {}), ...buildTaskCensus(rows, scope, groupBy) };
    },
  },
];
