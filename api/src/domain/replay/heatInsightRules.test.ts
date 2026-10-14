/**
 * Each heatmap insight rule fires on a fixture that crosses its threshold and stays
 * silent on a near miss just short of it.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateHeatInsights,
  foldDecile,
  HEATMAP_INSIGHT_RULES,
  rowDecile,
  selectorKind,
  trafficScaled,
  type HeatElementStat,
  type HeatInsightInput,
} from './heatInsightRules';

const el = (selector: string, over: Partial<HeatElementStat> = {}): HeatElementStat => ({
  selector, label: null, clicks: 0, rage: 0, dead: 0, medianGy: 5, ...over,
});

/** Everyone reaches deciles 0–3, 40 % reach 4+. */
const REACH = [1, 1, 1, 1, 0.4, 0.4, 0.3, 0.2, 0.1, 0.05];

function input(over: Partial<HeatInsightInput> = {}): HeatInsightInput {
  return {
    route: '/pricing',
    grid: 50,
    elements: [],
    compare: null,
    scrollReach: REACH,
    scrollSessions: 100,
    pageviews: { current: 1_000, compare: 1_000 },
    quickbacks: { current: 0, compare: null },
    ...over,
  };
}

const rule = (id: string) => HEATMAP_INSIGHT_RULES.find((r) => r.id === id)!;

describe('the registry', () => {
  it('declares the four S4 rules as data', () => {
    expect(HEATMAP_INSIGHT_RULES.map((r) => r.id)).toEqual(['rage_spike', 'dead_text', 'buried_top_click', 'quickback_doubled']);
  });

  it('is silent on an empty route', () => {
    expect(evaluateHeatInsights(input())).toEqual([]);
  });
});

describe('rage_spike', () => {
  const buy = 'getByRole("button", { name: "Buy" })';

  it('fires when rage is more than 3× the compare release', () => {
    const out = rule('rage_spike').evaluate(input({
      elements: [el(buy, { rage: 10, label: 'Buy' })],
      compare: [el(buy, { rage: 3 })],
    }));
    expect(out).toEqual([{
      ruleId: 'rage_spike', route: '/pricing', selector: buy,
      params: { rage: 10, compareRage: 3, ratio: 3.33, label: 'Buy' }, action: 'ticket',
    }]);
  });

  it('stays silent at exactly 3×', () => {
    expect(rule('rage_spike').evaluate(input({
      elements: [el(buy, { rage: 9 })],
      compare: [el(buy, { rage: 3 })],
    }))).toEqual([]);
  });

  it('scales the compare release by traffic', () => {
    // Twice the page views → 3 compare rage clicks are expected to be 6; 10 is not > 18.
    expect(rule('rage_spike').evaluate(input({
      elements: [el(buy, { rage: 10 })],
      compare: [el(buy, { rage: 3 })],
      pageviews: { current: 2_000, compare: 1_000 },
    }))).toEqual([]);
  });

  it('needs a compare release', () => {
    expect(rule('rage_spike').evaluate(input({ elements: [el(buy, { rage: 50 })] }))).toEqual([]);
  });
});

describe('dead_text', () => {
  it('fires on dead clicks on plain text', () => {
    const out = rule('dead_text').evaluate(input({ elements: [el('getByText("Free shipping")', { dead: 12, label: 'Free shipping' })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'dead_text', params: { dead: 12, label: 'Free shipping' }, action: 'ticket' });
  });

  it('stays silent one click under the threshold', () => {
    expect(rule('dead_text').evaluate(input({ elements: [el('getByText("Free shipping")', { dead: 9 })] }))).toEqual([]);
  });

  it('stays silent on a control', () => {
    expect(rule('dead_text').evaluate(input({ elements: [el('getByRole("link", { name: "Docs" })', { dead: 40 })] }))).toEqual([]);
  });
});

describe('buried_top_click', () => {
  it('fires when the most-clicked element sits below the decile most visitors reach', () => {
    // gy 30 of 50 → decile 6; only 30 % reach it.
    const out = rule('buried_top_click').evaluate(input({
      elements: [el('getByText("Pricing table")', { clicks: 80, medianGy: 30 }), el('a.nav', { clicks: 10, medianGy: 1 })],
    }));
    expect(out).toEqual([{
      ruleId: 'buried_top_click', route: '/pricing', selector: 'getByText("Pricing table")',
      params: { clicks: 80, decile: 6, reach: 0.3, label: '' }, action: 'ticket',
    }]);
  });

  it('stays silent when the top element is above the fold decile', () => {
    // gy 19 → decile 3, which everyone reaches.
    expect(rule('buried_top_click').evaluate(input({
      elements: [el('getByText("Pricing table")', { clicks: 80, medianGy: 19 })],
    }))).toEqual([]);
  });

  it('stays silent with too few scroll samples', () => {
    expect(rule('buried_top_click').evaluate(input({
      scrollSessions: 19,
      elements: [el('getByText("Pricing table")', { clicks: 80, medianGy: 30 })],
    }))).toEqual([]);
  });
});

describe('quickback_doubled', () => {
  it('fires when quick backs doubled vs the compare release', () => {
    const out = rule('quickback_doubled').evaluate(input({ quickbacks: { current: 10, compare: 5 } }));
    expect(out).toEqual([{
      ruleId: 'quickback_doubled', route: '/pricing', selector: null,
      params: { quickbacks: 10, compareQuickbacks: 5, ratio: 2 }, action: 'watch',
    }]);
  });

  it('stays silent just under double', () => {
    expect(rule('quickback_doubled').evaluate(input({ quickbacks: { current: 9, compare: 5 } }))).toEqual([]);
  });

  it('needs a compare release', () => {
    expect(rule('quickback_doubled').evaluate(input({ quickbacks: { current: 40, compare: null } }))).toEqual([]);
  });
});

describe('helpers', () => {
  it('classifies derived selectors', () => {
    expect(selectorKind('getByRole("button", { name: "Go" })')).toBe('interactive');
    expect(selectorKind('getByRole("heading", { name: "Hi" })')).toBe('text');
    expect(selectorKind('getByText("Hello")')).toBe('text');
    expect(selectorKind('getByTestId("cta")')).toBe('unknown');
    expect(selectorKind('div.card > a.more')).toBe('interactive');
    expect(selectorKind('main > p.lead')).toBe('text');
    expect(selectorKind('span')).toBe('text');
  });

  it('maps rows to deciles and finds the fold', () => {
    expect(rowDecile(0, 50)).toBe(0);
    expect(rowDecile(49, 50)).toBe(9);
    expect(foldDecile(REACH)).toBe(4);
    expect(foldDecile(new Array(10).fill(1))).toBe(10);
    expect(trafficScaled(3, { current: 2_000, compare: 1_000 })).toBe(6);
    expect(trafficScaled(3, { current: 2_000, compare: null })).toBe(3);
  });
});
