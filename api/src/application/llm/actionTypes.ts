/**
 * Learned Model Routing (PRD 13) — the action-type taxonomy, the ONE source of
 * truth shared by the classifier, the router, the scorer, the analytics endpoint,
 * and any UI label (DRY). A closed enum (v1) keeps the analytics dense enough to
 * be meaningful per bucket and keeps the classifier cheap/reliable; free-form
 * slugs would fragment the data. Extensible later (add a bucket, re-classify
 * low-confidence tasks) without a schema change — the column is a plain varchar.
 */

export const ACTION_TYPES = [
  'sql',
  'frontend_ui',
  'backend_api',
  'refactor',
  'bugfix',
  'tests',
  'docs',
  'devops_ci',
  'data_migration',
  'other',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** The fallback bucket — used whenever a label is absent, unknown, or low-trust. */
export const DEFAULT_ACTION_TYPE: ActionType = 'other';

const ACTION_TYPE_SET: ReadonlySet<string> = new Set(ACTION_TYPES);

/** Coerce/guard any value to a valid {@link ActionType}, defaulting to 'other'.
 *  Used everywhere a label crosses a boundary (DB column, classifier output, query
 *  param) so an unexpected value can never reach the analytics/routing math. */
export function normalizeActionType(s: unknown): ActionType {
  return typeof s === 'string' && ACTION_TYPE_SET.has(s) ? (s as ActionType) : DEFAULT_ACTION_TYPE;
}

/**
 * Kill switch for the whole Learned Model Routing feature (classifier + learned
 * router). DEFAULT ON — set `LEARNED_ROUTING_ENABLED=0` (or 'false'/'off') to
 * short-circuit classification and learned routing back to the existing static
 * behaviour WITHOUT a code-path deploy. Single source of truth so the classifier
 * and the router gate identically. Mirrors the `cloudAutofixOnBuildFailure` flag.
 */
export function learnedRoutingEnabled(env: unknown): boolean {
  const v = String((env as Record<string, unknown> | null)?.LEARNED_ROUTING_ENABLED ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** Human label for an action type — used by the analytics panel. */
export function actionTypeLabel(t: ActionType): string {
  switch (t) {
    case 'sql': return 'SQL';
    case 'frontend_ui': return 'Frontend / UI';
    case 'backend_api': return 'Backend / API';
    case 'refactor': return 'Refactor';
    case 'bugfix': return 'Bug fix';
    case 'tests': return 'Tests';
    case 'docs': return 'Docs';
    case 'devops_ci': return 'DevOps / CI';
    case 'data_migration': return 'Data migration';
    case 'other': return 'Other';
  }
}
