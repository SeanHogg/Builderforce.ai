/**
 * THE heatmap read service (PRD 33 §8 S4): click/rage/dead/scroll layers, the
 * element table with release compare, scroll reach, the top routes, the background
 * snapshot and the `HEATMAP_INSIGHT_RULES` findings.
 *
 * Exact over every session (D15/D18): every number comes from the daily rollups,
 * never from kept recordings — only the snapshot reads a recording, because it needs
 * DOM bytes. Every method is cached under the site's version token
 * (`replayReadKeys(...).heat`), and every statement carries the full scope.
 *
 * Elements are ranked by THE heat rule, `rankHeatZones` (count × 0.97^ageDays), over
 * clicks + rage + dead with the element's last interaction day as `lastSeen`.
 */

import { GRID } from '@builderforce/interaction-contract';
import type {
  ReplayElementRowDto,
  ReplayHeatGridDto,
  ReplayHeatInsightDto,
  ReplayHeatSnapshotDto,
  ReplayRouteStatDto,
  ReplayScrollDepthDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { rankHeatZones } from '../../domain/qa/heatZones';
import { foldElementCells, scrollReach, type ElementStat } from '../../domain/replay/heatFold';
import { evaluateHeatInsights } from '../../domain/replay/heatInsightRules';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { DAY_MS } from '../../domain/shared/time';
import { replayReadKeys } from './replayCacheKeys';
import { listChunkSeqs } from './replayChunkStore';
import { replayTelemetryDb } from './replayDatabase';
import {
  normalizeHeatQuery,
  readElementCells,
  readHeatCells,
  readRoutePageviews,
  readRouteQuickbacks,
  readRouteStats,
  readScrollDeciles,
  readSnapshotRecording,
  type HeatQuery,
  type RawHeatQuery,
} from './replayHeatReads';
import { clampDays, windowDays } from './replayReadModel';
import { recordingLocation } from './replayRecordingWriter';

const ROLLUP_TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
/** Rows in the element table. */
export const ELEMENTS_LIMIT = 50;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export class ReplayHeatmapService {
  private readonly store: Db;

  constructor(private readonly env: Env, db: Db, private readonly clock: () => Date = () => new Date()) {
    this.store = replayTelemetryDb(env, db);
  }

  private since(days: number): string {
    return windowDays(this.clock(), days)[0]!;
  }

  private async cached<T>(scope: ReplayScope, what: string, q: HeatQuery, load: () => Promise<T>): Promise<T> {
    const keys = await replayReadKeys(this.env, scope);
    const key = keys.heat(what, [q.route, q.release, q.compare, q.device, q.kind, q.days]);
    return getOrSetCached(this.env, key, load, ROLLUP_TTL);
  }

  /** One heat layer: summed cells per (gx, gy). */
  async grid(scope: ReplayScope, raw: RawHeatQuery): Promise<ReplayHeatGridDto> {
    const q = normalizeHeatQuery(raw);
    return this.cached(scope, 'grid', q, async () => {
      const cells = await readHeatCells(this.store, scope, { ...q, since: this.since(q.days) });
      return {
        route: q.route,
        releaseKey: q.release,
        deviceClass: q.device,
        kind: q.kind,
        cells,
        total: cells.reduce((sum, cell) => sum + cell.n, 0),
      };
    });
  }

  /** Per-element stats for the release and, with `compare`, the compare release. */
  private async elementStats(scope: ReplayScope, q: HeatQuery): Promise<{ current: ElementStat[]; compare: ElementStat[] | null }> {
    const since = this.since(q.days);
    const [current, compare] = await Promise.all([
      readElementCells(this.store, scope, { route: q.route, release: q.release, device: q.device, since }),
      q.compare ? readElementCells(this.store, scope, { route: q.route, release: q.compare, device: q.device, since }) : null,
    ]);
    return { current: foldElementCells(current), compare: compare ? foldElementCells(compare) : null };
  }

  /** The element table, ranked by `rankHeatZones`, with clicks vs the compare release. */
  async elements(scope: ReplayScope, raw: RawHeatQuery): Promise<ReplayElementRowDto[]> {
    const q = normalizeHeatQuery(raw);
    return this.cached(scope, 'elements', q, async () => {
      const { current, compare } = await this.elementStats(scope, q);
      const before = new Map((compare ?? []).map((stat) => [stat.selector, stat.clicks]));
      const ranked = rankHeatZones(
        current.map((stat) => ({ ...stat, count: stat.clicks + stat.rage + stat.dead })),
        this.clock(),
        ELEMENTS_LIMIT,
      );
      return ranked.map((row): ReplayElementRowDto => {
        const compareClicks = compare ? before.get(row.selector) ?? 0 : null;
        return {
          selector: row.selector,
          label: row.label,
          clicks: row.clicks,
          rage: row.rage,
          dead: row.dead,
          compareClicks,
          delta: compareClicks ? round3((row.clicks - compareClicks) / compareClicks) : null,
          score: round3(row.score),
        };
      });
    });
  }

  /** Share of page views reaching each depth decile. */
  async scrollDepth(scope: ReplayScope, raw: RawHeatQuery): Promise<ReplayScrollDepthDto> {
    const q = normalizeHeatQuery({ ...raw, kind: 'scroll' });
    return this.cached(scope, 'scroll', q, async () => {
      const deciles = await readScrollDeciles(this.store, scope, { ...q, since: this.since(q.days) });
      return { route: q.route, ...scrollReach(deciles) };
    });
  }

  /** The busiest routes in the window (≤ 50), for the route picker. */
  async routes(scope: ReplayScope, days?: number): Promise<ReplayRouteStatDto[]> {
    const window = clampDays(days);
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.heat('routes', [window]), () =>
      readRouteStats(this.store, scope, this.since(window)), ROLLUP_TTL);
  }

  /**
   * The background: the newest kept recording on the route and the first stored chunk
   * seq — a recording kept by a trigger starts mid-visit, and its first stored chunk
   * holds the full snapshot the recorder's ring buffer drained on keep.
   */
  async snapshot(scope: ReplayScope, raw: RawHeatQuery): Promise<ReplayHeatSnapshotDto> {
    const q = normalizeHeatQuery(raw);
    return this.cached(scope, 'snapshot', q, async () => {
      const since = new Date(this.clock().getTime() - q.days * DAY_MS);
      const row = await readSnapshotRecording(this.store, scope, { route: q.route, release: q.release, device: q.device, since });
      if (!row) return { recordingId: null, seq: 0 };
      const seqs = await listChunkSeqs(this.env, recordingLocation(row));
      return { recordingId: row.id, seq: seqs[0] ?? 0 };
    });
  }

  /** The heatmap insight rules over one route (and the compare release, when given). */
  async insights(scope: ReplayScope, raw: RawHeatQuery): Promise<ReplayHeatInsightDto[]> {
    const q = normalizeHeatQuery(raw);
    return this.cached(scope, 'insights', q, async () => {
      const since = this.since(q.days);
      const [elements, deciles, pageviews, quickbacks] = await Promise.all([
        this.elementStats(scope, q),
        readScrollDeciles(this.store, scope, { route: q.route, release: q.release, device: q.device, since }),
        readRoutePageviews(this.store, scope, { ...q, since }),
        readRouteQuickbacks(this.store, scope, { ...q, since }),
      ]);
      const scroll = scrollReach(deciles);
      return evaluateHeatInsights({
        route: q.route,
        grid: GRID,
        elements: elements.current,
        compare: elements.compare,
        scrollReach: scroll.reach,
        scrollSessions: scroll.sessions,
        pageviews,
        quickbacks,
      });
    });
  }
}
