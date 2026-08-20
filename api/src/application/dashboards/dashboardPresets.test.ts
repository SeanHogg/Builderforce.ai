import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PRESETS,
  applyDashboardPreset,
  isPresetKey,
  listPresetKeys,
  planPresetWidgets,
  presetMetricKeysAreWhitelisted,
  tileIdentity,
} from './dashboardPresets';
import { COMPOSABLE_WIDGET_IDS } from './widgetIds';
import { dashboardWidgets, savedDashboards } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Preset materialisation, with IDEMPOTENCE as the property under test.
 *
 * The affordance that calls this is a button, and a button gets double-clicked. A
 * preset that appends rather than reconciles turns one accidental second click
 * into a dashboard with sixteen tiles and two of everything — recoverable only by
 * deleting eight widgets one at a time, which is precisely the work the preset
 * existed to save.
 */

const SEGMENT = '00000000-0000-0000-0000-000000000001';

type DashboardRow = { id: number; tenantId: number; segmentId: string; name: string };
type WidgetRow = { tenantId: number; dashboardId: number; widgetKey: string | null; metricKey: string | null; viz: string; title: string | null; position: number };

/**
 * An in-memory stand-in for the two tables this touches. Filtering is by TABLE,
 * not by predicate — drizzle conditions are opaque objects — which is sound here
 * because every test uses a single tenant and segment, so "every row of the table"
 * and "every row in scope" are the same set.
 */
function fakeDb() {
  const dashboards: DashboardRow[] = [];
  const widgets: WidgetRow[] = [];
  let nextId = 1;

  const rowsFor = (table: unknown) => (table === savedDashboards ? dashboards : widgets);

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => rowsFor(table).slice(),
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        const list = Array.isArray(vals) ? vals : [vals];
        const inserted = list.map((v) => {
          if (table === savedDashboards) {
            const row = { id: nextId++, ...(v as Omit<DashboardRow, 'id'>) };
            dashboards.push(row);
            return row;
          }
          const row = v as WidgetRow;
          widgets.push(row);
          return row;
        });
        // Drizzle's insert is awaitable with or without `.returning()`.
        return Object.assign(Promise.resolve(inserted), { returning: async () => inserted });
      },
    }),
  } as unknown as Db;

  return { db, dashboards, widgets };
}

describe('the Executive preset', () => {
  it('names only whitelisted metric keys', () => {
    expect(presetMetricKeysAreWhitelisted(DASHBOARD_PRESETS.executive)).toBe(true);
  });

  it('names only declared widget ids (the frontend test covers that list)', () => {
    const declared = new Set<string>(COMPOSABLE_WIDGET_IDS);
    for (const tile of DASHBOARD_PRESETS.executive.tiles) {
      if ('widgetKey' in tile) expect(declared.has(String(tile.widgetKey)), String(tile.widgetKey)).toBe(true);
    }
  });

  it('covers the six subjects it promises', () => {
    // Breach status · delivery/at-risk · MTTR · spend · over-allocation · error
    // resolution. Asserted by identity so renaming a tile's title cannot quietly
    // drop a subject.
    const ids = DASHBOARD_PRESETS.executive.tiles.map(tileIdentity);
    for (const required of [
      'm:quality.incidents', 'w:inc.status',       // breach status
      'w:delivery.verdict',                        // delivery / at-risk
      'w:inc.mttr',                                // MTTR
      'm:finance.spend', 'w:finance.spend-trend',  // spend
      'w:emp.over-allocated',                      // over-allocation
      'w:obs.quality-resolution',                  // error resolution
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it('gives every tile a distinct identity', () => {
    const ids = DASHBOARD_PRESETS.executive.tiles.map(tileIdentity);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('isPresetKey — the gate', () => {
  it('accepts only the declared keys', () => {
    for (const key of listPresetKeys()) expect(isPresetKey(key)).toBe(true);
    for (const bad of ['Executive', 'exec', '__proto__', 'constructor', '']) {
      expect(isPresetKey(bad), bad).toBe(false);
    }
  });
});

describe('planPresetWidgets', () => {
  it('plans every tile against an empty dashboard, at its declared position', () => {
    const plan = planPresetWidgets(DASHBOARD_PRESETS.executive, []);
    expect(plan).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
    expect(plan.map((p) => p.position)).toEqual(plan.map((_, i) => i));
  });

  it('plans NOTHING when every tile is already present', () => {
    const existing = DASHBOARD_PRESETS.executive.tiles.map((t) => ({
      widgetKey: 'widgetKey' in t ? String(t.widgetKey) : null,
      metricKey: 'metricKey' in t ? String(t.metricKey) : null,
    }));
    expect(planPresetWidgets(DASHBOARD_PRESETS.executive, existing)).toEqual([]);
  });

  it('plans only the gap, and keeps each tile at its DECLARED position', () => {
    // A partially built dashboard: everything but the last two tiles. Positions
    // must come from the preset's order, not from a counter over the insert —
    // otherwise a repaired dashboard lays out differently from a fresh one.
    const tiles = DASHBOARD_PRESETS.executive.tiles;
    const existing = tiles.slice(0, -2).map((t) => ({
      widgetKey: 'widgetKey' in t ? String(t.widgetKey) : null,
      metricKey: 'metricKey' in t ? String(t.metricKey) : null,
    }));
    const plan = planPresetWidgets(DASHBOARD_PRESETS.executive, existing);
    expect(plan.map((p) => p.position)).toEqual([tiles.length - 2, tiles.length - 1]);
  });

  it('ignores widgets the manager added that the preset does not know about', () => {
    const plan = planPresetWidgets(DASHBOARD_PRESETS.executive, [{ widgetKey: 'core.projects', metricKey: null }]);
    expect(plan).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
  });
});

describe('applyDashboardPreset', () => {
  it('materialises the dashboard and every tile on a first apply', async () => {
    const { db, dashboards, widgets } = fakeDb();
    const result = await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');

    expect(result.createdDashboard).toBe(true);
    expect(result.addedWidgets).toBe(DASHBOARD_PRESETS.executive.tiles.length);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0]).toMatchObject({ tenantId: 7, segmentId: SEGMENT, name: 'Executive' });
    expect(widgets).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
    // Exactly one of metricKey / widgetKey is set on every row — the either/or the
    // dashboard_widgets row is built around.
    for (const w of widgets) expect(Number(!!w.widgetKey) + Number(!!w.metricKey)).toBe(1);
    for (const w of widgets) expect(w.viz).toBe(w.widgetKey ? 'widget' : 'stat');
  });

  it('is idempotent: a second apply adds nothing and creates no twin', async () => {
    const { db, dashboards, widgets } = fakeDb();
    const first = await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    const second = await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');

    expect(second.createdDashboard).toBe(false);
    expect(second.addedWidgets).toBe(0);
    expect(second.dashboardId).toBe(first.dashboardId);
    expect(dashboards).toHaveLength(1);
    expect(widgets).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
  });

  it('survives a double-click: ten applies leave one dashboard and one set of tiles', async () => {
    const { db, dashboards, widgets } = fakeDb();
    for (let i = 0; i < 10; i++) await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    expect(dashboards).toHaveLength(1);
    expect(widgets).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
  });

  it('restores only the tiles a manager removed', async () => {
    const { db, widgets } = fakeDb();
    await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    widgets.splice(0, 2); // the manager deleted two tiles

    const again = await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    expect(again.addedWidgets).toBe(2);
    expect(widgets).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length);
  });

  it('leaves a manager\'s own additions alone', async () => {
    const { db, widgets } = fakeDb();
    const { dashboardId } = await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    widgets.push({ tenantId: 7, dashboardId, widgetKey: 'core.projects', metricKey: null, viz: 'widget', title: 'Mine', position: 99 });

    await applyDashboardPreset(db, 7, SEGMENT, 'executive', 'user-1');
    expect(widgets.filter((w) => w.widgetKey === 'core.projects')).toHaveLength(1);
    expect(widgets).toHaveLength(DASHBOARD_PRESETS.executive.tiles.length + 1);
  });
});
