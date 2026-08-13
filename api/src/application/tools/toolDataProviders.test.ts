import { describe, it, expect } from 'vitest';
import { scoreAgenticMaturityData, hasDataProvider, type MaturityDataInputs } from './toolDataProviders';
import { TOOLS } from './toolDefinitions';

describe('hasDataProvider', () => {
  it('offers a data-driven mode only to the tools with a registered provider', () => {
    expect(hasDataProvider('agentic-maturity')).toBe(true);
    expect(hasDataProvider('ticket-role-coverage')).toBe(true);
    expect(hasDataProvider('dora-quickcheck')).toBe(true);
    expect(hasDataProvider('ai-cost-estimator')).toBe(true);
    expect(hasDataProvider('nonexistent')).toBe(false);
  });

  /**
   * Any tool whose `about` copy tells the reader it can be scored from their real
   * data MUST have a provider. Two of these shipped promising it with nothing
   * behind them, so the promise is now pinned rather than trusted — a new tool
   * that makes the claim fails here until its provider exists.
   */
  it('backs every "score from your real data" promise with a provider', () => {
    const claims = /sign in to (?:score|replace)/i;
    const broken = TOOLS
      .filter((tool) => claims.test(tool.about))
      .filter((tool) => !hasDataProvider(tool.id))
      .map((tool) => tool.id);
    expect(broken).toEqual([]);
  });
});

describe('scoreAgenticMaturityData', () => {
  it('maps strong telemetry to a high level and an empty plan', () => {
    const inputs: MaturityDataInputs = {
      delivery: { avgCycleTimeHours: 12, reworkRate: 0.02, completed: 40 },
      devops: { deploysPerWeek: 10, changeFailureRate: 0.1, mttrHours: 2, total: 20 },
      quality: { ciGreenRate: 0.95, avgScore: 0.8, runs: 30 },
      projectManagement: { completed: 40, avgHygiene: 0.9 },
      agenticOps: { runs: 60, avgScore: 0.75, mergeRate: 0.6 },
    };
    const r = scoreAgenticMaturityData(inputs);
    expect(r.score).toBe(5);
    expect(r.headline).toContain('Optimizing');
    // 6 practice metrics (governance is "self-assessment only").
    expect(r.metrics).toHaveLength(6);
    expect(r.metrics.find((m) => m.label === 'Governance & Security')?.value).toBe('Self-assessment only');
    // All measured practices at 5 → nothing to advance.
    expect(r.recommendations).toHaveLength(0);
  });

  it('orders the plan lowest-maturity-first and reuses the tool recommendations', () => {
    const inputs: MaturityDataInputs = {
      delivery: { avgCycleTimeHours: 400, reworkRate: 0.4, completed: 10 }, // level 2
      devops: { deploysPerWeek: 3, changeFailureRate: 0.1, mttrHours: 5, total: 10 }, // level 4
      quality: null,
      projectManagement: null,
      agenticOps: null,
    };
    const r = scoreAgenticMaturityData(inputs);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0]!.title).toContain('Software Delivery'); // lowest first
  });

  it('returns "not enough telemetry" when no signal is present', () => {
    const r = scoreAgenticMaturityData({ delivery: null, devops: null, quality: null, projectManagement: null, agenticOps: null });
    expect(r.score).toBeNull();
    expect(r.headline).toMatch(/telemetry/i);
  });
});
