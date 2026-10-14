/** Insights API contract — heat (PRD 33). Re-exported by `../api.ts`; see its header. */
import type { ReplayDeviceClass } from './core';
// ── Heatmaps, element tracking and release compare (S4) ─────────────────────
// Query parameters for every heatmap read: `site`, `route`, `release`, `compare`
// (a second release), `device`, `kind`, `days`. Counts are exact over every session
// (D15/D18) — they come from the `replay_heat_daily` / `replay_route_daily` rollups.

export type ReplayHeatKind = 'click' | 'rage' | 'dead' | 'scroll';

export const REPLAY_HEAT_KINDS: readonly ReplayHeatKind[] = ['click', 'rage', 'dead', 'scroll'];

/** One heat layer on the `GRID` lattice. For `scroll`, `gx` is 0 and `gy` is the depth decile. */
export interface ReplayHeatGridDto {
  route: string;
  releaseKey: string | null;
  deviceClass: ReplayDeviceClass | null;
  kind: ReplayHeatKind;
  cells: Array<{ gx: number; gy: number; n: number }>;
  total: number;
}

/** One element on a route, ranked by the recency-weighted heat rule (`rankHeatZones`). */
export interface ReplayElementRowDto {
  selector: string;
  label: string | null;
  clicks: number;
  rage: number;
  dead: number;
  /** Clicks in the `compare` release; null without one. */
  compareClicks: number | null;
  /** Relative change of clicks vs the compare release (0.25 = +25 %); null when not comparable. */
  delta: number | null;
  score: number;
}

export interface ReplayScrollDepthDto {
  route: string;
  /** Page views that reported a scroll depth. */
  sessions: number;
  /** 10 entries: share of those page views reaching depth decile i, 0..1. */
  reach: number[];
}

export interface ReplayRouteStatDto {
  route: string;
  /** Sessions that ENTERED on this route. */
  sessions: number;
  pageviews: number;
}

/** A finding from `HEATMAP_INSIGHT_RULES`; the title is `replay.heatInsight.<ruleId>` over `params`. */
export interface ReplayHeatInsightDto {
  ruleId: string;
  route: string;
  selector: string | null;
  params: Record<string, number | string>;
  action: 'watch' | 'ticket';
}

/**
 * The heatmap background: the newest kept recording on that route/release/device,
 * and the stored chunk `seq` that holds its first full snapshot. `recordingId` is
 * null when no kept recording visited the route in the window.
 */
export interface ReplayHeatSnapshotDto {
  recordingId: string | null;
  seq: number;
}

export type ReplayExportStatus = 'queued' | 'running' | 'done' | 'failed' | 'unavailable';

/** An MP4 (or WebM) render of one recording (S4b, D10). */
export interface ReplayExportDto {
  id: string;
  recordingId: string;
  status: ReplayExportStatus;
  format: 'mp4' | 'webm' | null;
  /** `REPLAY_PATHS.exportDownload` filled in, once `done`. */
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
}
