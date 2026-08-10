import { describe, expect, it } from 'vitest';
import { deriveRecommendations, type RuleInputs } from './recommendationsEngine';

function inputs(): RuleInputs {
  return {
    finance: {
      budgets: [],
      totals: { costPerMergedPrUsd: 150 },
    },
    priorFinance: {
      budgets: [],
      totals: { costPerMergedPrUsd: 100 },
    },
    engineering: {
      totals: { runs: 0, mergedRatePct: 0, degradedRatePct: 0 },
      byModel: [],
    },
    allocation: {
      byCategory: [],
      totals: { costUsd: 0, capitalizablePct: 0 },
    },
    dora: {
      windowDays: 30,
      deploymentFrequencyPerDay: 0,
      totalDeployments: 0,
      leadTimeHours: null,
      changeFailureRatePct: null,
      mttrHours: null,
      series: [],
    },
  } as unknown as RuleInputs;
}

describe('deriveRecommendations', () => {
  it('returns a specific, actionable recommendation linked to its source data', () => {
    const recommendations = deriveRecommendations(inputs());

    expect(recommendations).toHaveLength(1);
    const recommendation = recommendations[0];
    expect(recommendation).toBeDefined();
    if (!recommendation) throw new Error('Expected a cost recommendation');
    expect(recommendation).toMatchObject({
      key: 'cost.per_pr_spike',
      title: expect.stringContaining('50%'),
      action: { kind: 'navigate', href: '/insights/engineering' },
      links: [expect.objectContaining({ field: 'finance.cost_per_merged_pr' })],
      dataTrace: expect.arrayContaining([
        expect.objectContaining({ field: 'finance.cost_per_merged_pr_usd', value: '150', source: 'financeInsights' }),
        expect.objectContaining({ field: 'finance.prior_cost_per_merged_pr_usd', value: '100', source: 'financeInsights' }),
      ]),
    });
    expect(recommendation.title.length).toBeLessThanOrEqual(120);
    expect(recommendation.detail.length).toBeLessThanOrEqual(300);
    expect(recommendation.whyItMatters).toBeTruthy();
  });

  it('uses stable keys to deduplicate the same root cause', () => {
    const recommendations = deriveRecommendations(inputs());
    expect(new Set(recommendations.map((recommendation) => recommendation.key)).size).toBe(recommendations.length);
  });

  it('enforces API copy limits centrally', () => {
    const value = inputs();
    value.finance.budgets = [{
      status: 'over',
      scopeName: 'A'.repeat(180),
      forecastUsd: 200,
      limitUsd: 100,
      scopeKind: 'project',
      projectId: 7,
    }] as RuleInputs['finance']['budgets'];

    const recommendation = deriveRecommendations(value).find((item) => item.key === 'cost.budget_over');
    expect(recommendation?.title.length).toBeLessThanOrEqual(120);
    expect(recommendation?.detail.length).toBeLessThanOrEqual(300);
  });
});
