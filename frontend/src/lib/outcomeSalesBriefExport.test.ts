import { describe, expect, it } from 'vitest';
import {
  buildSalesBriefModel,
  escapeHtml,
  renderSalesBriefHtml,
  renderSalesBriefMarkdown,
  salesBriefFilename,
  suppressSmallSegments,
  type SalesBriefLabels,
  type SalesBriefRollup,
} from './outcomeSalesBriefExport';
import type { OutcomeTranslator } from './outcomeMetrics';

const t: OutcomeTranslator = (key) => key;
t.has = () => false; // force the wire-label fallback

const labels: SalesBriefLabels = {
  title: 'Value outcomes brief',
  period: 'Period: Jan 1 – Jan 30',
  cohort: 'Cohort: 40 sessions',
  northStar: 'North star',
  prior: 'prior',
  definitions: 'Definitions 2026.10-test',
  freshness: 'Data as of 2026-11-19',
  denominator: 'Denominator: 40 sessions',
  suppressed: '2 small segments suppressed (fewer than 10 sessions)',
  window: 'Window: 30 days',
  segmentsTitle: 'Where the value came from',
  workspacesLabel: 'Value by workspace',
  projectsLabel: 'Value by project',
  sessionsColumn: 'Sessions',
  deliveredColumn: 'Delivered',
  gradedColumn: 'Graded',
  notEligible: 'Below the minimum cohort.',
  lang: 'en',
};

function rollup(over: Partial<SalesBriefRollup> = {}): SalesBriefRollup {
  return {
    period: { start: '2026-10-01', end: '2026-10-31', days: 30 },
    sampleSize: 40,
    deliveredSessions: 20,
    gradedSessions: 10,
    definitionVersion: '2026.10-test',
    northStarKey: 'gradedProofRate',
    families: [],
    metrics: [
      { key: 'gradedProofRate', label: 'Ideas reaching a graded proof', unit: 'percent', direction: 'higher', family: 'measure', northStar: true, definition: 'Graded only.', current: 0.25, baseline: 0.2 },
      { key: 'costPerDelivery', label: 'Cost per delivered outcome', unit: 'usd', direction: 'lower', family: 'efficiency', definition: 'Attributed cost.', current: null, baseline: null },
    ],
    tenants: [
      { tenantId: 1, sessions: 25, deliveries: 12, graded: 6 },
      { tenantId: 2, sessions: 3, deliveries: 1, graded: 0 },
    ],
    projects: [{ projectId: 9, sessions: 2, deliveries: 1, graded: 0 }],
    generatedAt: '2026-11-19T10:00:00Z',
    privacy: { contentFree: true, minimumExternalCohort: 10, externalClaimsEligible: true },
    ...over,
  };
}

const build = (r: SalesBriefRollup) =>
  buildSalesBriefModel({ rollup: r, metricT: t, labels, segmentName: (kind, n) => `${kind}-${n}` });

describe('suppressSmallSegments', () => {
  it('drops segments under the threshold and counts them', () => {
    const { kept, suppressed } = suppressSmallSegments([{ sessions: 9 }, { sessions: 10 }, { sessions: 50 }], 10);
    expect(kept).toEqual([{ sessions: 10 }, { sessions: 50 }]);
    expect(suppressed).toBe(1);
  });
});

describe('buildSalesBriefModel', () => {
  it('stamps version, denominator, window, freshness and suppressed segments', () => {
    const model = build(rollup());
    expect(model.stamps).toMatchObject({
      definitionVersion: '2026.10-test',
      denominator: 40,
      windowDays: 30,
      generatedAt: '2026-11-19T10:00:00Z',
      suppressedSegments: 2,
      minimumCohort: 10,
    });
    expect(model.workspaces).toHaveLength(1);
    expect(model.projects).toHaveLength(0);
  });

  it('is content-free: segments carry positional labels, never names', () => {
    const model = build(rollup());
    expect(model.workspaces[0].label).toBe('workspace-1');
  });

  it('renders a missing metric as Not measured, never zero', () => {
    const model = build(rollup());
    const cost = model.groups.flatMap((g) => g.rows).find((r) => r.label === 'Cost per delivered outcome');
    expect(cost?.value).toBe('Not measured');
    expect(cost?.value).not.toMatch(/0/);
  });
});

describe('renderSalesBriefMarkdown', () => {
  it('includes the north star, figures and every stamp', () => {
    const md = renderSalesBriefMarkdown(build(rollup()), labels);
    expect(md).toContain('# Value outcomes brief');
    expect(md).toContain('**Ideas reaching a graded proof: 25%** (prior: 20%)');
    expect(md).toContain('Definitions 2026.10-test');
    expect(md).toContain('Denominator: 40 sessions');
    expect(md).toContain('Window: 30 days');
    expect(md).toContain('Data as of 2026-11-19');
    expect(md).toContain('2 small segments suppressed');
  });

  it('exports the refusal, not the figures, below the threshold', () => {
    const md = renderSalesBriefMarkdown(
      build(rollup({ privacy: { contentFree: true, minimumExternalCohort: 10, externalClaimsEligible: false } })),
      labels,
    );
    expect(md).toContain('Below the minimum cohort.');
    expect(md).not.toContain('25%');
  });
});

describe('renderSalesBriefHtml', () => {
  it('is a self-contained printable deck with no scripts or external assets', () => {
    const html = renderSalesBriefHtml(build(rollup()), labels);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page');
    expect(html).toContain('class="slide"');
    expect(html).toContain('Definitions 2026.10-test');
    expect(html).not.toMatch(/<script|<link|src=|https?:\/\//i);
  });

  it('escapes interpolated text', () => {
    const evil = { ...labels, title: '<b>"x"</b>' };
    const html = renderSalesBriefHtml(
      buildSalesBriefModel({ rollup: rollup(), metricT: t, labels: evil, segmentName: (kind, n) => `${kind}-${n}` }),
      evil,
    );
    expect(html).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(html).not.toContain('<b>"x"');
  });

  it('shows no figures when not eligible', () => {
    const html = renderSalesBriefHtml(
      build(rollup({ privacy: { contentFree: true, minimumExternalCohort: 10, externalClaimsEligible: false } })),
      labels,
    );
    expect(html).toContain('Below the minimum cohort.');
    expect(html).not.toContain('25%');
  });
});

describe('helpers', () => {
  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('filename carries the definition version', () => {
    expect(salesBriefFilename(build(rollup()), 'html')).toBe('value-outcomes-brief-2026.10-test.html');
  });
});
