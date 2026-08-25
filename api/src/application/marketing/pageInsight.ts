/**
 * What visitors do on a page, and where the widget sits (PRD 19 §9).
 *
 * Three tables that share one subject — a page as seen by a stranger:
 *
 *   `marketing_heatmap_pages`        the aggregated click and scroll maps for a
 *                                    path over a PERIOD.
 *   `marketing_heatmap_screenshots`  the render a map is drawn over, per viewport
 *                                    and theme.
 *   `embed_widget_layout`            where an embedded widget is placed on a host
 *                                    page, which is the other thing that changes
 *                                    what a visitor sees.
 *
 * ── A HEATMAP IS AN AGGREGATE, AND THE PERIOD IS PART OF IT ─────────────────
 * `period_start` / `period_end` / `computed_at` exist because a heatmap without a
 * window is a lie that gets worse over time: a page redesigned in March cannot be
 * explained by clicks from January, but a single ever-accumulating map silently
 * blends them. {@link storeHeatmap} therefore requires the window and
 * {@link heatmapFor} returns the most recent map for a path rather than merging.
 *
 * ── SCREENSHOTS ARE PER VIEWPORT AND PER THEME ──────────────────────────────
 * A click map drawn over the wrong screenshot is worse than none — it points at
 * the wrong element. So a screenshot carries its viewport width and theme mode,
 * and {@link screenshotFor} picks the CLOSEST width at or below the requested one
 * rather than the newest: rendering a mobile map over a desktop capture is the
 * exact mistake this ordering prevents.
 *
 * ── SAMPLE COUNT GATES INTERPRETATION ───────────────────────────────────────
 * Same principle as the A/B stopping rule: {@link heatmapFor} reports
 * `underpowered` when the map was built from too few sessions. Eleven clicks
 * arranged in a shape look exactly like a finding.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  embedWidgetLayout,
  marketingHeatmapPages,
  marketingHeatmapScreenshots,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** Below this, a map is a shape rather than a finding. Deliberately low —
 *  it is a floor for "do not interpret", not a claim of significance. */
export const MIN_HEATMAP_SAMPLES = 100;

/** `embed_widget_layout.mode`. */
export const EMBED_MODES = ['inline', 'modal', 'drawer', 'bubble'] as const;
export type EmbedMode = (typeof EMBED_MODES)[number];

export const isEmbedMode = (v: unknown): v is EmbedMode =>
  typeof v === 'string' && (EMBED_MODES as readonly string[]).includes(v);

export class PageInsightError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'PageInsightError';
  }
}

const requirePath = (p: string): string => {
  const s = p.trim();
  if (!s.startsWith('/') || s.length > 500) {
    throw new PageInsightError('path must be an absolute URL path of 500 characters or fewer');
  }
  return s;
};

// ── Heatmaps ────────────────────────────────────────────────────────────────

/**
 * Store one computed map for a path over a window.
 *
 * The window is REQUIRED and validated. A map with no window, or with an end
 * before its start, cannot be compared with the next one — and comparison across
 * a redesign is the only reason to keep old maps at all.
 */
export async function storeHeatmap(
  db: Db,
  tenantId: number,
  input: {
    path: string;
    clickMap?: unknown;
    scrollMap?: unknown;
    sampleCount: number;
    periodStart: Date;
    periodEnd: Date;
  },
) {
  const path = requirePath(input.path);
  if (input.periodEnd <= input.periodStart) {
    throw new PageInsightError('periodEnd must be after periodStart');
  }
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 0) {
    throw new PageInsightError('sampleCount must be a non-negative integer');
  }

  const [row] = await db
    .insert(marketingHeatmapPages)
    .values({
      tenantId,
      path,
      clickMap: input.clickMap ?? null,
      scrollMap: input.scrollMap ?? null,
      sampleCount: input.sampleCount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      computedAt: new Date(),
    })
    .returning();
  if (!row) throw new PageInsightError('could not store the heatmap');
  return row;
}

/**
 * The most recent map for a path, with its own verdict on whether it may be read.
 *
 * Most recent rather than merged, for the reason in the module docstring: two
 * windows either side of a redesign describe two different pages.
 */
export async function heatmapFor(db: Db, tenantId: number, path: string) {
  const [row] = await db
    .select()
    .from(marketingHeatmapPages)
    .where(scopedToTenant(marketingHeatmapPages, tenantId, eq(marketingHeatmapPages.path, requirePath(path))))
    .orderBy(desc(marketingHeatmapPages.periodEnd))
    .limit(1);
  if (!row) return null;

  return {
    ...row,
    underpowered: row.sampleCount < MIN_HEATMAP_SAMPLES,
    reason: row.sampleCount < MIN_HEATMAP_SAMPLES
      ? `Built from ${row.sampleCount} sessions; below ${MIN_HEATMAP_SAMPLES} a map is a shape, not a finding.`
      : null,
  };
}

/** Every window recorded for a path, newest first — how behaviour changed across
 *  redesigns, which is the read that justifies keeping old maps. */
export async function heatmapHistory(db: Db, tenantId: number, path: string) {
  return db
    .select({
      id: marketingHeatmapPages.id,
      periodStart: marketingHeatmapPages.periodStart,
      periodEnd: marketingHeatmapPages.periodEnd,
      sampleCount: marketingHeatmapPages.sampleCount,
      computedAt: marketingHeatmapPages.computedAt,
    })
    .from(marketingHeatmapPages)
    .where(scopedToTenant(marketingHeatmapPages, tenantId, eq(marketingHeatmapPages.path, requirePath(path))))
    .orderBy(desc(marketingHeatmapPages.periodEnd));
}

/** Which pages have enough data to be worth looking at. Ordered by sample count
 *  so the pages that can actually support a conclusion come first. */
export async function readablePages(db: Db, tenantId: number) {
  return db
    .select({
      path: marketingHeatmapPages.path,
      windows: sql<number>`count(*)::int`,
      latestSamples: sql<number>`max(${marketingHeatmapPages.sampleCount})::int`,
      latestPeriodEnd: sql<Date>`max(${marketingHeatmapPages.periodEnd})`,
    })
    .from(marketingHeatmapPages)
    .where(scopedToTenant(marketingHeatmapPages, tenantId))
    .groupBy(marketingHeatmapPages.path)
    .having(sql`max(${marketingHeatmapPages.sampleCount}) >= ${MIN_HEATMAP_SAMPLES}`)
    .orderBy(desc(sql`max(${marketingHeatmapPages.sampleCount})`));
}

export async function addScreenshot(
  db: Db,
  tenantId: number,
  pageId: number,
  input: { artifactId?: string | null; viewportWidth: number; viewportHeight?: number | null; themeMode?: 'light' | 'dark' },
) {
  if (!Number.isInteger(input.viewportWidth) || input.viewportWidth <= 0) {
    throw new PageInsightError('viewportWidth is required — a map drawn over the wrong width points at the wrong element');
  }
  const [row] = await db
    .insert(marketingHeatmapScreenshots)
    .values({
      tenantId,
      pageId,
      artifactId: input.artifactId ?? null,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight ?? null,
      themeMode: input.themeMode ?? 'light',
    })
    .returning();
  if (!row) throw new PageInsightError('could not add the screenshot');
  return row;
}

/**
 * The screenshot to draw a map over.
 *
 * Picks the widest capture at or BELOW the requested viewport, not the newest and
 * not the closest in either direction. Drawing a 375px map over a 1440px capture
 * puts every hotspot in the wrong place; scaling down a slightly-too-narrow
 * capture is the far smaller error.
 */
export async function screenshotFor(
  db: Db,
  tenantId: number,
  pageId: number,
  viewportWidth: number,
  themeMode: 'light' | 'dark' = 'light',
) {
  const [row] = await db
    .select()
    .from(marketingHeatmapScreenshots)
    .where(scopedToTenant(marketingHeatmapScreenshots, tenantId, and(
      eq(marketingHeatmapScreenshots.pageId, pageId),
      eq(marketingHeatmapScreenshots.themeMode, themeMode),
      sql`${marketingHeatmapScreenshots.viewportWidth} <= ${viewportWidth}`,
    )))
    .orderBy(desc(marketingHeatmapScreenshots.viewportWidth), desc(marketingHeatmapScreenshots.capturedAt))
    .limit(1);
  return row ?? null;
}

// ── Embed layout ────────────────────────────────────────────────────────────

/**
 * Where a widget sits on a host page.
 *
 * `host_pattern` is nullable: a null pattern is the DEFAULT placement and a
 * non-null one overrides it for hosts that match. {@link layoutFor} resolves
 * most-specific-first, so a tenant can place a widget once and then correct it on
 * the one host where it collides with something.
 */
export async function setEmbedLayout(
  db: Db,
  tenantId: number,
  input: { widgetKey: string; hostPattern?: string | null; mode?: EmbedMode; config?: unknown },
) {
  const widgetKey = input.widgetKey.trim().toLowerCase();
  if (!widgetKey) throw new PageInsightError('widgetKey is required');
  const mode = input.mode ?? 'inline';
  if (!isEmbedMode(mode)) throw new PageInsightError(`mode must be one of: ${EMBED_MODES.join(', ')}`);

  const [existing] = await db
    .select({ id: embedWidgetLayout.id })
    .from(embedWidgetLayout)
    .where(scopedToTenant(embedWidgetLayout, tenantId, and(
      eq(embedWidgetLayout.widgetKey, widgetKey),
      input.hostPattern
        ? eq(embedWidgetLayout.hostPattern, input.hostPattern)
        : sql`${embedWidgetLayout.hostPattern} is null`,
    )))
    .limit(1);

  const values = {
    tenantId,
    widgetKey: widgetKey.slice(0, 96),
    hostPattern: input.hostPattern ?? null,
    mode,
  };

  const [row] = existing
    ? await db.update(embedWidgetLayout).set(values)
      .where(scopedToTenant(embedWidgetLayout, tenantId, eq(embedWidgetLayout.id, existing.id))).returning()
    : await db.insert(embedWidgetLayout).values(values).returning();
  if (!row) throw new PageInsightError('could not set the layout');
  return row;
}

/**
 * Resolve the layout for a widget on a host.
 *
 * Most specific wins: an exact host pattern beats the null default. Returns null
 * when neither exists, so the caller decides whether an unplaced widget renders
 * at all — silently defaulting to `inline` would put widgets on pages nobody
 * chose to put them on.
 */
export async function layoutFor(db: Db, tenantId: number, widgetKey: string, host?: string) {
  const rows = await db
    .select()
    .from(embedWidgetLayout)
    .where(scopedToTenant(embedWidgetLayout, tenantId, eq(embedWidgetLayout.widgetKey, widgetKey.trim().toLowerCase())));

  if (rows.length === 0) return null;
  if (host) {
    const specific = rows.find((r) => r.hostPattern && host.includes(r.hostPattern));
    if (specific) return specific;
  }
  return rows.find((r) => r.hostPattern === null) ?? null;
}

export async function listEmbedLayouts(db: Db, tenantId: number) {
  return db
    .select()
    .from(embedWidgetLayout)
    .where(scopedToTenant(embedWidgetLayout, tenantId))
    .orderBy(embedWidgetLayout.widgetKey);
}
