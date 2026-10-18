import { describe, it, expect, vi } from 'vitest';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('./metricRegistry', () => ({ isMetricKey: (k: string) => k === 'tickets.open' }));

import {
  addDashboardWidget,
  cleanWidgetKey,
  createSavedDashboard,
  listSavedDashboards,
  recordDashboardQuery,
  updateDashboardWidget,
} from './savedDashboards';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb as sharedFakeDb } from '../../../test/fakeDb';

/** The shared Drizzle double, plus the payloads written by inserts / updates in order. */
function fakeDb(results: Array<unknown[] | Error>): { db: Db; written: () => unknown[] } {
  const fake = sharedFakeDb(results);
  return {
    db: fake as unknown as Db,
    written: () => fake.calls.filter((c) => c.payload !== undefined).map((c) => c.payload),
  };
}

describe('savedDashboards', () => {
  it('cleanWidgetKey bounds and trims', () => {
    expect(cleanWidgetKey('  okr.health ')).toBe('okr.health');
    expect(cleanWidgetKey('')).toBeNull();
    expect(cleanWidgetKey('x'.repeat(97))).toBeNull();
    expect(cleanWidgetKey(5)).toBeNull();
  });

  it('createSavedDashboard rejects a blank name without touching the db', async () => {
    const { db, written } = fakeDb([]);
    const r = await createSavedDashboard(db, { tenantId: 1, segmentId: 's', name: '  ' });
    expect(r).toEqual({ ok: false, status: 400, error: 'name is required' });
    expect(written()).toHaveLength(0);
  });

  it('createSavedDashboard returns the row with an empty widget list', async () => {
    const { db, written } = fakeDb([[{ id: 7, name: 'Ops' }]]);
    const r = await createSavedDashboard(db, { tenantId: 1, segmentId: 's', name: ' Ops ' });
    expect(r).toEqual({ ok: true, row: { id: 7, name: 'Ops', widgets: [] } });
    expect(written()[0]).toMatchObject({ tenantId: 1, segmentId: 's', name: 'Ops', isDefault: false });
  });

  it('listSavedDashboards groups widgets under their own dashboard only', async () => {
    const { db } = fakeDb([
      [{ id: 1 }, { id: 2 }],
      [{ id: 10, dashboardId: 1 }, { id: 11, dashboardId: 2 }, { id: 12, dashboardId: 99 }],
    ]);
    const out = await listSavedDashboards(db, 1, 's');
    expect(out.map((d) => d.widgets.map((w) => w.id))).toEqual([[10], [11]]);
  });

  it('addDashboardWidget 404s a dashboard the tenant does not own', async () => {
    const { db } = fakeDb([[]]);
    const r = await addDashboardWidget(db, 1, 5, { metricKey: 'tickets.open' });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it('addDashboardWidget enforces the metric whitelist (the MCP tool used to skip it)', async () => {
    const { db } = fakeDb([[{ id: 5 }]]);
    const r = await addDashboardWidget(db, 1, 5, { metricKey: 'drop table' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('addDashboardWidget normalises an unknown viz to stat', async () => {
    const { db, written } = fakeDb([[{ id: 5 }], [{ id: 20 }]]);
    const r = await addDashboardWidget(db, 1, 5, { metricKey: 'tickets.open', viz: 'pie', position: 2.7 });
    expect(r.ok).toBe(true);
    expect(written()[0]).toMatchObject({ metricKey: 'tickets.open', widgetKey: null, viz: 'stat', position: 2 });
  });

  it('updateDashboardWidget rejects an empty patch and an unknown metric', async () => {
    const { db } = fakeDb([]);
    expect(await updateDashboardWidget(db, 1, 5, 6, {})).toMatchObject({ ok: false, error: 'nothing to update' });
    expect(await updateDashboardWidget(db, 1, 5, 6, { metricKey: 'nope' })).toMatchObject({ ok: false, error: 'unknown metric_key' });
  });

  it('recordDashboardQuery reports, never throws, a failed history insert', async () => {
    const { db } = fakeDb([new Error('db down')]);
    await expect(recordDashboardQuery(db, { tenantId: 1, question: 'q', matchedMetric: null })).resolves.toBeUndefined();
    expect(reportCaughtError).toHaveBeenCalled();
  });
});
