import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { getDispositionReport } from './backlogDispositionPass';

describe('getDispositionReport', () => {
  it('takes total/pending/applied/byDisposition from grouped COUNTs, not from the limited row list', async () => {
    const db = fakeDb([
      [{ taskId: 1, title: 't', status: 'backlog', disposition: 'keep', appliedAt: null }], // 1 listed row (limit)
      [
        { disposition: 'keep', applied: false, n: '1500' },
        { disposition: 'close', applied: true, n: 300 },
        { disposition: 'close', applied: false, n: 200 },
      ],
      [{ n: '42' }],
    ]);
    const r = await getDispositionReport(db as unknown as Db, { tenantId: 1 }, 1);
    expect(r).toMatchObject({
      total: 2000, applied: 300, pending: 1700, undisposed: 42,
      byDisposition: { keep: 1500, close: 500, consolidate: 0, quarantine: 0 },
    });
    expect(r.rows).toHaveLength(1);
    expect(db.calls).toHaveLength(3);
  });
});
