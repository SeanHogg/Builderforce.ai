/**
 * Task-TYPE badge helper — the sibling of {@link ./taskStatus} (which handles
 * the status dimension). A task's `taskType` is an orthogonal dimension: a plain
 * task, an Epic (planning container), or a GAP (minted by the Validator when a
 * Done item is reviewed and found incomplete). GAP reads as "attention needed"
 * so it gets a distinct amber badge; plain tasks and Epics carry their meaning
 * from context and return no badge class.
 */

export type TaskType = 'task' | 'epic' | 'gap';

const TASK_TYPE_BADGE_CLASS: Record<string, string | null> = {
  task: null,
  epic: null,
  gap: 'badge-amber',
};

/** Badge CSS class for a task type, or `null` to render no type badge. */
export function taskTypeBadgeClass(type: string): string | null {
  return TASK_TYPE_BADGE_CLASS[type] ?? null;
}

const TASK_TYPE_LABEL_KEY: Record<string, string> = {
  task: 'typeTask',
  epic: 'typeEpic',
  gap: 'typeGap',
};

/** i18n key (under the `common` namespace) for a task type's short label. */
export function taskTypeLabelKey(type: string): string {
  return TASK_TYPE_LABEL_KEY[type] ?? 'typeTask';
}
