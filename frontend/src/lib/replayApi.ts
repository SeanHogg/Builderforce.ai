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
  filterToQuery,
  type ReplayFilter,
  type ReplayIssueDetailDto,
  type ReplayIssueDto,
  type ReplayIssueStatus,
  type ReplayKpisDto,
  type ReplayLiveDto,
  type ReplayPage,
  type ReplayRecordingDto,
  type ReplayRecordingSummaryDto,
  type ReplayReleaseDto,
} from '@builderforce/interaction-contract';
import { apiRequest, apiRequestStream } from './apiClient';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

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

type QueryValue = string | number | null | undefined;

/** Fill `:name` segments of a `REPLAY_PATHS` template. */
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(String(params[name] ?? '')));
}

/** `path?site=…&k=v…` plus the filter's own params. */
function withQuery(path: string, siteId: string, query: Record<string, QueryValue> = {}, filter?: ReplayFilter | null): string {
  const params = filter ? filterToQuery(filter) : new URLSearchParams();
  params.set('site', siteId);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

/**
 * Concurrent identical reads share one request (several tabs of one panel level
 * read the same recording at mount). Single-flight only — `ttlMs: 0` means a
 * settled answer is never reused, so live follow always sees new chunks.
 */
function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  return getOrSetClientCached(`replay:${key}`, () => load(), { ttlMs: 0 });
}

function listOf<T>(body: T[] | { items: T[] } | null | undefined): T[] {
  if (Array.isArray(body)) return body;
  return body?.items ?? [];
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
};
