/**
 * The outcome-metric presentation contract — how a value metric is named,
 * formatted and compared, declared once for every surface that shows one.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * The session scorecard and the superadmin Value outcomes panel each carried
 * their own `formatMetric` (byte-identical), their own delta arithmetic (NOT
 * identical — the canvas one reported every "lower is better" movement as
 * unfavourable, so a session that halved its cost per delivery was shown a red
 * arrow), and their own copy of the metric type. Two renderings of one number
 * is how a dashboard and a scorecard end up disagreeing about whether a team
 * improved.
 *
 * ── LABELS COME FROM THE KEY, NOT THE WIRE ──────────────────────────────────
 * The API sends `label` in English because a sales brief and an API consumer
 * need words. The UI localises from `key` instead, falling back to the wire
 * label for a metric this build's catalogs have not learned yet — so a new
 * metric appears immediately rather than rendering as a blank cell, and no
 * surface ships hardcoded English.
 *
 * ── THE NORTH STAR IS A FLAG, NOT A LIST ────────────────────────────────────
 * The server marks exactly one metric `northStar`. Surfaces lead with whatever
 * carries the flag, so changing the one number this company steers by is a
 * change in the metric contract rather than an edit to four components.
 */

export type OutcomeMetricUnit = 'seconds' | 'percent' | 'agents' | 'count' | 'usd';
export type OutcomeMetricDirection = 'higher' | 'lower';
export type OutcomeMetricFamily =
  | 'read-prove'
  | 'build'
  | 'measure'
  | 'collaboration'
  | 'compounding'
  | 'efficiency'
  | 'integrity';

/** One metric at whichever grain it was asked for. Shared by every consumer. */
export interface OutcomeMetric {
  key: string;
  /** English fallback from the API. The UI prefers a catalog entry for `key`. */
  label: string;
  unit: OutcomeMetricUnit;
  direction: OutcomeMetricDirection;
  family?: OutcomeMetricFamily;
  northStar?: boolean;
  definition?: string;
  current: number | null;
  baseline: number | null;
}

export interface OutcomeMetricFamilyRef {
  /** Typed loosely on purpose: the server owns the vocabulary, and a client
   *  that dropped a family it had not learned would hide real numbers. */
  key: OutcomeMetricFamily | string;
  label: string;
}

/** Render order: the method's own order, then the qualities of the work. */
export const OUTCOME_METRIC_FAMILY_ORDER: readonly OutcomeMetricFamily[] = [
  'read-prove',
  'build',
  'measure',
  'collaboration',
  'compounding',
  'efficiency',
  'integrity',
];

/**
 * The fixed messages this module renders.
 *
 * Enumerated rather than left as loose literals because `translated` FALLS BACK
 * on a missing key by design — a metric this build has not learned still shows
 * its wire label instead of a blank cell. That same fallback hides a genuinely
 * absent catalog entry: nothing renders a raw key, nothing throws, and every
 * locale quietly serves the English fallback. `check-i18n-keys.mjs` cannot see
 * these either, since the keys are assembled here rather than at a `t(…)` call
 * site. So the list is the contract: `translated` accepts nothing outside it,
 * and `messages.test.ts` proves all five catalogs carry every entry.
 */
export const OUTCOME_METRIC_MESSAGE_KEYS = [
  'notMeasured',
  'baselineGathering',
  'noChange',
  'unitSeconds',
  'unitMinutes',
  'unitAgent',
  'unitAgents',
  'unitPoints',
  'vsBaseline',
] as const;

export type OutcomeMetricMessageKey = (typeof OUTCOME_METRIC_MESSAGE_KEYS)[number];

/** The keys whose suffix the SERVER owns — a metric or family this build has
 *  not learned is expected, and falls back to the label on the wire. */
type OutcomeWireKey = `metric.${string}.label` | `metric.${string}.definition` | `family.${string}`;

/** A translator that can be asked whether it knows a key — `useTranslations`
 *  and `getTranslations` both satisfy this. */
export interface OutcomeTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
}

/**
 * A catalog string, or the wire fallback when this build has not learned it.
 *
 * ICU values are passed THROUGH rather than string-replaced afterwards: a
 * message with a placeholder that never receives it throws in next-intl, and a
 * catch-all fallback would have quietly rendered English for every unit in
 * every locale — the exact failure a localisation guard cannot see.
 */
function translated(
  t: OutcomeTranslator,
  key: OutcomeMetricMessageKey | OutcomeWireKey,
  fallback: string,
  values?: Record<string, string | number>,
): string {
  try {
    if (t.has && !t.has(key)) return fallback;
    const value = t(key, values);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

/** The metric's name, localised from its key. */
export function outcomeMetricLabel(t: OutcomeTranslator, metric: OutcomeMetric): string {
  return translated(t, `metric.${metric.key}.label`, metric.label);
}

/** What qualifies and what deliberately does not — the tooltip/caption text. */
export function outcomeMetricDefinition(t: OutcomeTranslator, metric: OutcomeMetric): string {
  return translated(t, `metric.${metric.key}.definition`, metric.definition ?? '');
}

/** The family heading, localised from the family key. */
export function outcomeFamilyLabel(t: OutcomeTranslator, family: OutcomeMetricFamilyRef): string {
  return translated(t, `family.${family.key}`, family.label);
}

/**
 * Format a value for display. `null` is "not measured" and is never rendered as
 * zero: a cost nobody has told us is not a free delivery.
 */
export function formatOutcomeMetric(t: OutcomeTranslator, value: number | null, unit: OutcomeMetricUnit): string {
  if (value == null) return translated(t, 'notMeasured', 'Not measured');
  if (unit === 'percent') return `${Math.round(value * 100)}%`;
  if (unit === 'usd') return `$${value.toFixed(2)}`;
  if (unit === 'seconds') {
    return value >= 60
      ? translated(t, 'unitMinutes', `${(value / 60).toFixed(value >= 600 ? 0 : 1)} min`, { value: (value / 60).toFixed(value >= 600 ? 0 : 1) })
      : translated(t, 'unitSeconds', `${Math.round(value)} sec`, { value: Math.round(value) });
  }
  if (unit === 'agents') {
    const rendered = value.toFixed(value % 1 ? 1 : 0);
    return value === 1
      ? translated(t, 'unitAgent', `${rendered} agent`, { value: rendered })
      : translated(t, 'unitAgents', `${rendered} agents`, { value: rendered });
  }
  return value.toFixed(value % 1 ? 1 : 0);
}

/** Movements smaller than this are noise, not a trend. */
const NOISE_FLOOR = 0.0001;

export interface OutcomeComparison {
  /** `null` while there is nothing to compare against. */
  favorable: boolean | null;
  /** Signed difference, current − baseline. `null` when incomparable. */
  delta: number | null;
  /** Localised movement text, e.g. "↗ 12 pts vs baseline". */
  label: string;
}

/**
 * Compare a metric with its baseline.
 *
 * `direction` decides what counts as good, which is the bit the canvas panel
 * had wrong: for a "lower is better" metric, a fall is an improvement. Getting
 * this backwards told teams their improving cost per delivery was a regression.
 */
export function compareOutcomeMetric(t: OutcomeTranslator, metric: OutcomeMetric): OutcomeComparison {
  if (metric.current == null || metric.baseline == null) {
    return { favorable: null, delta: null, label: translated(t, 'baselineGathering', 'Baseline gathering') };
  }
  const delta = metric.current - metric.baseline;
  if (Math.abs(delta) < NOISE_FLOOR) {
    return { favorable: true, delta: 0, label: translated(t, 'noChange', 'No change') };
  }
  const favorable = metric.direction === 'higher' ? delta > 0 : delta < 0;
  const points = Math.abs(delta * 100).toFixed(0);
  const magnitude = metric.unit === 'percent'
    ? translated(t, 'unitPoints', `${points} pts`, { value: points })
    : formatOutcomeMetric(t, Math.abs(delta), metric.unit);
  return {
    favorable,
    delta,
    label: `${favorable ? '↗' : '↘'} ${translated(t, 'vsBaseline', `${magnitude} vs baseline`, { magnitude })}`,
  };
}

/** The one metric every surface leads with, or `null` when the API predates it. */
export function northStarMetric(metrics: readonly OutcomeMetric[], northStarKey?: string): OutcomeMetric | null {
  return metrics.find((metric) => metric.northStar) ?? metrics.find((metric) => metric.key === northStarKey) ?? null;
}

export interface OutcomeMetricGroup {
  family: OutcomeMetricFamilyRef;
  metrics: OutcomeMetric[];
}

/**
 * Group the metrics by the act of the method they measure, in render order.
 *
 * Metrics whose family this build does not know still render — under a group
 * carrying their own family key — because dropping a number the server chose to
 * publish is a worse failure than showing it under an unfamiliar heading.
 */
export function groupOutcomeMetrics(
  metrics: readonly OutcomeMetric[],
  families: readonly OutcomeMetricFamilyRef[] = [],
): OutcomeMetricGroup[] {
  const known = new Map<string, OutcomeMetricFamilyRef>(families.map((family) => [family.key, family]));
  const order: string[] = [
    ...OUTCOME_METRIC_FAMILY_ORDER,
    ...families.map((family) => family.key),
    ...metrics.map((metric) => metric.family ?? ''),
  ];
  const seen = new Set<string>();
  const groups: OutcomeMetricGroup[] = [];
  for (const key of order) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const inFamily = metrics.filter((metric) => metric.family === key);
    if (inFamily.length) groups.push({ family: known.get(key) ?? { key, label: key }, metrics: inFamily });
  }
  // An API that predates families still renders — as one unfiled group rather
  // than as nothing at all.
  const unfiled = metrics.filter((metric) => !metric.family);
  if (unfiled.length) groups.push({ family: { key: 'unfiled', label: 'Outcome metrics' }, metrics: unfiled });
  return groups;
}
