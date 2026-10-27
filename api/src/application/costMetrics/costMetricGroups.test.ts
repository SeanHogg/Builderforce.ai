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
