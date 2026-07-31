/**
 * Done-class lane keys.
 *
 * `task.status` is a FREE-FORM board lane key (see Task.status): the fixed
 * {@link TaskStatus} enum only names the lanes the platform itself mints, while
 * boards imported from Jira/Linear/ADO or renamed by a user carry their own
 * terminal lane keys ('completed', 'closed', 'resolved', …).
 *
 * Anything that means "this work is finished" must therefore be matched against
 * this set rather than against `TaskStatus.DONE` alone — a query that only
 * excludes 'done' silently returns finished work from every board that spells
 * its terminal lane differently.
 *
 * Pure domain module: no DB or Drizzle imports, so it is usable from the domain,
 * application and infrastructure layers alike.
 */

/** Lane keys that mean the work is finished, whatever the board calls them. */
export const DONE_CLASS_STATUSES: readonly string[] = [
  'done',
  'completed',
  'complete',
  'closed',
  'resolved',
  'shipped',
] as const;

const DONE_CLASS = new Set<string>(DONE_CLASS_STATUSES);

/**
 * True when a lane key is done-class.
 *
 * Comparison is case-insensitive and trims surrounding whitespace, because
 * imported boards frequently carry lane keys like `'Done'` or `'Closed '`.
 */
export function isDoneStatus(status: string | null | undefined): boolean {
  if (status == null) return false;
  return DONE_CLASS.has(status.trim().toLowerCase());
}

/** Inverse of {@link isDoneStatus} — convenience for `.filter(isNotDoneStatus)`. */
export function isNotDoneStatus(status: string | null | undefined): boolean {
  return !isDoneStatus(status);
}
