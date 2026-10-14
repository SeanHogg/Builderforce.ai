/**
 * THE heatmap insight rules (PRD 33 §8 S4, `HeatmapInsights`).
 *
 * DATA, not branches: each rule is `{ id, evaluate(input) }` over one route's element
 * stats, its scroll reach and — when a compare release is chosen — the same numbers
 * for that release. Pure: no Env, no Db, no clock. The service feeds the input and
 * concatenates what every rule returns; the frontend renders the title from
 * `replay.heatInsight.<ruleId>` over `params`.
 *
 * Release comparisons are TRAFFIC-SCALED: a release that served twice the page views
 * is expected to have twice the rage clicks, so the compare count is multiplied by
 * `pageviews.current / pageviews.compare` before the ratio is taken.
 */

import type { ReplayHeatInsightDto } from '@builderforce/interaction-contract';

/** One element's exact counts on the route, for one release (or all releases). */
export interface HeatElementStat {
  selector: string;
  label: string | null;
  clicks: number;
  rage: number;
  dead: number;
  /** Interaction-weighted median grid row (0..grid-1); null without cells. */
  medianGy: number | null;
}

export interface HeatInsightInput {
  route: string;
  /** Rows of the heat lattice (`GRID`). */
  grid: number;
  elements: readonly HeatElementStat[];
  /** The compare release's elements; null when no compare release was chosen. */
  compare: readonly HeatElementStat[] | null;
  /** 10 entries: share of page views reaching depth decile i. */
  scrollReach: readonly number[];
  /** Page views that reported a scroll depth. */
  scrollSessions: number;
  pageviews: { current: number; compare: number | null };
  /** Sessions with a quick back on the route (the `quickback` issue groups). */
  quickbacks: { current: number; compare: number | null };
}

export interface HeatInsightRule {
  id: string;
  evaluate(input: HeatInsightInput): ReplayHeatInsightDto[];
}

export const HEAT_INSIGHT_THRESHOLDS = {
  /** rage_spike: at least this many rage clicks… */
  rageMin: 5,
  /** …and more than this multiple of the (traffic-scaled) compare release. */
  rageRatio: 3,
  /** dead_text: dead clicks on a non-interactive element. */
  deadTextMin: 10,
  /** buried_top_click: the top element needs this many clicks… */
  topClickMin: 20,
  /** …and the route this many page views with a scroll depth. */
  scrollSessionsMin: 20,
  /** The reach below which a decile is "below the fold for most visitors". */
  foldReach: 0.5,
  /** quickback_doubled: at least this many quick-back sessions… */
  quickbackMin: 5,
  /** …and at least this multiple of the (traffic-scaled) compare release. */
  quickbackRatio: 2,
  /** At most this many findings per rule, strongest first. */
  perRule: 5,
} as const;

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'switch', 'option', 'slider', 'searchbox', 'spinbutton', 'listbox',
]);
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'option']);

/**
 * What a derived selector (`deriveSelector`, or the recorder's masked bare tag) names:
 * a control, plain content, or something it cannot tell (a test id).
 */
export function selectorKind(selector: string): 'interactive' | 'text' | 'unknown' {
  const s = selector.trim();
  if (!s) return 'unknown';
  const role = /^getByRole\("([^"]+)"/.exec(s);
  if (role) return INTERACTIVE_ROLES.has(role[1]!.toLowerCase()) ? 'interactive' : 'text';
  if (s.startsWith('getByText(')) return 'text';
  if (s.startsWith('getByTestId(')) return 'unknown';
  const last = s.split('>').pop()!.trim();
  const tag = /^([a-z][a-z0-9-]*)/i.exec(last)?.[1]?.toLowerCase();
  if (!tag) return 'unknown';
  return INTERACTIVE_TAGS.has(tag) ? 'interactive' : 'text';
}

/** compare × (current traffic / compare traffic); the compare count when traffic is unknown. */
export function trafficScaled(compareValue: number, pageviews: HeatInsightInput['pageviews']): number {
  const { current, compare } = pageviews;
  if (!compare || compare <= 0 || current <= 0) return compareValue;
  return compareValue * (current / compare);
}

/** The scroll decile (0..9) of a grid row. */
export function rowDecile(gy: number, grid: number): number {
  if (grid <= 0) return 0;
  return Math.max(0, Math.min(9, Math.floor((gy * 10) / grid)));
}

/** The first decile fewer than `foldReach` of page views reach; 10 when every decile is reached. */
export function foldDecile(reach: readonly number[], foldReach: number = HEAT_INSIGHT_THRESHOLDS.foldReach): number {
  for (let i = 0; i < 10; i++) if ((reach[i] ?? 0) < foldReach) return i;
  return 10;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const T = HEAT_INSIGHT_THRESHOLDS;

const rageSpike: HeatInsightRule = {
  id: 'rage_spike',
  evaluate(input) {
    if (!input.compare) return [];
    const before = new Map(input.compare.map((row) => [row.selector, row.rage]));
    return input.elements
      .filter((row) => row.rage >= T.rageMin)
      .map((row) => {
        const compareRage = before.get(row.selector) ?? 0;
        const expected = Math.max(1, trafficScaled(compareRage, input.pageviews));
        return { row, compareRage, ratio: row.rage / expected };
      })
      .filter((hit) => hit.ratio > T.rageRatio)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, T.perRule)
      .map(({ row, compareRage, ratio }) => ({
        ruleId: 'rage_spike',
        route: input.route,
        selector: row.selector,
        params: { rage: row.rage, compareRage, ratio: round2(ratio), label: row.label ?? '' },
        action: 'ticket' as const,
      }));
  },
};

const deadText: HeatInsightRule = {
  id: 'dead_text',
  evaluate(input) {
    return input.elements
      .filter((row) => row.dead >= T.deadTextMin && selectorKind(row.selector) === 'text')
      .sort((a, b) => b.dead - a.dead)
      .slice(0, T.perRule)
      .map((row) => ({
        ruleId: 'dead_text',
        route: input.route,
        selector: row.selector,
        params: { dead: row.dead, label: row.label ?? '' },
        action: 'ticket' as const,
      }));
  },
};

const buriedTopClick: HeatInsightRule = {
  id: 'buried_top_click',
  evaluate(input) {
    if (input.scrollSessions < T.scrollSessionsMin) return [];
    const top = input.elements.reduce<HeatElementStat | null>(
      (best, row) => (best === null || row.clicks > best.clicks ? row : best),
      null,
    );
    if (!top || top.clicks < T.topClickMin || top.medianGy === null) return [];
    const decile = rowDecile(top.medianGy, input.grid);
    if (decile < foldDecile(input.scrollReach)) return [];
    return [{
      ruleId: 'buried_top_click',
      route: input.route,
      selector: top.selector,
      params: { clicks: top.clicks, decile, reach: round2(input.scrollReach[decile] ?? 0), label: top.label ?? '' },
      action: 'ticket',
    }];
  },
};

const quickbackDoubled: HeatInsightRule = {
  id: 'quickback_doubled',
  evaluate(input) {
    const { current, compare } = input.quickbacks;
    if (compare === null || current < T.quickbackMin) return [];
    const expected = Math.max(1, trafficScaled(compare, input.pageviews));
    if (current < T.quickbackRatio * expected) return [];
    return [{
      ruleId: 'quickback_doubled',
      route: input.route,
      selector: null,
      params: { quickbacks: current, compareQuickbacks: compare, ratio: round2(current / expected) },
      action: 'watch',
    }];
  },
};

/** Every heatmap insight rule, in display order. */
export const HEATMAP_INSIGHT_RULES: readonly HeatInsightRule[] = [rageSpike, deadText, buriedTopClick, quickbackDoubled];

/** Run every rule over one route. */
export function evaluateHeatInsights(input: HeatInsightInput): ReplayHeatInsightDto[] {
  return HEATMAP_INSIGHT_RULES.flatMap((rule) => rule.evaluate(input));
}
