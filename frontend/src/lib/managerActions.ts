import type { ManagerActionType } from '@/lib/builderforceApi';

/**
 * The presentation vocabulary for a manager DECISION — the icon it shows and
 * whether the surface knows its name at all.
 *
 * `manager_actions.action_type` is a free-form varchar at the database, so a decision
 * class shipped by a later manager pass reaches the browser before this file (or the
 * i18n catalogs) learn about it. Two surfaces now render those rows — the Activity
 * feed and today's digest — and both need the SAME answer to "do I have a label for
 * this?", so the map and the guard live here rather than being re-inlined per surface.
 * {@link managerActionIcon} degrades to a neutral bullet and {@link isManagerActionType}
 * lets a caller fall back to the raw type instead of rendering a missing-key path.
 */

export const MANAGER_ACTION_ICON: Record<ManagerActionType, string> = {
  prioritize: '📊',
  schedule: '📅',
  assign: '👤',
  score_value: '💎',
  dispatch: '🚀',
  sync_pr: '🔄',
  merge_pr: '🔀',
  flag: '🚩',
  coordinate: '🧭',
  merge_blocked: '✋',
  triage: '🚧',
  escalate: '🔔',
  systemic: '🧩',
};

/** True when this type has a known icon AND a `manager.action.*` translation. */
export function isManagerActionType(value: string): value is ManagerActionType {
  return Object.prototype.hasOwnProperty.call(MANAGER_ACTION_ICON, value);
}

/** The decision's icon, or a neutral bullet for a class this build predates. */
export function managerActionIcon(value: string): string {
  return isManagerActionType(value) ? MANAGER_ACTION_ICON[value] : '•';
}
