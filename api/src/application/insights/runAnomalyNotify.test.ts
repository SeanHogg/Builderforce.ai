import { describe, expect, it } from 'vitest';
import { newRunAnomalyIssues, runAnomalyAlertMessage } from './runAnomalyNotify';
import type { RunAnomalyIssue } from './runAnomalyIssues';

const issue = (over: Partial<RunAnomalyIssue> = {}): RunAnomalyIssue => ({
  metric: 'cost', runs: 2, sharePct: 5, excessCostUsd: 12.5, latestFlaggedAt: '2026-10-22T08:00:00.000Z',
  examples: [{ executionId: 41, taskId: 1, model: 'm', at: '2026-10-22T08:00:00.000Z', value: 9, typical: 0.5, score: 3 }],
  ...over,
});

describe('runAnomalyNotify', () => {
  it('keeps only issues with a flagged run newer than the last tick', () => {
    const since = Date.parse('2026-10-22T00:00:00Z');
    const fresh = newRunAnomalyIssues([issue(), issue({ metric: 'duration', latestFlaggedAt: '2026-10-20T00:00:00.000Z' })], since);
    expect(fresh.map((i) => i.metric)).toEqual(['cost']);
  });

  it('summarises each issue with its example runs and the estimated excess', () => {
    expect(runAnomalyAlertMessage([issue(), issue({ metric: 'toolFailures', runs: 1, examples: [], excessCostUsd: 0 })]))
      .toBe('Agent runs outside their normal range: cost (2 runs, e.g. #41; ≈$12.50 above typical); tool failures (1 run; ≈$0.00 above typical).');
  });
});
