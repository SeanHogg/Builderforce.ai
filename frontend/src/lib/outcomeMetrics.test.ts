import { describe, expect, it } from 'vitest';
import {
  compareOutcomeMetric,
  formatOutcomeMetric,
  groupOutcomeMetrics,
  northStarMetric,
  outcomeMetricLabel,
  type OutcomeMetric,
  type OutcomeTranslator,
} from './outcomeMetrics';

/** A translator that knows nothing, so every assertion below is about the
 *  fallback path a build sees before its catalogs learn a new metric. */
const bare: OutcomeTranslator = Object.assign((key: string) => key, { has: () => false });

/** A translator that knows the metric vocabulary. */
const catalog: OutcomeTranslator = Object.assign(
  (key: string, values?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      'metric.deliverableRate.label': 'Livrables réels',
      notMeasured: 'Non mesuré',
      unitPoints: `${values?.value} pts`,
      vsBaseline: `${values?.magnitude} par rapport à la référence`,
    };
    return messages[key] ?? key;
  },
  { has: (key: string) => ['metric.deliverableRate.label', 'notMeasured', 'unitPoints', 'vsBaseline'].includes(key) },
);

const metric = (overrides: Partial<OutcomeMetric> = {}): OutcomeMetric => ({
  key: 'deliverableRate',
  label: 'Sessions reaching a real deliverable',
  unit: 'percent',
  direction: 'higher',
  current: .5,
  baseline: .4,
  ...overrides,
});

describe('outcome metric presentation', () => {
  it('prefers the catalog label and falls back to the wire label', () => {
    expect(outcomeMetricLabel(catalog, metric())).toBe('Livrables réels');
    expect(outcomeMetricLabel(bare, metric())).toBe('Sessions reaching a real deliverable');
    // A metric this build has never heard of still renders its server label.
    expect(outcomeMetricLabel(catalog, metric({ key: 'somethingNew', label: 'Something new' }))).toBe('Something new');
  });

  it('never renders an unmeasured value as zero', () => {
    expect(formatOutcomeMetric(catalog, null, 'usd')).toBe('Non mesuré');
    expect(formatOutcomeMetric(bare, null, 'usd')).toBe('Not measured');
    expect(formatOutcomeMetric(bare, 0, 'usd')).toBe('$0.00');
  });

  it('formats each unit in the reader’s language', () => {
    expect(formatOutcomeMetric(bare, .512, 'percent')).toBe('51%');
    expect(formatOutcomeMetric(bare, 45, 'seconds')).toBe('45 sec');
    expect(formatOutcomeMetric(bare, 120, 'seconds')).toBe('2.0 min');
    expect(formatOutcomeMetric(bare, 1, 'agents')).toBe('1 agent');
    expect(formatOutcomeMetric(bare, 3, 'agents')).toBe('3 agents');
  });

  it('reads a fall as an improvement when lower is better', () => {
    // The defect this module was extracted to fix: the canvas panel reported
    // EVERY movement on a "lower is better" metric as unfavourable, so halving
    // the cost per delivery was shown as a regression.
    const cheaper = metric({ key: 'costPerDelivery', unit: 'usd', direction: 'lower', current: 2, baseline: 4 });
    expect(compareOutcomeMetric(bare, cheaper).favorable).toBe(true);
    const dearer = metric({ key: 'costPerDelivery', unit: 'usd', direction: 'lower', current: 6, baseline: 4 });
    expect(compareOutcomeMetric(bare, dearer).favorable).toBe(false);
  });

  it('says nothing rather than guessing when there is no baseline', () => {
    expect(compareOutcomeMetric(bare, metric({ baseline: null })).favorable).toBeNull();
    expect(compareOutcomeMetric(bare, metric({ current: null })).delta).toBeNull();
  });

  it('passes ICU values through the catalog instead of patching the string after', () => {
    expect(compareOutcomeMetric(catalog, metric()).label).toBe('↗ 10 pts par rapport à la référence');
  });

  it('leads with whatever the server flagged as the north star', () => {
    const metrics = [metric(), metric({ key: 'gradedProofRate', northStar: true })];
    expect(northStarMetric(metrics)?.key).toBe('gradedProofRate');
    // An older payload names it by key instead of flagging it.
    expect(northStarMetric([metric({ key: 'gradedProofRate' })], 'gradedProofRate')?.key).toBe('gradedProofRate');
    expect(northStarMetric([metric()])).toBeNull();
  });

  it('groups by family in method order and never drops a metric', () => {
    const metrics = [
      metric({ key: 'correlationCoverage', family: 'integrity' }),
      metric({ key: 'gradedProofRate', family: 'measure' }),
      metric({ key: 'timeToProofChoice', family: 'read-prove' }),
      metric({ key: 'mystery' }),
    ];
    const groups = groupOutcomeMetrics(metrics, [{ key: 'measure', label: 'Measure' }]);
    expect(groups.map((group) => group.family.key)).toEqual(['read-prove', 'measure', 'integrity', 'unfiled']);
    expect(groups.flatMap((group) => group.metrics)).toHaveLength(metrics.length);
    // A known family uses the server's own wording as the fallback heading.
    expect(groups[1]!.family.label).toBe('Measure');
  });
});
