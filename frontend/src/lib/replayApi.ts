/**
 * The Insights read client (PRD 33 §3, §4).
 *
 * The ONE place the frontend calls `/api/replay/*`: components never build a
 * URL. Paths come from `REPLAY_PATHS` and every shape from the shared DTOs in
 * `@builderforce/interaction-contract`, so the API and this client cannot
 * drift. Every function takes the `siteId` the reader is looking at (D17:
 * scope is `{ tenantId, siteId }`; the tenant comes from the session).
 */

import { gunzipSync, strFromU8 } from 'fflate';
import {
  REPLAY_PATHS,
  type ReplayFilter,
  type ReplayDeviceClass,
  type ReplayElementRowDto,
  type ReplayExportDto,
  type ReplayHeatGridDto,
  type ReplayHeatInsightDto,
  type ReplayHeatKind,
  type ReplayHeatSnapshotDto,
  type ReplayIssueDetailDto,
  type ReplayIssueDto,
  type ReplayIssueStatus,
  type ReplayKpisDto,
  type ReplayLiveDto,
  type ReplayPage,
  type ReplayRecordingDto,
  type ReplayRecordingSummaryDto,
  type ReplayReleaseDto,
  type ReplayRouteStatDto,
  type ReplayScrollDepthDto,
} from '@builderforce/interaction-contract';
import { apiRequest, apiRequestStream } from './apiClient';
import { downloadBlob, filenameFromResponse } from './download';
import { fill, listOf, shared, withQuery, type QueryValue } from './replayHttp';
import { replayAnalysisApi } from './replayAnalysisApi';
import { replayMethodApi } from './replayMethodApi';

/** The three windows every Insights view offers. */
export const REPLAY_WINDOWS = [7, 30, 90] as const;
export type ReplayWindow = (typeof REPLAY_WINDOWS)[number];

export interface RecordingsQuery {
  days?: number;
  cursor?: string | null;
  limit?: number;
  filter?: ReplayFilter | null;
}

export interface IssuesQuery {
  days?: number;
  status?: ReplayIssueStatus | null;
  cursor?: string | null;
  limit?: number;
  filter?: ReplayFilter | null;
}

export interface KpisQuery {
  days?: number;
  release?: string | null;
  filter?: ReplayFilter | null;
}

/**
 * Every heatmap read's parameters (`replayHeatmapRoutes.ts`): the route, the
 * release (null = every release), a second release to compare, the device
 * (null = every device), the layer and the window. Counts are exact (D15/D18).
 */
export interface HeatQuery {
  route: string;
  release?: string | null;
  compare?: string | null;
  device?: ReplayDeviceClass | null;
  kind?: ReplayHeatKind;
  days?: number;
}

const GZIP_MAGIC = [0x1f, 0x8b] as const;

/**
 * NDJSON → rrweb events. The API serves the stored gzip either with
 * `Content-Encoding: gzip` (the browser has already inflated it) or as raw
 * bytes; the magic number says which. A line is an rrweb event, or a whole
 * chunk object whose `events` array holds them.
 */
export function parseChunkBytes(bytes: Uint8Array): unknown[] {
  const inflated = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1] ? gunzipSync(bytes) : bytes;
  const events: unknown[] = [];
  for (const line of strFromU8(inflated).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      // One torn line (a pagehide flush cut mid-write) must not lose the chunk.
      void error;
      continue;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
      events.push(...(parsed as { events: unknown[] }).events);
    } else if (parsed && typeof parsed === 'object') {
      events.push(parsed);
    }
  }
  return events;
}

export const replayApi = {
  // ── Analysis parity (S4c): segments, filter options, overview, smart events, funnels, flow, AI summaries ──
  ...replayAnalysisApi,
  // ── Method link (S4d): a replay-moment ticket's measured effect ──
  ...replayMethodApi,

  listRecordings(siteId: string, query: RecordingsQuery = {}): Promise<ReplayPage<ReplayRecordingSummaryDto>> {
    const { filter, ...rest } = query;
    return apiRequest(withQuery(REPLAY_PATHS.recordings, siteId, rest, filter));
  },

  getRecording(siteId: string, recordingId: string): Promise<ReplayRecordingDto> {
    const url = withQuery(fill(REPLAY_PATHS.recording, { recordingId }), siteId);
    return shared(url, () => apiRequest<ReplayRecordingDto>(url));
  },

  /** One chunk's rrweb events, in order. */
  async getRecordingChunk(siteId: string, recordingId: string, seq: number): Promise<unknown[]> {
    const url = withQuery(fill(REPLAY_PATHS.recordingChunk, { recordingId, seq }), siteId);
    const res = await apiRequestStream(url);
    if (!res.ok) throw new Error(`replay chunk ${seq}: ${res.status}`);
    return parseChunkBytes(new Uint8Array(await res.arrayBuffer()));
  },

  async listReleases(siteId: string): Promise<ReplayReleaseDto[]> {
    const url = withQuery(REPLAY_PATHS.releases, siteId);
    return listOf(await shared(url, () => apiRequest<ReplayReleaseDto[] | ReplayPage<ReplayReleaseDto>>(url)));
  },

  renameRelease(siteId: string, releaseKey: string, label: string): Promise<ReplayReleaseDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.release, { releaseKey }), siteId), {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
  },

  getKpis(siteId: string, query: KpisQuery = {}): Promise<ReplayKpisDto> {
    const { filter, ...rest } = query;
    return apiRequest(withQuery(REPLAY_PATHS.kpis, siteId, rest, filter));
  },

  listIssues(siteId: string, query: IssuesQuery = {}): Promise<ReplayPage<ReplayIssueDto>> {
    const { filter, ...rest } = query;
    return apiRequest(withQuery(REPLAY_PATHS.issues, siteId, rest, filter));
  },

  getIssue(siteId: string, issueId: string, query: { days?: number } = {}): Promise<ReplayIssueDetailDto> {
    const url = withQuery(fill(REPLAY_PATHS.issue, { issueId }), siteId, query);
    return shared(url, () => apiRequest<ReplayIssueDetailDto>(url));
  },

  getLive(siteId: string): Promise<ReplayLiveDto> {
    return apiRequest(withQuery(REPLAY_PATHS.live, siteId));
  },

  // ── Heatmaps (S4) ──────────────────────────────────────────────────────────

  /** One heat layer on the `GRID` lattice for the route. */
  heatGrid(siteId: string, query: HeatQuery): Promise<ReplayHeatGridDto> {
    const url = withQuery(REPLAY_PATHS.heatGrid, siteId, heatParams(query, true));
    return shared(url, () => apiRequest<ReplayHeatGridDto>(url));
  },

  /** The route's elements, ranked; `compare` fills `compareClicks` / `delta`. */
  heatElements(siteId: string, query: HeatQuery): Promise<ReplayElementRowDto[]> {
    const url = withQuery(REPLAY_PATHS.heatElements, siteId, heatParams(query, false));
    return shared(url, async () => listOf(await apiRequest<ReplayElementRowDto[] | { items: ReplayElementRowDto[] }>(url)));
  },

  /** Share of page views reaching each depth decile. */
  heatScroll(siteId: string, query: HeatQuery): Promise<ReplayScrollDepthDto> {
    const url = withQuery(REPLAY_PATHS.heatScroll, siteId, heatParams(query, false));
    return shared(url, () => apiRequest<ReplayScrollDepthDto>(url));
  },

  /** The busiest routes in the window, for the route picker. */
  heatRoutes(siteId: string, query: { days?: number } = {}): Promise<ReplayRouteStatDto[]> {
    const url = withQuery(REPLAY_PATHS.heatRoutes, siteId, { days: query.days });
    return shared(url, async () => listOf(await apiRequest<ReplayRouteStatDto[] | { items: ReplayRouteStatDto[] }>(url)));
  },

  /** `HEATMAP_INSIGHT_RULES` findings for the route (and the compare release). */
  heatInsights(siteId: string, query: HeatQuery): Promise<ReplayHeatInsightDto[]> {
    const url = withQuery(REPLAY_PATHS.heatInsights, siteId, heatParams(query, false));
    return shared(url, async () => listOf(await apiRequest<ReplayHeatInsightDto[] | { items: ReplayHeatInsightDto[] }>(url)));
  },

  /** The recording + chunk seq whose first full snapshot is the heatmap's background. */
  heatSnapshot(siteId: string, query: HeatQuery): Promise<ReplayHeatSnapshotDto> {
    const url = withQuery(REPLAY_PATHS.heatSnapshot, siteId, heatParams(query, false));
    return shared(url, () => apiRequest<ReplayHeatSnapshotDto>(url));
  },

  // ── Video export (S4b) ─────────────────────────────────────────────────────

  /** Ask for a video of the recording (10 units once, D10). Idempotent while one is open. */
  requestExport(siteId: string, recordingId: string): Promise<ReplayExportDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.recordingExport, { recordingId }), siteId), { method: 'POST' });
  },

  exportStatus(siteId: string, exportId: string): Promise<ReplayExportDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.exportStatus, { exportId }), siteId));
  },

  /** The authenticated download path of a finished export (never put in an `href`: it needs the bearer). */
  exportDownloadUrl(siteId: string, exportId: string): string {
    return withQuery(fill(REPLAY_PATHS.exportDownload, { exportId }), siteId);
  },

  /**
   * Download a finished export the way every authenticated download does: fetch
   * through the shared transport (bearer header, never a token in a URL), then
   * hand the blob to `downloadBlob` under the server's filename.
   */
  async downloadExport(siteId: string, exportId: string): Promise<void> {
    const res = await apiRequestStream(replayApi.exportDownloadUrl(siteId, exportId));
    if (!res.ok) throw new Error(`replay export ${exportId}: ${res.status}`);
    downloadBlob(await res.blob(), filenameFromResponse(res, `replay-${exportId}.mp4`));
  },
};

/** The query a heatmap read sends; only the grid carries `kind`. */
function heatParams(query: HeatQuery, withKind: boolean): Record<string, QueryValue> {
  return {
    route: query.route,
    release: query.release ?? null,
    compare: query.compare ?? null,
    device: query.device ?? null,
    kind: withKind ? query.kind ?? 'click' : null,
    days: query.days,
  };
}
