import { describe, expect, it } from 'vitest';
import { summarizeRunAnomalies, RUN_ANOMALY_EXAMPLES, type RunAnomalyRun } from './runAnomalyIssues';

/**
 * `run.anomaly` read as issues. The detector is the engine's and runs for real here —
 * these pin how this lens READS it: prequential scoring, high side only, one issue per
 * reason metric, the median of earlier runs as the "typical" estimate.
 */

let seq = 0;
const run = (over: Partial<RunAnomalyRun> = {}): RunAnomalyRun => {
  seq++;
  // A normal run: ~$0.50, ~60 s, no tool failures, with a small wobble.
  const wobble = 1 + ((seq % 5) - 2) * 0.04;
  return {
    executionId: seq,
    taskId: 100 + seq,
    model: 'anthropic/claude-sonnet-4',
    at: Date.UTC(2026, 9, 1) + seq * 60_000,
    costUsd: 0.5 * wobble,
    durationMs: 60_000 * wobble,
    toolFailures: 0,
    ...over,
  };
};

const normal = (n: number) => Array.from({ length: n }, () => run());

describe('summarizeRunAnomalies', () => {
  it('scores nothing below the task minimum — no history, no verdict', () => {
    const r = summarizeRunAnomalies(normal(4));
    expect(r.scored).toBe(0);
    expect(r.flagged).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.minRuns).toBe(5);
  });

  it('flags a cost, a duration and a tool-failure outlier, each under its own reason', () => {
    const history = normal(12);
    const costly = run({ costUsd: 6 });
    const slow = run({ durationMs: 25 * 60_000 });
    const failing = run({ toolFailures: 6 });
    const r = summarizeRunAnomalies([...history, costly, ...normal(2), slow, ...normal(2), failing]);

    const byMetric = Object.fromEntries(r.issues.map((i) => [i.metric, i]));
    expect(byMetric.cost?.examples.map((e) => e.executionId)).toContain(costly.executionId);
    expect(byMetric.duration?.examples.map((e) => e.executionId)).toContain(slow.executionId);
    expect(byMetric.toolFailures?.examples.map((e) => e.executionId)).toContain(failing.executionId);
    // Normal runs stay normal.
    const flaggedIds = r.issues.flatMap((i) => i.examples.map((e) => e.executionId));
    for (const h of history) expect(flaggedIds).not.toContain(h.executionId);
  });

  it('reports the typical value as the median of the runs BEFORE the outlier, and the excess cost', () => {
    const history = normal(10);
    const costly = run({ costUsd: 8 });
    const r = summarizeRunAnomalies([...history, costly]);
    const issue = r.issues.find((i) => i.metric === 'cost')!;
    const example = issue.examples[0]!;
    expect(example.value).toBe(8);
    expect(example.typical).toBeCloseTo(0.5, 1);
    expect(example.score).toBeGreaterThanOrEqual(1);
    expect(issue.excessCostUsd).toBeGreaterThan(7);
    expect(issue.sharePct).toBeCloseTo((1 / r.scored) * 100, 0);
  });

  it('never flags a run that is out of range only on the LOW side', () => {
    const cheap = run({ costUsd: 0.001, durationMs: 500 });
    const r = summarizeRunAnomalies([...normal(12), cheap]);
    expect(r.issues.flatMap((i) => i.examples.map((e) => e.executionId))).not.toContain(cheap.executionId);
  });

  it('keeps only the worst few runs per issue as examples, ranked by score', () => {
    const runs: RunAnomalyRun[] = normal(12);
    for (const cost of [5, 9, 7, 6, 8]) runs.push(run({ costUsd: cost }), ...normal(3));
    const issue = summarizeRunAnomalies(runs).issues.find((i) => i.metric === 'cost')!;
    expect(issue.examples.length).toBeLessThanOrEqual(RUN_ANOMALY_EXAMPLES);
    const scores = issue.examples.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
