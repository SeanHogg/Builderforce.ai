import { describe, expect, it } from 'vitest';
import { COST_METRIC_GROUPS, isCostMetricGroupBy } from './costMetricGroups';

describe('cost metric groupings — model and pipeline route', () => {
  it('groups by the served model and by the run\'s pipeline route', () => {
    expect(isCostMetricGroupBy('model')).toBe(true);
    expect(isCostMetricGroupBy('route')).toBe(true);
    expect(COST_METRIC_GROUPS.model.key).toContain('u.model');
    expect(COST_METRIC_GROUPS.route.key).toContain('u.pipeline_route');
    expect(COST_METRIC_GROUPS.route.key).toContain("'unattributed'");
  });
});

describe('cost metric grouping — on-device utility (PRD 42 · F)', () => {
  it('splits utility calls by serving engine, with cloud and other buckets', () => {
    expect(isCostMetricGroupBy('utilityEngine')).toBe(true);
    const key = COST_METRIC_GROUPS.utilityEngine.key;
    expect(key).toContain("u.role = 'utility'");
    expect(key).toContain("split_part(u.model, '/', 2)");
    expect(key).toContain("'cloud'");
    expect(key).toContain("'other'");
  });
});
