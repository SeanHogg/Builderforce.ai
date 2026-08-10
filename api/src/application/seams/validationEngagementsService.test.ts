import { describe, expect, it } from 'vitest';
import { fetchValidationEngagements } from './validationEngagementsService';

function makeDb(resultSets: unknown[][]) {
  let call = 0;
  return {
    select: () => {
      const result = resultSets[call++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'innerJoin', 'leftJoin', 'groupBy']) chain[method] = () => chain;
      chain.limit = async () => result;
      return chain;
    },
  } as any;
}

describe('fetchValidationEngagements', () => {
  it('returns an available=false local result when no engagement exists', async () => {
    expect(await fetchValidationEngagements(makeDb([[], [], []]), { tenantId: 1, segmentId: 'seg' }))
      .toEqual({ available: false, source: 'builderforce', engagements: [] });
  });

  it('combines validation results, dashboards and feedback collectors', async () => {
    const result = await fetchValidationEngagements(makeDb([
      [{ id: 'result-1', name: 'Customers need alerts', kind: 'interview', status: 'validated' }],
      [{ id: 7, name: 'MVP validation', status: 'running' }],
      [{ id: 'collector-1', name: 'Product feedback', enabled: true, responses: 12 }],
    ]), { tenantId: 4, segmentId: 'seg-4' });

    expect(result).toEqual({
      available: true,
      source: 'builderforce',
      engagements: [
        { id: 'result-1', name: 'Customers need alerts', kind: 'interview', status: 'validated' },
        { id: 'dashboard:7', name: 'MVP validation', kind: 'dashboard', status: 'running' },
        { id: 'collector-1', name: 'Product feedback', kind: 'feedback_collector', status: 'active', responses: 12 },
      ],
    });
  });
});
