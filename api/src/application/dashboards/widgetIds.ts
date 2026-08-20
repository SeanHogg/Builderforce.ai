/**
 * The registry widget ids the SERVER is allowed to name.
 *
 * The widget registry itself lives in the frontend (`lib/widgets/allWidgets.ts`)
 * because a widget is a React component; the server cannot import it. But the
 * composed answer and the dashboard presets both have to say WHICH cards to draw,
 * so the server needs a list of ids — and a plain string list on one side of a
 * network boundary is exactly the kind of thing that rots: a widget gets renamed
 * or deleted in the frontend, the server keeps returning the old id, and the only
 * symptom is a card that never appears. Nothing fails; the dashboard is just
 * quietly one tile short.
 *
 * So the ids are declared HERE, once, as a literal `as const` array, and the
 * frontend carries a unit test (`components/insights/askWidgetIds.test.ts`) that
 * parses this array and asserts every id resolves through `getWidget()`. Deleting
 * a widget in the frontend now breaks a test in the frontend, which is where the
 * person doing the deleting is looking.
 *
 * Both consumers ({@link ../dashboards/answerComposer} and
 * {@link ../dashboards/dashboardPresets}) type their id fields as
 * {@link ComposableWidgetId}, so neither can name an id outside this array — the
 * test only has to cover one list.
 */

/**
 * WIDGET IDS — parsed by the frontend test. Keep this a flat array of single-quoted
 * string literals; the test reads the source text between the brackets.
 */
export const COMPOSABLE_WIDGET_IDS = [
  // Delivery
  'delivery.verdict',
  'delivery.velocity-trend',
  'dora.lead-time',
  'dora.deploy-freq',
  'dora.change-fail',
  // Cost
  'finance.spend-trend',
  'finance.forecast',
  'finance.cost-per-pr',
  'core.llm-tokens',
  // Reliability
  'inc.status',
  'inc.mttr',
  'obs.quality-resolution',
  'obs.alert-fires',
  // People / workforce
  'workforce.health',
  'emp.over-allocated',
  'emp.performer-tiers',
  'emp.collab-score',
  'wf.performance-by-discipline',
  // AI
  'ai-impact.productivity',
  'ai-impact.merge-rate',
  'ai-impact.quality',
] as const;

/** A widget id the server may return — narrowed from {@link COMPOSABLE_WIDGET_IDS}. */
export type ComposableWidgetId = (typeof COMPOSABLE_WIDGET_IDS)[number];

/** Guard for a candidate string (used where ids arrive as data, e.g. a route param). */
export function isComposableWidgetId(id: string): id is ComposableWidgetId {
  return (COMPOSABLE_WIDGET_IDS as readonly string[]).includes(id);
}
