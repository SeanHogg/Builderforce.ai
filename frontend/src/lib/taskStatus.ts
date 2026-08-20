import type { TaskStatus } from './builderforceApi';

/**
 * The fixed set of task statuses (the `task_status` Postgres enum), in kanban
 * column order. Shared by the task board and the board-configuration lane editor
 * so swimlanes can be bound to a real status.
 *
 * The human LABELS deliberately do not live here — they are in the `taskStatus.*`
 * catalog namespace and are read through `useTaskStatusLabel()` /
 * `getTaskStatusLabel()` (`taskStatusLabel.ts`). They used to be a plain
 * `Record<TaskStatus, string>` of English constants, which meant the board — the
 * single largest surface in the product — rendered "Backlog"/"In Review" in every
 * locale no matter what the user picked. A label a person reads is a translated
 * string; only the KEYS are the domain vocabulary, and that is what this file owns.
 */
export const TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'ready',
  'in_progress',
  'in_review',
  'blocked',
  'done',
];

export const isTaskStatus = (k: string): k is TaskStatus =>
  (TASK_STATUSES as string[]).includes(k);

/**
 * "in_progress" / "code-review" → "In Progress" / "Code Review".
 *
 * The fallback for CUSTOM swimlane keys, which are operator-authored and have no
 * catalog entry by definition. Mechanical key-prettifying, not translation — it is
 * still better than showing a raw `some_custom_lane`.
 */
export function humanizeStatus(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || s;
}

const TASK_STATUS_BADGE_CLASS: Record<string, string> = {
  backlog: 'badge-gray',
  todo: 'badge-gray',
  ready: 'badge-blue',
  in_progress: 'badge-blue',
  in_review: 'badge-yellow',
  done: 'badge-green',
  blocked: 'badge-red',
};

/** Badge CSS class for any status string; custom statuses get a neutral badge. */
export function taskStatusBadgeClass(status: string): string {
  return TASK_STATUS_BADGE_CLASS[status] ?? 'badge-gray';
}
