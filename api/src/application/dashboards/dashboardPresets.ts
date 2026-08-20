/**
 * Declared dashboard presets — a curated dashboard a manager gets by asking, not
 * by building.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * `/insights` opens on your personal pins, which for a new manager is nothing at
 * all, and the only other route to a shared view is: create a dashboard, then pick
 * eight widgets out of a registry of a hundred and forty, one at a time, knowing
 * in advance which eight are the ones an executive reads. The widgets existed and
 * the composer existed; what did not exist was the OPINION about which six things
 * an executive dashboard is made of. So the surface shipped empty and stayed
 * empty, and the answer to "what should I be watching?" was "whatever you happen
 * to have pinned".
 *
 * A preset is that opinion, declared in source: a name plus an ordered list of
 * tiles, each either a whitelisted metric key or a registry widget id. Materialising
 * one writes ordinary `saved_dashboards` + `dashboard_widgets` rows — the result is
 * a normal dashboard the manager can then edit, rename or delete. Nothing about a
 * dashboard remembers it came from a preset, which is deliberate: a preset is a
 * starting point, not a template that fights you when you change it.
 *
 * ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
 * Applying a preset twice must not double its widgets. The button that materialises
 * it is a button, and a button gets double-clicked; a manager who hits it again
 * next month expects the dashboard back, not sixteen tiles. So the apply is a
 * RECONCILE against what is already there, keyed on the tile's identity
 * (`widget_key` or `metric_key`), and {@link planPresetWidgets} — the pure half —
 * is where that decision is made and tested.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { dashboardWidgets, savedDashboards } from '../../infrastructure/database/schema';
import { isMetricKey } from './metricRegistry';
import type { ComposableWidgetId } from './widgetIds';

/** The visualization for a scalar tile — mirrors the route's ALLOWED_VIZ. */
export type PresetViz = 'stat' | 'bar' | 'line' | 'gauge';

/**
 * One tile. EITHER a registry widget (a rich client-rendered card) OR a whitelisted
 * scalar metric — the same either/or the `dashboard_widgets` row enforces.
 */
export type PresetTile =
  | { widgetKey: ComposableWidgetId; title: string }
  | { metricKey: string; viz: PresetViz; title: string };

export interface DashboardPreset {
  /** Stable name for the materialised dashboard — also the idempotence key. */
  name: string;
  /** Ordered tiles; the index becomes `dashboard_widgets.position`. */
  tiles: PresetTile[];
}

/**
 * THE EXECUTIVE PRESET — breach status, delivery/at-risk, MTTR, spend,
 * over-allocation, error resolution.
 *
 * Six subjects, eight tiles: the two that carry a number an executive quotes
 * (open production incidents, month-to-date spend) lead as scalars, each followed
 * by the chart that shows whether it is moving. The rest are the registry cards
 * that already answer their subject better than a scalar could.
 */
export const DASHBOARD_PRESETS = {
  executive: {
    name: 'Executive',
    tiles: [
      // Breach status — the number first, then the incident board behind it.
      { metricKey: 'quality.incidents', viz: 'stat', title: 'Breach status' },
      { widgetKey: 'inc.status', title: 'Incident status' },
      // Delivery / at-risk.
      { widgetKey: 'delivery.verdict', title: 'Delivery verdict' },
      // MTTR.
      { widgetKey: 'inc.mttr', title: 'Mean time to restore' },
      // Spend — scalar, then the trend that says whether it is accelerating.
      { metricKey: 'finance.spend', viz: 'stat', title: 'Spend (month to date)' },
      { widgetKey: 'finance.spend-trend', title: 'Spend trend' },
      // Over-allocation.
      { widgetKey: 'emp.over-allocated', title: 'Over-allocated members' },
      // Error resolution.
      { widgetKey: 'obs.quality-resolution', title: 'Error resolution' },
    ],
  },
} satisfies Record<string, DashboardPreset>;

export type PresetKey = keyof typeof DASHBOARD_PRESETS;

/** The preset keys a client may ask for (drives the UI and the route's guard). */
export function listPresetKeys(): PresetKey[] {
  return Object.keys(DASHBOARD_PRESETS) as PresetKey[];
}

/** THE GATE: a route param is a preset key only if it is declared here. */
export function isPresetKey(key: string): key is PresetKey {
  return Object.prototype.hasOwnProperty.call(DASHBOARD_PRESETS, key);
}

/** The identity a tile is reconciled on — one tile per subject, per dashboard. */
export function tileIdentity(tile: PresetTile): string {
  return 'widgetKey' in tile ? `w:${tile.widgetKey}` : `m:${tile.metricKey}`;
}

/** The same identity, read off a row that is already in the table. */
export function rowIdentity(row: { widgetKey: string | null; metricKey: string | null }): string {
  return row.widgetKey ? `w:${row.widgetKey}` : `m:${row.metricKey ?? ''}`;
}

/**
 * PURE: which of a preset's tiles are missing from a dashboard, and at what
 * position each should land.
 *
 * Position is the tile's index in the DECLARED order, not a running counter over
 * what was inserted, so re-applying a preset onto a partially built dashboard puts
 * each tile back where the preset always meant it to go rather than appending it
 * to the end.
 */
export function planPresetWidgets(
  preset: DashboardPreset,
  existing: { widgetKey: string | null; metricKey: string | null }[],
): { tile: PresetTile; position: number }[] {
  const have = new Set(existing.map(rowIdentity));
  return preset.tiles
    .map((tile, position) => ({ tile, position }))
    .filter(({ tile }) => !have.has(tileIdentity(tile)));
}

export interface ApplyPresetResult {
  dashboardId: number;
  /** True when the dashboard itself was created by this call (vs. already present). */
  createdDashboard: boolean;
  /** How many tiles this call inserted — 0 on a re-apply that changed nothing. */
  addedWidgets: number;
}

/**
 * Materialise a preset for a tenant, idempotently.
 *
 * The dashboard is matched by (tenant, segment, name), so a second call finds the
 * first call's dashboard instead of creating a twin, and only the tiles that are
 * genuinely absent are inserted. A tile the manager deleted on purpose DOES come
 * back on a re-apply — that is what re-applying a preset means, and it is the
 * reason the affordance says "create" rather than "sync".
 */
export async function applyDashboardPreset(
  db: Db,
  tenantId: number,
  segmentId: string,
  presetKey: PresetKey,
  createdBy: string | null,
): Promise<ApplyPresetResult> {
  const preset: DashboardPreset = DASHBOARD_PRESETS[presetKey];

  // Scoped by (tenant, segment, name) — the SAME scope `GET /dashboards` lists on,
  // so the dashboard this returns is the one the manager will actually see. A
  // lookup on tenant alone would "find" a dashboard in a segment they cannot open
  // and then report success while their own segment stayed empty.
  const [existingDashboard] = await db
    .select({ id: savedDashboards.id })
    .from(savedDashboards)
    .where(and(
      eq(savedDashboards.tenantId, tenantId),
      eq(savedDashboards.segmentId, segmentId),
      eq(savedDashboards.name, preset.name),
    ));

  let dashboardId: number;
  let createdDashboard = false;
  if (existingDashboard) {
    dashboardId = existingDashboard.id;
  } else {
    const [row] = await db
      .insert(savedDashboards)
      .values({ tenantId, segmentId, name: preset.name, isDefault: false, createdBy })
      .returning({ id: savedDashboards.id });
    if (!row) throw new Error('preset dashboard insert returned no row');
    dashboardId = row.id;
    createdDashboard = true;
  }

  const existingWidgets = createdDashboard
    ? []
    : await db
        .select({ widgetKey: dashboardWidgets.widgetKey, metricKey: dashboardWidgets.metricKey })
        .from(dashboardWidgets)
        .where(and(
          eq(dashboardWidgets.tenantId, tenantId),
          eq(dashboardWidgets.dashboardId, dashboardId),
        ));

  const missing = planPresetWidgets(preset, existingWidgets);
  if (missing.length) {
    await db.insert(dashboardWidgets).values(missing.map(({ tile, position }) => ({
      tenantId,
      dashboardId,
      metricKey: 'metricKey' in tile ? tile.metricKey : null,
      widgetKey: 'widgetKey' in tile ? tile.widgetKey : null,
      viz: 'widgetKey' in tile ? 'widget' : tile.viz,
      title: tile.title,
      config: {} as Record<string, unknown>,
      position,
    })));
  }

  return { dashboardId, createdDashboard, addedWidgets: missing.length };
}

/**
 * Every scalar key a preset names is a registry key. Asserted by test rather than
 * only by review, because a preset that names a retired metric materialises a tile
 * that renders "unknown metric" and nothing upstream would have complained.
 */
export function presetMetricKeysAreWhitelisted(preset: DashboardPreset): boolean {
  return preset.tiles.every((t) => !('metricKey' in t) || isMetricKey(t.metricKey));
}
