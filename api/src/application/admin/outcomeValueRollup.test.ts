import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { getOutcomeValueRollup } from './outcomeValueRollup';

describe('getOutcomeValueRollup', () => {
  it('compares equal periods and returns content-free platform breakdowns', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ sessionCount: 20, deliveredSessions: 12, deliverableRate: .6, timeToArtifact: 80, collaborationRate: .7, correlationCoverage: .95 }] })
      .mockResolvedValueOnce({ rows: [{ sessionCount: 10, deliveredSessions: 4, deliverableRate: .4, timeToArtifact: 120, collaborationRate: .5, correlationCoverage: .8 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-08-01', sessions: 3, deliveries: 2 }] })
      .mockResolvedValueOnce({ rows: [{ tenantId: 7, tenantName: 'Example', sessions: 20, deliveries: 12 }] })
      .mockResolvedValueOnce({ rows: [{ projectId: 9, projectName: 'Launch', tenantId: 7, tenantName: 'Example', sessions: 8, deliveries: 6 }] });
    const db = { execute } as unknown as Db;

    const result = await getOutcomeValueRollup(db, { days: 30 });

    expect(result.scope).toBe('platform');
    expect(result.sampleSize).toBe(20);
    expect(result.deliveredSessions).toBe(12);
    expect(result.metrics.find((metric) => metric.key === 'deliverableRate')).toMatchObject({ current: .6, baseline: .4, direction: 'higher' });
    expect(result.trends).toEqual([{ day: '2026-08-01', sessions: 3, deliveries: 2 }]);
    expect(result.tenants[0]).toMatchObject({ tenantId: 7, deliveries: 12 });
    expect(result.projects[0]).toMatchObject({ projectId: 9, deliveries: 6 });
    expect(result.privacy).toEqual({ contentFree: true, minimumExternalCohort: 10, externalClaimsEligible: true });
  });

  it('suppresses external claims for cohorts below the privacy threshold', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ sessionCount: 4, deliveredSessions: 1 }] })
      .mockResolvedValueOnce({ rows: [{ sessionCount: 3, deliveredSessions: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getOutcomeValueRollup({ execute } as unknown as Db, { days: 30, tenantId: 2 });

    expect(result.scope).toBe('tenant');
    expect(result.privacy.externalClaimsEligible).toBe(false);
  });
});
