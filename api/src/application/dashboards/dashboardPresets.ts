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
import { DASHBOARD_VERTICALS, type DashboardVertical } from '@builderforce/creation-canvas-contract';
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

/**
 * THE FOUNDER LAYER (PRD 25) — the tiles every founder dashboard opens with,
 * whatever the vertical.
 *
 * Runway first, because it is the only number that can end the company, and the
 * three that produce it (cash, net burn, the date it reaches zero) directly
 * after. Then the founder's own position: ownership, the unallocated pool and
 * the cliffs landing inside a quarter — the facts a founder is asked for in
 * every board meeting and currently rebuilds in a spreadsheet each time.
 *
 * Declared once and spread into every vertical below, so \"what a founder sees\"
 * is one edit rather than eleven, and no vertical can silently drift off it.
 */
const FOUNDER_TILES: PresetTile[] = [
  { metricKey: 'finance.runwayMonths', viz: 'stat', title: 'Runway' },
  { metricKey: 'finance.cash', viz: 'stat', title: 'Cash on hand' },
  { metricKey: 'finance.netBurn', viz: 'stat', title: 'Net burn' },
  { metricKey: 'finance.cashZeroDate', viz: 'stat', title: 'Cash zero date' },
  { metricKey: 'equity.founderOwnership', viz: 'stat', title: 'Founder ownership' },
  { metricKey: 'equity.poolUnallocated', viz: 'stat', title: 'Unallocated option pool' },
  { metricKey: 'equity.cliffsDue90d', viz: 'stat', title: 'Cliffs due in 90 days' },
  { widgetKey: 'founder.runway-projection', title: 'Runway projection' },
  { widgetKey: 'founder.ownership', title: 'Ownership' },
];

/**
 * The VERTICAL presets — one per {@link DASHBOARD_VERTICALS}, built by DATA
 * rather than by a `switch` (PRD 25 §5).
 *
 * In this slice a vertical dashboard is the founder layer plus the peer-position
 * tile, which is already vertical-aware: the benchmark cohort was aligned to the
 * declared sector when the template installed it, so the same tile compares a
 * fintech against fintechs and a biotech against biotechs. The vertical-specific
 * KPI rows (ARR/NDR, CAC payback, trial-to-paid…) arrive in Slice D, and they
 * arrive as extra entries in this map — not as a branch anywhere else.
 */
const VERTICAL_TILES: PresetTile[] = [
  ...FOUNDER_TILES,
  { widgetKey: 'bench.position', title: 'Position vs peers' },
];

/**
 * Slice D — the §5.3 KPI tiles for the eight non-SaaS verticals, as DATA keyed by
 * vertical (no branch anywhere). Appended after the founder layer + peer tile, so
 * every vertical still opens with runway. Verticals absent here (saas, ai_ml) are
 * filled by their own slice and fall back to the base tiles.
 */
const VERTICAL_KPI_TILES: Partial<Record<DashboardVertical, PresetTile[]>> = {
  fintech: [
    { metricKey: 'payments.tpv', viz: 'stat', title: 'Total payment volume' },
    { metricKey: 'payments.takeRate', viz: 'stat', title: 'Take rate' },
    { metricKey: 'payments.fundedAccountRatio', viz: 'stat', title: 'Funded-account ratio' },
    { metricKey: 'payments.fraudLossBps', viz: 'stat', title: 'Fraud loss rate' },
    { metricKey: 'payments.payoutLatency', viz: 'stat', title: 'Payout latency' },
    { widgetKey: 'payments.volume', title: 'Volume and take rate' },
    { widgetKey: 'payments.risk', title: 'Fraud and payout risk' },
  ],
  healthtech: [
    { metricKey: 'clinical.reimbursementStatus', viz: 'stat', title: 'Reimbursement status' },
    { widgetKey: 'clinical.reimbursement', title: 'Reimbursement path' },
  ],
  medtech: [
    { metricKey: 'clinical.stage', viz: 'stat', title: 'Regulatory stage' },
    { metricKey: 'clinical.monthsToMilestone', viz: 'stat', title: 'Months to next milestone' },
    { metricKey: 'clinical.regulatorySpendPct', viz: 'stat', title: 'Regulatory spend share' },
    { metricKey: 'clinical.costPerDataPoint', viz: 'stat', title: 'Cost per clinical data point' },
    { metricKey: 'clinical.enrollmentRate', viz: 'stat', title: 'Enrollment vs plan' },
    { widgetKey: 'clinical.stage', title: 'Regulatory stage' },
    { widgetKey: 'clinical.reimbursement', title: 'Reimbursement path' },
    { widgetKey: 'clinical.trial-economics', title: 'Trial economics' },
  ],
  biotech: [
    { metricKey: 'clinical.stage', viz: 'stat', title: 'Development stage' },
    { metricKey: 'clinical.monthsToMilestone', viz: 'stat', title: 'Months to next readout' },
    { metricKey: 'clinical.costPerDataPoint', viz: 'stat', title: 'Cost per patient enrolled' },
    { metricKey: 'clinical.enrollmentRate', viz: 'stat', title: 'Enrollment vs plan' },
    { widgetKey: 'clinical.stage', title: 'Development stage' },
    { widgetKey: 'clinical.trial-economics', title: 'Trial economics' },
  ],
  climate_energy: [
    { metricKey: 'climate.unitCostVsIncumbent', viz: 'stat', title: 'Unit cost vs incumbent' },
    { metricKey: 'climate.tco2eAbated', viz: 'stat', title: 'tCO2e abated' },
    { metricKey: 'climate.capacityDeployed', viz: 'stat', title: 'Capacity deployed' },
    { metricKey: 'climate.offtakePipeline', viz: 'stat', title: 'Offtake pipeline' },
    { widgetKey: 'climate.cost-curve', title: 'Cost curve vs incumbent' },
    { widgetKey: 'climate.deployment', title: 'Deployment and offtake' },
  ],
  hardware_robotics: [
    { metricKey: 'hardware.productionStage', viz: 'stat', title: 'Production run stage' },
    { metricKey: 'hardware.bomCost', viz: 'stat', title: 'BOM cost' },
    { metricKey: 'hardware.grossMargin', viz: 'stat', title: 'Hardware gross margin' },
    { metricKey: 'hardware.backlog', viz: 'stat', title: 'Signed backlog' },
    { widgetKey: 'hardware.production-stage', title: 'Production run stage' },
    { widgetKey: 'hardware.margin-backlog', title: 'Margin and backlog' },
  ],
  cybersecurity: [
    { metricKey: 'security.pipelineCoverage', viz: 'stat', title: 'Pipeline coverage' },
    { metricKey: 'security.pocConversion', viz: 'stat', title: 'POC conversion' },
    { metricKey: 'security.timeToValue', viz: 'stat', title: 'Time to value' },
    { widgetKey: 'security.pipeline', title: 'Pipeline and POC' },
  ],
  marketplace: [
    { metricKey: 'market.gmv', viz: 'stat', title: 'GMV' },
    { metricKey: 'market.liquidity', viz: 'stat', title: 'Liquidity (fill rate)' },
    { metricKey: 'market.repeatRate', viz: 'stat', title: 'Repeat rate (90d)' },
    { metricKey: 'market.contributionPerOrder', viz: 'stat', title: 'Contribution per order' },
    { widgetKey: 'market.liquidity', title: 'Marketplace liquidity' },
    { widgetKey: 'market.unit-economics', title: 'Order unit economics' },
  ],
  // Slice B — SaaS and AI-native §5.3 tiles. Registry widgets the frontend renders.
  saas: [
    { widgetKey: 'growth.nrr', title: 'Net revenue retention' },
    { widgetKey: 'growth.grr', title: 'Gross revenue retention' },
    { widgetKey: 'growth.cac-payback', title: 'CAC payback' },
    { widgetKey: 'growth.ltv-cac', title: 'LTV:CAC' },
    { widgetKey: 'growth.ltv-tranches', title: 'LTV:CAC by tranche' },
  ],
  ai_ml: [
    { widgetKey: 'ai.inference-margin', title: 'Inference margin' },
    { widgetKey: 'ai.inference-efficiency', title: 'Inference efficiency' },
    { widgetKey: 'growth.nrr', title: 'Net revenue retention' },
    { widgetKey: 'growth.grr', title: 'Gross revenue retention' },
    { widgetKey: 'growth.ltv-cac', title: 'LTV:CAC' },
  ],
};

/** Display names, so a materialised dashboard is titled the way a founder says it. */
const VERTICAL_NAMES: Record<DashboardVertical, string> = {
  ai_ml: 'AI-native',
  saas: 'SaaS',
  fintech: 'FinTech',
  healthtech: 'Digital health',
  medtech: 'MedTech',
  biotech: 'BioTech',
  climate_energy: 'Climate & energy',
  hardware_robotics: 'Hardware & robotics',
  cybersecurity: 'Cybersecurity',
  marketplace: 'Marketplace',
};

export type PresetKey = keyof typeof DASHBOARD_PRESETS | 'founder' | DashboardVertical;

/**
 * Every preset a tenant can install: the curated Executive view, the founder
 * layer on its own (the fold target for a sector with no vertical of its own),
 * and one per vertical — derived from the contract's list so a vertical added
 * there cannot be forgotten here.
 *
 * Typed as `Record<PresetKey, …>` rather than `Record<string, …>` so indexing
 * with a known key (and `.founder`) is `DashboardPreset`, not `| undefined`.
 */
export const ALL_DASHBOARD_PRESETS = {
  ...DASHBOARD_PRESETS,
  founder: { name: 'Founder', tiles: FOUNDER_TILES },
  ...Object.fromEntries(
    DASHBOARD_VERTICALS.map((vertical) => [
      vertical,
      { name: `${VERTICAL_NAMES[vertical]} KPIs`, tiles: [...VERTICAL_TILES, ...(VERTICAL_KPI_TILES[vertical] ?? [])] },
    ]),
  ),
} as Record<PresetKey, DashboardPreset>;

/** The preset keys a client may ask for (drives the UI and the route's guard). */
export function listPresetKeys(): PresetKey[] {
  return Object.keys(ALL_DASHBOARD_PRESETS) as PresetKey[];
}

/** THE GATE: a route param is a preset key only if it is declared here. */
export function isPresetKey(key: string): key is PresetKey {
  return Object.prototype.hasOwnProperty.call(ALL_DASHBOARD_PRESETS, key);
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
  const preset: DashboardPreset = ALL_DASHBOARD_PRESETS[presetKey];
  if (!preset) throw new Error(`unknown dashboard preset: ${presetKey}`);

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
