/**
 * Every prescription rule fires on its fixture and stays silent on a near miss
 * (PRD 33 §5.1.1). Rules are pure over `SiteAggregates`, so each fixture is data.
 */
import { describe, expect, it } from 'vitest';
import { detectFindings, isCta, isHeadingSelector, PRESCRIPTION_RULE_BY_ID, PRESCRIPTION_RULES, stableHash } from './rules';
import type { IssueAggregate, SiteAggregates } from './types';

function agg(over: Partial<SiteAggregates> = {}): SiteAggregates {
  return {
    siteId: 's1', days: 30, grid: 50, site: { sessions: 0, conversions: 0 },
    routes: [], issues: [], elements: [], scroll: [], funnelSteps: [], devices: [], releases: [],
    knownCohorts: [], proofs: [], patterns: [],
    ...over,
  };
}

function issue(over: Partial<IssueAggregate>): IssueAggregate {
  return {
    id: 'i1', fingerprint: 'fp1', kind: 'rage', route: '/checkout', subject: 'button.pay', title: 'Rage clicks on Pay',
    status: 'new', sessions: 10, share: 0.05, routeSessions: 200, recordingIds: ['r1', 'r2', 'r3', 'r4'], cohorts: null,
    ...over,
  };
}

const run = (id: string, a: SiteAggregates) => PRESCRIPTION_RULE_BY_ID.get(id)!.detect(a);

describe('PRESCRIPTION_RULES', () => {
  it('declares all twelve §5.1 rules, each with an area, an effort, actions and an acceptance', () => {
    expect(PRESCRIPTION_RULES.map((r) => r.id)).toEqual([
      'rage_on_element', 'error_on_step', 'dead_click_heading', 'cta_below_fold', 'quickback_after_reveal',
      'excessive_scroll_missing_info', 'device_gap', 'release_regression', 'pricing_hesitation',
      'checkout_abandon_known', 'objection_pattern', 'proof_missed_reason',
    ]);
    for (const rule of PRESCRIPTION_RULES) {
      expect([1, 2, 3]).toContain(rule.effort);
      expect(rule.actions.length, rule.id).toBeGreaterThan(0);
      expect(rule.acceptance.minVisits, rule.id).toBeGreaterThan(0);
    }
  });

  it('finds nothing on an empty site', () => {
    expect(detectFindings(agg())).toEqual([]);
  });
});

describe('rage_on_element', () => {
  it('fires at ≥3% of the route\'s visits raging, citing three representatives', () => {
    const [f] = run('rage_on_element', agg({ issues: [issue({ share: 0.03 })] }));
    expect(f).toMatchObject({ ruleId: 'rage_on_element', area: 'ux', subjectKey: '/checkout|button.pay', selector: 'button.pay', issueId: 'i1', affected: 10 });
    expect(f!.evidence).toEqual([{ recordingId: 'r1', atMs: 0 }, { recordingId: 'r2', atMs: 0 }, { recordingId: 'r3', atMs: 0 }]);
    expect(f!.params).toMatchObject({ share: 3, route: '/checkout' });
  });

  it('stays silent just under 3%, or on a quiet route', () => {
    expect(run('rage_on_element', agg({ issues: [issue({ share: 0.029 })] }))).toEqual([]);
    expect(run('rage_on_element', agg({ issues: [issue({ routeSessions: 49 })] }))).toEqual([]);
  });
});

describe('error_on_step', () => {
  const step = (drops: number) => ({
    funnelId: 'f1', funnelName: 'Checkout', ord: 1, label: 'page: /pay', prevVisits: 100, visits: 60, droppedSampled: 10,
    dropErrors: [{ issueId: 'e1', fingerprint: 'efp', subject: 'TypeError: x', route: '/pay', drops, recordingIds: ['r9'] }],
  });
  it('fires when one error is in ≥30% of the sampled drops', () => {
    const [f] = run('error_on_step', agg({ funnelSteps: [step(3)] }));
    expect(f).toMatchObject({ subjectKey: 'f1:1:efp', issueId: 'e1', affected: 12, params: { share: 30, error: 'TypeError: x' } });
  });
  it('stays silent at 20%, or on too few drops', () => {
    expect(run('error_on_step', agg({ funnelSteps: [step(2)] }))).toEqual([]);
    expect(run('error_on_step', agg({ funnelSteps: [{ ...step(3), droppedSampled: 4 }] }))).toEqual([]);
  });
});

describe('dead_click_heading', () => {
  it('fires on dead clicks on a heading', () => {
    const [f] = run('dead_click_heading', agg({ issues: [issue({ kind: 'dead', subject: 'main > h2', sessions: 12, share: 0.06 })] }));
    expect(f).toMatchObject({ ruleId: 'dead_click_heading', selector: 'main > h2' });
  });
  it('stays silent on a dead click that is not a heading, or too few', () => {
    expect(run('dead_click_heading', agg({ issues: [issue({ kind: 'dead', subject: 'main > p', sessions: 12, share: 0.06 })] }))).toEqual([]);
    expect(run('dead_click_heading', agg({ issues: [issue({ kind: 'dead', subject: 'h2', sessions: 9, share: 0.06 })] }))).toEqual([]);
  });
});

describe('cta_below_fold', () => {
  const reach = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.39, 0.3, 0.2, 0.1];
  const base = (medianGy: number) => agg({
    scroll: [{ route: '/', sessions: 100, reach }],
    elements: [{ route: '/', selector: 'getByRole("button", { name: "Get started" })', label: 'Get started', clicks: 20, rage: 0, dead: 0, medianGy }],
  });
  it('fires when the CTA sits at a depth fewer than 40% reach', () => {
    const [f] = run('cta_below_fold', base(32)); // row 32 of 50 → decile 6 (39%)
    expect(f).toMatchObject({ ruleId: 'cta_below_fold', pagePath: '/', params: { decile: 6, reach: 39 }, affected: 61 });
  });
  it('stays silent when 40% or more reach it', () => {
    expect(run('cta_below_fold', base(27))).toEqual([]); // decile 5 → 50%
  });
});

describe('quickback_after_reveal and excessive_scroll_missing_info', () => {
  it('fire on their issue kinds past their shares and stay silent just under', () => {
    expect(run('quickback_after_reveal', agg({ issues: [issue({ kind: 'quickback', subject: '/pricing', route: '/pricing', share: 0.15 })] }))).toHaveLength(1);
    expect(run('quickback_after_reveal', agg({ issues: [issue({ kind: 'quickback', share: 0.14 })] }))).toEqual([]);
    expect(run('excessive_scroll_missing_info', agg({ issues: [issue({ kind: 'excessive_scroll', share: 0.1 })] }))).toHaveLength(1);
    expect(run('excessive_scroll_missing_info', agg({ issues: [issue({ kind: 'excessive_scroll', share: 0.09 })] }))).toEqual([]);
  });
});

describe('device_gap', () => {
  const devices = (phoneConv: number) => [
    { value: 'desktop', sessions: 1_000, conversions: 50 },
    { value: 'phone', sessions: 1_000, conversions: phoneConv },
  ];
  it('fires when phones convert at under half the desktop rate, with exact cohorts', () => {
    const [f] = run('device_gap', agg({ devices: devices(20) }));
    expect(f).toMatchObject({ subjectKey: 'device:phone', affected: 1_000 });
    expect(f!.cohorts).toEqual({ with: { visits: 1_000, conversions: 20 }, without: { visits: 1_000, conversions: 50 }, estimated: false });
  });
  it('stays silent at half or better', () => {
    expect(run('device_gap', agg({ devices: devices(25) }))).toEqual([]);
  });
});

describe('release_regression', () => {
  const releases = (currentConv: number) => [
    { releaseKey: 'r2', label: null, firstSeenAt: '2026-10-10T00:00:00.000Z', sessions: 1_000, conversions: currentConv },
    { releaseKey: 'r1', label: 'Launch', firstSeenAt: '2026-10-01T00:00:00.000Z', sessions: 1_000, conversions: 50 },
  ];
  it('fires on a ≥10-point drop against the previous release', () => {
    const [f] = run('release_regression', agg({ releases: releases(45) }));
    expect(f).toMatchObject({ subjectKey: 'release:r2', params: { previous: 'Launch', drop: 10 } });
  });
  it('stays silent on a smaller drop', () => {
    expect(run('release_regression', agg({ releases: releases(46) }))).toEqual([]);
  });
});

describe('pricing_hesitation and checkout_abandon_known', () => {
  const cohort = (kind: 'pricing' | 'checkout', identified: number, converted: number) =>
    ({ kind, route: kind === 'pricing' ? '/pricing' : '/checkout', identifiedVisitors: identified, convertedVisitors: converted, recordingIds: ['r1'] });
  it('fire on identifiable visitors who did not convert', () => {
    expect(run('pricing_hesitation', agg({ knownCohorts: [cohort('pricing', 5, 2)] }))).toMatchObject([{ subjectKey: 'pricing:/pricing', affected: 3 }]);
    expect(run('checkout_abandon_known', agg({ knownCohorts: [cohort('checkout', 3, 1)] }))).toMatchObject([{ subjectKey: 'checkout:/checkout', affected: 2 }]);
  });
  it('stay silent below their counts', () => {
    expect(run('pricing_hesitation', agg({ knownCohorts: [cohort('pricing', 4, 2)] }))).toEqual([]);
    expect(run('checkout_abandon_known', agg({ knownCohorts: [cohort('checkout', 2, 1)] }))).toEqual([]);
  });
});

describe('objection_pattern', () => {
  const pattern = (text: string, n: number) => ({ text, examples: Array.from({ length: n }, (_, i) => ({ recordingId: `r${i}`, atMs: i * 1000 })) });
  it('fires on a cited objection with two examples, keyed by a stable hash', () => {
    const [f] = run('objection_pattern', agg({ patterns: [pattern('Visitors hesitate at the price on the plans page.', 2)] }));
    expect(f!.subjectKey).toBe(`objection:${stableHash('visitors hesitate at the price on the plans page.')}`);
    expect(f!.evidence).toEqual([{ recordingId: 'r0', atMs: 0 }, { recordingId: 'r1', atMs: 1000 }]);
  });
  it('stays silent on one example or a pattern that is not an objection', () => {
    expect(run('objection_pattern', agg({ patterns: [pattern('Visitors hesitate at the price.', 1)] }))).toEqual([]);
    expect(run('objection_pattern', agg({ patterns: [pattern('Visitors scroll to the footer.', 3)] }))).toEqual([]);
  });
});

describe('proof_missed_reason', () => {
  const proof = (verdict: 'met' | 'missed') => ({ realizationId: 'p1', title: 'Smoke test', verdict, metricLabel: 'Signups', metricValue: 4, target: 25 });
  it('names the strongest frustration as the reason a proof missed', () => {
    const [f] = run('proof_missed_reason', agg({ proofs: [proof('missed')], issues: [issue({ share: 0.2, sessions: 40 })] }));
    expect(f).toMatchObject({ subjectKey: 'proof:p1', issueId: 'i1', params: { proof: 'Smoke test', reason: 'Rage clicks on Pay' } });
  });
  it('stays silent on a met proof, or with no issue strong enough', () => {
    expect(run('proof_missed_reason', agg({ proofs: [proof('met')], issues: [issue({ share: 0.2 })] }))).toEqual([]);
    expect(run('proof_missed_reason', agg({ proofs: [proof('missed')], issues: [issue({ share: 0.04 })] }))).toEqual([]);
  });
});

describe('selector helpers', () => {
  it('tells headings and calls to action apart', () => {
    expect(isHeadingSelector('section > h1')).toBe(true);
    expect(isHeadingSelector('getByRole("heading", { name: "Plans" })')).toBe(true);
    expect(isHeadingSelector('section > header')).toBe(false);
    expect(isCta({ selector: 'button.primary', label: 'Sign up' })).toBe(true);
    expect(isCta({ selector: 'p.lede', label: 'Sign up' })).toBe(false);
  });
});
