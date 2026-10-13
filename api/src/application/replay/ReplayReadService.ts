/**
 * THE Insights read service (PRD 33 §3, §6 "Caching", D17).
 *
 * Every method takes a `ReplayScope` and applies BOTH halves of it in every
 * statement — scope is never inferred from a fetched row. Every read goes through
 * `getOrSetCached` under the site's version token (`replayCacheKeys`); live presence
 * is bucketed to five seconds in its key. Chunk bytes are the exception: they are
 * immutable and served with `Cache-Control: immutable` by the route instead.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import type {
  ReplayFilter,
  ReplayIssueDetailDto,
  ReplayIssueDto,
  ReplayKpisDto,
  ReplayLiveDto,
  ReplayPage,
  ReplayRecordingDto,
  ReplayRecordingSummaryDto,
  ReplayReleaseDto,
  ReplayDeviceClass,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayLive, replayRecordings, replayReleases } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { bumpSiteVersion, replayReadKeys } from './replayCacheKeys';
import { getChunk, getMarks } from './replayChunkStore';
import { replayTelemetryDb } from './replayDatabase';
import {
  afterRecordingCursor,
  clampDays,
  decodeOffsetCursor,
  decodeRecordingCursor,
  encodeRecordingCursor,
  filterCacheKey,
  RECORDINGS_PAGE,
  recordingFilterWhere,
  toRecordingDto,
  toRecordingSummary,
} from './replayReadModel';
import { recordingLocation, type RecordingRow } from './replayRecordingWriter';
import { readIssue, readIssues, readKpis } from './replayRollupReads';

const LIST_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };
const ROLLUP_TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
/** A visitor seen within this window is "live". */
export const LIVE_ACTIVE_MS = 60_000;
const LIVE_BUCKET_MS = 5_000;
const LIVE_VISITORS_MAX = 200;
const LABEL_MAX = 80;

export class ReplayReadService {
  private readonly store: Db;

  constructor(private readonly env: Env, db: Db, private readonly clock: () => Date = () => new Date()) {
    this.store = replayTelemetryDb(env, db);
  }

  /** Kept recordings, newest first, 50 per page (keyset on started_at, id). */
  async listRecordings(
    scope: ReplayScope,
    input: { days?: number; cursor?: string | null; filter?: ReplayFilter | null; limit?: number } = {},
  ): Promise<ReplayPage<ReplayRecordingSummaryDto>> {
    const days = clampDays(input.days);
    const limit = Math.min(RECORDINGS_PAGE, Math.max(1, Math.round(input.limit ?? RECORDINGS_PAGE)));
    const cursor = decodeRecordingCursor(input.cursor);
    const keys = await replayReadKeys(this.env, scope);
    const key = keys.recordings(days, cursor ? `${input.cursor}~${limit}` : `~${limit}`, filterCacheKey(input.filter));
    return getOrSetCached(this.env, key, async () => {
      const since = new Date(this.clock().getTime() - days * 86_400_000);
      const rows = await this.store
        .select()
        .from(replayRecordings)
        .where(and(
          eq(replayRecordings.tenantId, scope.tenantId),
          eq(replayRecordings.siteId, scope.siteId),
          gte(replayRecordings.startedAt, since),
          afterRecordingCursor(cursor),
          recordingFilterWhere(input.filter),
        ))
        .orderBy(desc(replayRecordings.startedAt), desc(replayRecordings.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toRecordingSummary),
        nextCursor: rows.length > limit && last ? encodeRecordingCursor(last) : null,
      };
    }, LIST_TTL);
  }

  private async row(scope: ReplayScope, recordingId: string): Promise<RecordingRow> {
    if (!isUuid(recordingId)) throw new NotFoundError('Recording', recordingId);
    const [row] = await this.store
      .select()
      .from(replayRecordings)
      .where(and(
        eq(replayRecordings.tenantId, scope.tenantId),
        eq(replayRecordings.siteId, scope.siteId),
        eq(replayRecordings.id, recordingId),
      ))
      .limit(1);
    if (!row) throw new NotFoundError('Recording', recordingId);
    return row;
  }

  /** One recording with its timeline (`marks.json`). 404 outside the scope. */
  async getRecording(scope: ReplayScope, recordingId: string): Promise<ReplayRecordingDto> {
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.recording(recordingId), async () => {
      const row = await this.row(scope, recordingId);
      return toRecordingDto(row, await getMarks(this.env, recordingLocation(row)));
    }, LIST_TTL);
  }

  /** The stored gzip bytes of one chunk (not cached: immutable, served with a long Cache-Control). */
  async chunk(scope: ReplayScope, recordingId: string, seq: number): Promise<ArrayBuffer> {
    const row = await this.row(scope, recordingId);
    const bytes = await getChunk(this.env, recordingLocation(row), seq);
    if (!bytes) throw new NotFoundError('Chunk', `${recordingId}/${seq}`);
    return bytes;
  }

  /** Releases newest first, each with its ordinal (`R<n>` by first sighting). */
  async releases(scope: ReplayScope): Promise<ReplayReleaseDto[]> {
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.releases(), async () => {
      const rows = await this.store
        .select()
        .from(replayReleases)
        .where(and(eq(replayReleases.tenantId, scope.tenantId), eq(replayReleases.siteId, scope.siteId)))
        .orderBy(replayReleases.firstSeenAt);
      return rows
        .map((row, index): ReplayReleaseDto => ({
          releaseKey: row.releaseKey,
          label: row.label,
          ordinal: index + 1,
          source: row.source === 'hosted' || row.source === 'fingerprint' ? row.source : 'explicit',
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
        }))
        .reverse();
    }, ROLLUP_TTL);
  }

  /** Name a release (empty clears the name back to `R<n>`). 404 for an unknown key. */
  async renameRelease(scope: ReplayScope, releaseKey: string, label: string | null): Promise<ReplayReleaseDto> {
    const clean = label?.trim().slice(0, LABEL_MAX) || null;
    const updated = await this.store
      .update(replayReleases)
      .set({ label: clean })
      .where(and(
        eq(replayReleases.tenantId, scope.tenantId),
        eq(replayReleases.siteId, scope.siteId),
        eq(replayReleases.releaseKey, releaseKey),
      ))
      .returning({ releaseKey: replayReleases.releaseKey });
    if (updated.length === 0) throw new NotFoundError('Release', releaseKey);
    await bumpSiteVersion(this.env, scope.siteId);
    const found = (await this.releases(scope)).find((r) => r.releaseKey === releaseKey);
    if (!found) throw new NotFoundError('Release', releaseKey);
    return found;
  }

  async kpis(scope: ReplayScope, input: { days?: number; release?: string | null } = {}): Promise<ReplayKpisDto> {
    const days = clampDays(input.days);
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, `${keys.kpis(days)}:${input.release ?? '-'}`, () =>
      readKpis(this.store, scope, { days, release: input.release ?? null, now: this.clock() }), ROLLUP_TTL);
  }

  async issues(
    scope: ReplayScope,
    input: { days?: number; status?: string | null; cursor?: string | null; limit?: number } = {},
  ): Promise<ReplayPage<ReplayIssueDto>> {
    const days = clampDays(input.days);
    const offset = decodeOffsetCursor(input.cursor);
    const keys = await replayReadKeys(this.env, scope);
    const key = `${keys.issues(days, input.status ?? null, String(offset))}:${input.limit ?? '-'}`;
    return getOrSetCached(this.env, key, () =>
      readIssues(this.store, scope, { days, status: input.status, offset, limit: input.limit, now: this.clock() }), ROLLUP_TTL);
  }

  async issue(scope: ReplayScope, issueId: string, input: { days?: number } = {}): Promise<ReplayIssueDetailDto> {
    const days = clampDays(input.days);
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.issue(issueId, days), () =>
      readIssue(this.store, scope, { issueId, days, now: this.clock() }), ROLLUP_TTL);
  }

  /** Who is on the site now (seen in the last minute). Cached per 5-second bucket. */
  async live(scope: ReplayScope): Promise<ReplayLiveDto> {
    const now = this.clock();
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.live(Math.floor(now.getTime() / LIVE_BUCKET_MS)), async () => {
      const rows = await this.store
        .select()
        .from(replayLive)
        .where(and(
          eq(replayLive.tenantId, scope.tenantId),
          eq(replayLive.siteId, scope.siteId),
          gte(replayLive.lastSeenAt, new Date(now.getTime() - LIVE_ACTIVE_MS)),
        ))
        .orderBy(desc(replayLive.lastSeenAt))
        .limit(LIVE_VISITORS_MAX);
      const byRoute = new Map<string, number>();
      for (const row of rows) byRoute.set(row.route, (byRoute.get(row.route) ?? 0) + 1);
      return {
        active: rows.length,
        byRoute: [...byRoute].map(([route, n]) => ({ route, n })).sort((a, b) => b.n - a.n),
        visitors: rows.map((row) => ({
          visitId: row.visitId,
          route: row.route,
          deviceClass: row.deviceClass as ReplayDeviceClass,
          x: row.x,
          y: row.y,
          lastSeenAt: row.lastSeenAt.toISOString(),
          recordingId: row.recordingId,
        })),
      };
    }, { kvTtlSeconds: 60, l1TtlMs: LIVE_BUCKET_MS });
  }
}
