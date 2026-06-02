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
