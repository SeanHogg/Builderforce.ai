/**
 * The A4 cost-metric dimensions — registry data, not branches. Each entry says how a
 * usage row is assigned to a group (and, for `lever`, to an arm) in the one metrics
 * statement (`costMetricsStore.ts`). The SQL fragments are constants: a request selects
 * an entry by key, it never supplies SQL.
 *
 * Aliases the fragments may use: `u` = llm_usage_log, `o` = run_model_outcomes (LEFT
 * JOINed on execution id), `la` = the lever-arm lateral (lever grouping only).
 */
export const COST_METRIC_GROUP_BYS = ['none', 'actionType', 'role', 'lever', 'day'] as const;
export type CostMetricGroupBy = (typeof COST_METRIC_GROUP_BYS)[number];

export const COST_METRIC_WINDOWS = { '7d': 7, '30d': 30 } as const;
export type CostMetricWindow = keyof typeof COST_METRIC_WINDOWS;

export interface CostMetricGroupSpec {
  /** Group key expression. */
  key: string;
  /** Arm expression — '' for every grouping that has no arms. */
  arm: string;
  /** Extra FROM clause (the lever lateral), or ''. */
  join: string;
  /** Groups are a series, read in key order (ascending) rather than most expensive first. */
  series?: true;
}

/** One arm array of the `metadata.costLevers` stamp, as a safe set-returning source. */
const armArray = (arm: 'on' | 'off'): string =>
  `jsonb_array_elements_text(CASE WHEN jsonb_typeof(u.metadata->'costLevers'->'${arm}') = 'array' `
  + `THEN u.metadata->'costLevers'->'${arm}' ELSE '[]'::jsonb END)`;

export const COST_METRIC_GROUPS: Readonly<Record<CostMetricGroupBy, CostMetricGroupSpec>> = {
  none:       { key: `'all'`, arm: `''`, join: '' },
  actionType: { key: `COALESCE(o.action_type, 'unattributed')`, arm: `''`, join: '' },
  role:       { key: `COALESCE(u.role, 'unattributed')`, arm: `''`, join: '' },
  // A row stamped with the A/B arms appears once per partially-rolled-out lever, in the
  // arm it ran under. Rows written before the stamp carry none and drop out here only.
  lever: {
    key: 'la.lever',
    arm: 'la.arm',
    join: [
      'CROSS JOIN LATERAL (',
      `  SELECT l AS lever, 'on' AS arm FROM ${armArray('on')} AS l`,
      '  UNION ALL',
      `  SELECT l AS lever, 'off' AS arm FROM ${armArray('off')} AS l`,
      ') la',
    ].join('\n'),
  },
  // UTC calendar day, 'YYYY-MM-DD'. `created_at` is a UTC `timestamp` (no zone), so the
  // text of its date part IS the UTC day — no session-zone conversion can shift it.
  day: { key: `to_char(u.created_at, 'YYYY-MM-DD')`, arm: `''`, join: '', series: true },
};

export function isCostMetricGroupBy(v: unknown): v is CostMetricGroupBy {
  return typeof v === 'string' && (COST_METRIC_GROUP_BYS as readonly string[]).includes(v);
}

export function isCostMetricWindow(v: unknown): v is CostMetricWindow {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COST_METRIC_WINDOWS, v);
}
