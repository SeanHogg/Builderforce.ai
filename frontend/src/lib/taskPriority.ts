/**
 * Task-PRIORITY badge helper — the third sibling of {@link ./taskStatus} and
 * {@link ./taskType}, completing the set of a ticket's badge dimensions.
 *
 * The low/medium/high/urgent → badge-class map had been copy-pasted into the
 * board, the manager view and the ceremony card, so a tone change meant editing
 * three files and hoping none was missed. One map, one order, every surface.
 */
import type { TaskPriority } from './builderforceApi';

/** Ascending order (backlog-first) — form defaults and pickers. */
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

/** Descending order (most urgent first) — triage lists and rollups. */
export const TASK_PRIORITIES_DESC: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

const TASK_PRIORITY_BADGE_CLASS: Record<string, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
};

/** Badge CSS class for a priority; falls back to the neutral tone for junk values. */
export function taskPriorityBadgeClass(priority: string): string {
  return TASK_PRIORITY_BADGE_CLASS[priority] ?? 'badge-gray';
}
