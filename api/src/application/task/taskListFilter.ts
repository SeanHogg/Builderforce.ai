/**
 * The ONE ticket filter contract — what `tasks.list` and `tasks.archive_where` narrow by,
 * parsed and validated here and applied IN SQL by `TaskRepository` (`findPage`,
 * `findIndexRows`, `countMatching`). The filter TYPE lives in the domain
 * (`domain/task/ITaskRepository.ts`) beside the repository it parameterises.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────
 * A ticket-cleanup run burned 237 tool calls: `tasks.list` loaded every ticket of the
 * tenant into memory and could only narrow by project/status, so an agent hunting ~700
 * persona fan-out copies among 984 archived tickets had to page the whole board and
 * archive ids by hand. Every narrowing field below is pushed into the query instead.
 *
 * ── SCOPE IS NOT RESTATED HERE ───────────────────────────────────────────────────
 * `scope` is parsed by agent-loop's `parseTaskListScope` and its SQL form is built from
 * agent-loop's `TASK_CLOSED_STATUSES` — the same ONE rule `taskInScope` reads — so
 * "open" means the same tickets in the list, the census and the VS Code Work view.
 *
 * ── NULL IS ABSENT ───────────────────────────────────────────────────────────────
 * Strict-schema models send `null` for every optional field they do not use, so a null
 * never narrows anything. "Top-level tickets only" is the explicit `topLevelOnly: true`.
 *
 * Pure: no db, no env. A bad argument throws {@link TaskListFilterError} with a message
 * the model can act on.
 */
import { parseTaskListScope, TASK_LIST_SCOPES, type TaskListScope } from '@builderforce/agent-loop';
import type { TaskListFilter } from '../../domain/task/ITaskRepository';
import { TaskType } from '../../domain/shared/types';
import { parseSyncId } from '../../domain/sync/syncProtocol';

export type { TaskListFilter };

export const TASK_ASSIGNED_FILTERS = ['none', 'any'] as const;
export type TaskAssignedFilter = (typeof TASK_ASSIGNED_FILTERS)[number];

const TASK_TYPES: readonly string[] = Object.values(TaskType);

/** Longest title fragment a filter may carry (titles are varchar(500)). */
const TITLE_FILTER_MAX = 500;

/** ISO 8601 date or date-time (`2026-11-01`, `2026-11-01T09:30`, `…:00.000Z`, `…+02:00`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export class TaskListFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskListFilterError';
  }
}

/** The JSON-schema properties of the filter, shared by every tool that takes one. */
export const TASK_LIST_FILTER_PROPERTIES = {
  projectId: { type: 'number' },
  status: { type: 'string' },
  scope: { type: 'string', enum: [...TASK_LIST_SCOPES] },
  parentTaskId: { type: 'number', description: 'Children of this parent ticket only.' },
  topLevelOnly: { type: 'boolean', description: 'true = only tickets with no parent.' },
  titlePrefix: { type: 'string', description: 'Case-insensitive title starts-with, e.g. "[QA Engineer]".' },
  titleMatch: { type: 'string', description: 'Case-insensitive title substring.' },
  createdBefore: { type: 'string', description: 'ISO date/time.' },
  createdAfter: { type: 'string', description: 'ISO date/time.' },
  assigned: { type: 'string', enum: [...TASK_ASSIGNED_FILTERS] },
  isFanoutCopy: { type: 'boolean', description: 'true = only persona fan-out copies (the per-role child work items materialized from a ticket manifest); false = exclude them.' },
  taskType: { type: 'string', enum: [...TASK_TYPES] },
} as const;

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string') throw new TaskListFilterError(`${key} must be a string`);
  const s = v.trim();
  if (!s) return undefined;
  if (s.length > TITLE_FILTER_MAX) throw new TaskListFilterError(`${key} is capped at ${TITLE_FILTER_MAX} characters`);
  return s;
}

function optionalId(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  if (v == null || v === '') return undefined;
  const id = parseSyncId(v);
  if (id === null) throw new TaskListFilterError(`${key} must be a server id (a positive whole number)`);
  return id;
}

function optionalBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  const v = raw[key];
  if (v == null) return undefined;
  if (typeof v !== 'boolean') throw new TaskListFilterError(`${key} must be a boolean`);
  return v;
}

function optionalDate(raw: Record<string, unknown>, key: string): Date | undefined {
  const v = raw[key];
  if (v == null || v === '') return undefined;
  const d = typeof v === 'string' && ISO_DATE.test(v.trim()) ? new Date(v.trim()) : null;
  if (!d || Number.isNaN(d.getTime())) throw new TaskListFilterError(`${key} must be an ISO date/time string (e.g. 2026-11-01 or 2026-11-01T09:30:00Z)`);
  return d;
}

/**
 * Parse an untrusted filter object. `defaultScope` applies when `scope` is absent and no
 * `status` is given; an explicit status is its own scope (`all`), exactly as `tasks.list`
 * has always read it — defaulting to open would empty a `status: "done"` query.
 */
export function parseTaskListFilter(raw: unknown, defaultScope: TaskListScope = 'open'): TaskListFilter {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new TaskListFilterError('filter must be an object');
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = optionalString(r, 'status');
  const scope = parseTaskListScope(r.scope, status ? 'all' : defaultScope);
  const filter: TaskListFilter = { scope };

  const projectId = optionalId(r, 'projectId');
  if (projectId !== undefined) filter.projectId = projectId;
  if (status) filter.status = status;

  const parent = optionalId(r, 'parentTaskId');
  if (parent !== undefined) filter.parentTaskId = parent;
  if (optionalBoolean(r, 'topLevelOnly') === true) {
    if (parent !== undefined) throw new TaskListFilterError('pass parentTaskId OR topLevelOnly, not both');
    filter.topLevelOnly = true;
  }

  const titlePrefix = optionalString(r, 'titlePrefix');
  if (titlePrefix) filter.titlePrefix = titlePrefix;
  const titleMatch = optionalString(r, 'titleMatch');
  if (titleMatch) filter.titleMatch = titleMatch;

  const createdBefore = optionalDate(r, 'createdBefore');
  if (createdBefore) filter.createdBefore = createdBefore;
  const createdAfter = optionalDate(r, 'createdAfter');
  if (createdAfter) filter.createdAfter = createdAfter;
  if (createdBefore && createdAfter && createdAfter.getTime() >= createdBefore.getTime()) {
    throw new TaskListFilterError('createdAfter must be earlier than createdBefore');
  }

  if (r.assigned != null && r.assigned !== '') {
    if (!(TASK_ASSIGNED_FILTERS as readonly unknown[]).includes(r.assigned)) {
      throw new TaskListFilterError(`assigned must be one of: ${TASK_ASSIGNED_FILTERS.join(', ')}`);
    }
    filter.assigned = r.assigned as TaskAssignedFilter;
  }

  const isFanoutCopy = optionalBoolean(r, 'isFanoutCopy');
  if (isFanoutCopy !== undefined) filter.isFanoutCopy = isFanoutCopy;

  const taskType = optionalString(r, 'taskType');
  if (taskType) {
    if (!TASK_TYPES.includes(taskType)) throw new TaskListFilterError(`taskType must be one of: ${TASK_TYPES.join(', ')}`);
    filter.taskType = taskType;
  }
  return filter;
}

/** The fields that genuinely SELECT a subset — a bulk write must name at least one. */
export const SELECTIVE_FILTER_FIELDS = [
  'projectId', 'status', 'parentTaskId', 'titlePrefix', 'titleMatch', 'isFanoutCopy (true)', 'taskType', 'createdAfter',
] as const;

/**
 * True when the filter names at least one SELECTIVE field. `scope`, `assigned`,
 * `topLevelOnly`, `createdBefore` and `isFanoutCopy:false` each still match most of a
 * workspace, so on their own they can never authorise a bulk write.
 */
export function hasSelectiveField(filter: TaskListFilter): boolean {
  return filter.projectId !== undefined
    || filter.status !== undefined
    || filter.parentTaskId !== undefined
    || filter.titlePrefix !== undefined
    || filter.titleMatch !== undefined
    || filter.isFanoutCopy === true
    || filter.taskType !== undefined
    || filter.createdAfter !== undefined;
}

/** True when the filter reads a field a SECURITY mask hides (title, assignee) — a caller
 *  without clearance must not be able to probe hidden tickets through match counts. */
export function filterReadsMaskedFields(filter: TaskListFilter): boolean {
  return filter.titlePrefix !== undefined || filter.titleMatch !== undefined || filter.assigned !== undefined;
}
