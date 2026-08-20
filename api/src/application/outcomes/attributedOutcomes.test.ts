import { describe, expect, it } from 'vitest';
import { shapeAttributedSeries, type AttributedFactRow } from './attributedOutcomes';

/**
 * The half the Idea→delivery panel was missing: `creation_outcome_events`
 * measures the PROCESS, and on its own that is a productivity report — it can
 * say a board shipped faster than its peers and cannot say whether anybody
 * outside the building ever touched what it shipped.
 */

const SESSION = '11111111-1111-4111-8111-111111111111';
const SITES = [{ id: 7, subdomain: 'acme-demo' }, { id: 9, subdomain: null }];

function fact(over: Partial<AttributedFactRow>): AttributedFactRow {
  return {
    metric: 'growth.leads',
    unit: 'leads',
    dimensionKey: 'site:7',
    bucketAt: '2026-08-01T00:00:00.000Z',
    value: '3',
    ...over,
  };
}

describe('shapeAttributedSeries', () => {
  it('separates one metric per subject rather than summing two sites together', () => {
    const series = shapeAttributedSeries(
      [fact({ dimensionKey: 'site:7', value: 3 }), fact({ dimensionKey: 'site:9', value: 5 })],
      SESSION,
      SITES,
    );
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.total)).toEqual([3, 5]);
  });

  it('leads with what the session shipped, then what the sites produced', () => {
    const series = shapeAttributedSeries(
      [
        fact({ metric: 'growth.conversions', dimensionKey: 'site:7' }),
        fact({ metric: 'canvas.shipped', dimensionKey: `session:${SESSION}`, unit: 'deliveries' }),
        fact({ metric: 'growth.leads', dimensionKey: 'site:7' }),
      ],
      SESSION,
      SITES,
    );
    expect(series.map((s) => s.metric)).toEqual(['canvas.shipped', 'growth.conversions', 'growth.leads']);
    expect(series[0]!.subject).toEqual({ kind: 'session', id: SESSION, label: null });
  });

  it('labels a site by its subdomain and survives one that has none', () => {
    const series = shapeAttributedSeries(
      [fact({ dimensionKey: 'site:7' }), fact({ dimensionKey: 'site:9' })],
      SESSION,
      SITES,
    );
    expect(series.map((s) => s.subject.label)).toEqual(['acme-demo', null]);
    expect(series.map((s) => s.subject.id)).toEqual(['7', '9']);
  });

  it('sums a metric across its days and orders the points by day', () => {
    const series = shapeAttributedSeries(
      [
        fact({ bucketAt: '2026-08-03T00:00:00.000Z', value: 2 }),
        fact({ bucketAt: '2026-08-01T00:00:00.000Z', value: 4 }),
      ],
      SESSION,
      SITES,
    );
    expect(series[0]!.total).toBe(6);
    expect(series[0]!.points.map((p) => p.day)).toEqual(['2026-08-01', '2026-08-03']);
  });

  it('drops an unparseable fact instead of counting it as a zero day', () => {
    // A zero day and a missing day are different claims about whether anybody
    // showed up, and averaging a NaN into the series makes both unreadable.
    const series = shapeAttributedSeries(
      [fact({ value: 'not-a-number' }), fact({ value: 4 })],
      SESSION,
      SITES,
    );
    expect(series[0]!.points).toHaveLength(1);
    expect(series[0]!.total).toBe(4);
  });

  it('returns nothing at all when nothing is attributed, rather than an empty zero series', () => {
    expect(shapeAttributedSeries([], SESSION, SITES)).toEqual([]);
  });

  it('accepts a Date as well as an ISO string for the bucket', () => {
    const series = shapeAttributedSeries([fact({ bucketAt: new Date('2026-08-05T12:00:00Z') })], SESSION, SITES);
    expect(series[0]!.points[0]!.day).toBe('2026-08-05');
  });
});
