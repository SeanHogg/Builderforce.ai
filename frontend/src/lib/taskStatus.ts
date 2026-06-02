import type { TaskStatus } from './builderforceApi';

/**
 * The fixed set of task statuses (the `task_status` Postgres enum) and their
 * human labels, in kanban column order. Shared by the task board and the
 * board-configuration lane editor so swimlanes can be bound to a real status.
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

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
};

export const isTaskStatus = (k: string): k is TaskStatus =>
  (TASK_STATUSES as string[]).includes(k);

/** "in_progress" / "code-review" → "In Progress" / "Code Review". */
export function humanizeStatus(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || s;
}

/** Display label for any status string — canonical label, else humanized key. */
export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? humanizeStatus(status);
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
