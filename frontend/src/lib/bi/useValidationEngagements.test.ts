import { describe, expect, it } from 'vitest';
import { countEngagementKinds } from './useValidationEngagements';

describe('countEngagementKinds', () => {
  it('groups dashboards and collectors, and counts every validation type as an experiment', () => {
    expect(countEngagementKinds({
      available: true,
      source: 'builderforce',
      engagements: [
        { id: '1', kind: 'smoke_test' },
        { id: '2', kind: 'validation' },
        { id: '3' },
        { id: 'dashboard:4', kind: 'dashboard' },
        { id: '5', kind: 'feedback_collector', responses: 3 },
      ],
    })).toEqual({ validation: 3, dashboard: 1, feedback_collector: 1 });
  });

  it('is all zeroes before the read resolves', () => {
    expect(countEngagementKinds(null)).toEqual({ validation: 0, dashboard: 0, feedback_collector: 0 });
  });
});
