/**
 * The YouTube upload as a durable job over `youtube_uploads` (migration 1095).
 *
 * The protocol lives in {@link ./youtubeResumableUpload}; this module owns everything
 * around one tick of it: creating the row, CLAIMING it so two ticks never push the
 * same chunk, persisting what Google confirmed, backing off transient failures, and
 * handing a settled upload to whoever queued it ({@link YouTubeUploadSettled}).
 *
 * ── STATES, AS THE SWEEP READS THEM ──────────────────────────────────────────
 *   `queued`    — claimable. A new row, OR one between ticks. `attempts > 0` means
 *                 the last tick hit a transient failure and backoff applies.
 *   `uploading` — a tick holds it right now. A tick that is evicted leaves it here,
 *                 and the lease ({@link YOUTUBE_UPLOAD_LEASE_SECONDS}) is what lets
 *                 the next sweep take it back.
 *   `succeeded` / `failed` — terminal; the back-reference has been written.
 *
 * Returning to `queued` between ticks (rather than sitting in `uploading`) is what
 * lets the canvas editor drive an upload back-to-back while its tab is open, and the
 * cron sweep finish it when the tab is closed — the same tick either way.
 *
 * ── ONE CODE PATH ────────────────────────────────────────────────────────────
 * The canvas route, the campaign publisher and the sweep all go through
 * {@link enqueueYouTubeUpload} + {@link advanceYouTubeUpload}. A small render may
 * finish inside the request that queued it; a large one finishes on the sweep. Both
 * are the same rows and the same tick.
 */

import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { credentials, youtubeUploads } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { signalPendingWork } from '../runtime/cronWorkSignal';
import { isTerminalRefreshFailure } from '../integrations/oauthTokenVault';
import {
  runYouTubeUploadTick,
  uploadPercent,
  type YouTubePrivacy,
  type YouTubeUploadSource,
  type YouTubeUploadTick,
} from './youtubeResumableUpload';
import { r2UploadSource, urlUploadSource } from './youtubeUploadSources';
import { freshYouTubeToken, YOUTUBE_PROVIDER } from './youtubePublishing';

/**
 * Poll YouTube's `videos.list` to get the current processing status of an uploaded video.
 * Returns the processing status string from YouTube, or null if the video cannot be found.
 *
 * YouTube processing statuses:
 *   - 'uploaded'    — processing not started yet (still uploading)
 *   - 'processing'  — YouTube is processing the video
 *   - 'processed'   — processing complete, video is ready
 *   - 'failed'      — processing failed
 *   - 'rejected'    — video was rejected (policy violation)
 *   - 'terminated'  — video was terminated
 */
export async function fetchYouTubeVideoProcessingStatus(
  accessToken: string,
  videoId: string,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  const baseUrl = YOUTUBE_PROVIDER.baseUrl ?? 'https://www.googleapis.com/youtube/v3';
  const url = `${baseUrl}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`;
  const response = await (fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json() as {
    items?: Array<{ status: { uploadStatus?: string }; processingDetails?: { processingStatus?: string } }>;
  };
  const item = data.items?.[0];
  if (!item) return null;
  // processingDetails.processingStatus takes precedence once upload is complete
  return item.processingDetails?.processingStatus ?? item.status?.uploadStatus ?? null;
}

export type YouTubeUploadRow = typeof youtubeUploads.$inferSelect;

/** Transient failures one upload may absorb before it is written off. */
export const YOUTUBE_UPLOAD_MAX_ATTEMPTS = 8;

/** How long a claimed row is held before a sweep may assume its tick died. Longer
 *  than any tick runs (a handful of 8 MiB chunks), short enough that an evicted
 *  upload resumes on the next frequent tick. */
export const YOUTUBE_UPLOAD_LEASE_SECONDS = 120;

/** Base and ceiling of the exponential backoff after a transient failure. */
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_CEILING_SECONDS = 30 * 60;

/** Backoff after the Nth consecutive transient failure: 30s, 60s, 120s … capped at 30m. */
export function youtubeRetryDelaySeconds(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_CEILING_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (attempts - 1));
}

/** The same backoff, in SQL, so the claim predicate and the function cannot disagree. */
// Constants are inlined (`sql.raw`), not bound: they are ours, and an untyped bound
// parameter beside `INTERVAL` arithmetic leaves Postgres guessing its type.
const backoffSeconds = sql`LEAST(${sql.raw(String(BACKOFF_CEILING_SECONDS))}, ${sql.raw(String(BACKOFF_BASE_SECONDS))} * POWER(2, GREATEST(${youtubeUploads.attempts} - 1, 0)))`;

/** A row a tick may take now: claimable and past its backoff, or claimed and past its lease. */
const claimable = or(
  and(
    eq(youtubeUploads.state, 'queued'),
    or(
      eq(youtubeUploads.attempts, 0),
      sql`${youtubeUploads.updatedAt} <= NOW() - (${backoffSeconds} * INTERVAL '1 second')`,
    ),
  ),
  and(
    eq(youtubeUploads.state, 'uploading'),
    sql`${youtubeUploads.updatedAt} <= NOW() - (${sql.raw(String(YOUTUBE_UPLOAD_LEASE_SECONDS))} * INTERVAL '1 second')`,
  ),
);

/** What callers see — the status shown on the canvas tile and the campaign row. */
export interface YouTubeUploadView {
  id: string;
  /** `uploading` covers "between ticks with progress" too: a person reads progress, not lease state. */
  state: 'queued' | 'uploading' | 'processing' | 'succeeded' | 'failed';
  percent: number;
  bytesSent: number;
  byteSize: number;
  videoId: string | null;
  url: string | null;
  privacyStatus: string;
  error: string | null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeUploadView(row: YouTubeUploadRow): YouTubeUploadView {
  const state: YouTubeUploadView['state'] = row.state === 'succeeded' || row.state === 'failed'
    ? row.state
    : row.state === 'uploading' || row.state === 'processing' || row.bytesSent > 0 || row.uploadUrl ? 'uploading' : 'queued';
  return {
    id: row.id,
    state,
    percent: row.state === 'succeeded' ? 100 : uploadPercent(row.bytesSent, row.byteSize),
    bytesSent: row.bytesSent,
    byteSize: row.byteSize,
    videoId: row.videoId,
    url: row.videoId ? youtubeWatchUrl(row.videoId) : null,
    privacyStatus: row.privacyStatus,
    error: row.state === 'failed' ? row.lastError : null,
  };
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueYouTubeUploadInput {
  tenantId: number;
  userId: string;
  /** The kernel `connections` row (vendor 'google', capability 'youtube'). */
  connectionId: number;
  /** Exactly one: an R2 key under the tenant's prefix, or a public https URL. */
  source: { storageKey: string } | { sourceUrl: string };
  mimeType?: string;
  title: string;
  description?: string;
  privacyStatus: YouTubePrivacy;
  campaignPostId?: number | null;
  sessionId?: string | null;
  objectId?: string | null;
}

export class YouTubeUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'YouTubeUploadError';
  }
}

export async function enqueueYouTubeUpload(db: Db, env: Env, input: EnqueueYouTubeUploadInput): Promise<YouTubeUploadRow> {
  const title = input.title.trim().slice(0, 100);
  if (!title) throw new YouTubeUploadError('A YouTube upload needs a title.');
  if ('storageKey' in input.source && !input.source.storageKey.startsWith(`${input.tenantId}/`)) {
    // A key outside the caller's prefix is another tenant's object; say "not found".
    throw new YouTubeUploadError('Video artifact not found.', 404);
  }
  const [row] = await db.insert(youtubeUploads).values({
    tenantId: input.tenantId,
    userId: input.userId,
    connectionId: input.connectionId,
    ...('storageKey' in input.source ? { storageKey: input.source.storageKey } : { sourceUrl: input.source.sourceUrl }),
    mimeType: input.mimeType?.startsWith('video/') ? input.mimeType : 'video/mp4',
    title,
    description: (input.description ?? '').slice(0, 5_000),
    privacyStatus: input.privacyStatus,
    state: 'queued',
    ...(input.campaignPostId != null ? { campaignPostId: input.campaignPostId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.objectId ? { objectId: input.objectId } : {}),
  }).returning();
  if (!row) throw new YouTubeUploadError('The YouTube upload could not be queued.', 500);
  // The frequent cron is KV-gated; a queued upload is exactly the work it must hear about.
  await signalPendingWork(env);
  return row;
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

/** Called once when an upload reaches `succeeded` or `failed` — the write-back seam. */
export type YouTubeUploadSettled = (db: Db, env: Env, upload: YouTubeUploadRow) => Promise<void>;

export interface AdvanceYouTubeUploadOptions {
  maxChunks?: number;
  chunkBytes?: number;
  fetchImpl?: typeof fetch;
  onSettled?: YouTubeUploadSettled;
}

/** Take the row for one tick, or learn another tick holds it. Atomic: the predicate is
 *  re-evaluated against the locked row, so two concurrent claims cannot both win. */
async function claim(db: Db, row: YouTubeUploadRow): Promise<YouTubeUploadRow | null> {
  const [claimed] = await db.update(youtubeUploads)
    .set({ state: 'uploading', startedAt: row.startedAt ?? new Date(), updatedAt: new Date() })
    .where(scopedToTenant(youtubeUploads, row.tenantId, eq(youtubeUploads.id, row.id), claimable))
    .returning();
  return claimed ?? null;
}

function sourceFor(env: Env, row: YouTubeUploadRow, fetchImpl?: typeof fetch): YouTubeUploadSource {
  if (row.storageKey) return r2UploadSource(env.UPLOADS, row.storageKey);
  if (row.sourceUrl) return urlUploadSource(row.sourceUrl, fetchImpl);
  return { describe: async () => ({ size: 0, contentType: null }), read: async () => new ArrayBuffer(0) };
}

/** A token problem is terminal only when the grant itself is dead. */
function tokenTick(row: YouTubeUploadRow, error: unknown): YouTubeUploadTick {
  const message = error instanceof Error ? error.message : 'The YouTube connection could not be used.';
  const terminal = /reconnect|not connected/i.test(message) || isTerminalRefreshFailure(message);
  return terminal
    ? { kind: 'failed', error: message }
    : { kind: 'retry', uploadUrl: row.uploadUrl, bytesSent: row.bytesSent, byteSize: row.byteSize, mimeType: row.mimeType, error: message };
}

/** The row patch one tick's outcome implies. Pure, so the state machine is testable. */
export function patchForTick(row: YouTubeUploadRow, tick: YouTubeUploadTick, now = new Date()): Partial<typeof youtubeUploads.$inferInsert> {
  switch (tick.kind) {
    case 'progress':
      return { state: 'queued', uploadUrl: tick.uploadUrl, bytesSent: tick.bytesSent, byteSize: tick.byteSize, mimeType: tick.mimeType, attempts: 0, lastError: null, updatedAt: now };
    case 'succeeded':
      return {
        state: 'succeeded', uploadUrl: tick.uploadUrl, bytesSent: tick.bytesSent, byteSize: tick.byteSize, mimeType: tick.mimeType,
        videoId: tick.videoId, privacyStatus: tick.privacyStatus, processingStatus: tick.processingStatus,
        lastError: null, completedAt: now, updatedAt: now,
      };
    case 'retry': {
      const attempts = row.attempts + 1;
      if (attempts >= YOUTUBE_UPLOAD_MAX_ATTEMPTS) {
        return { state: 'failed', attempts, lastError: `${tick.error} (gave up after ${attempts} attempts)`.slice(0, 1000), completedAt: now, updatedAt: now };
      }
      return { state: 'queued', uploadUrl: tick.uploadUrl, bytesSent: tick.bytesSent, byteSize: tick.byteSize, mimeType: tick.mimeType, attempts, lastError: tick.error.slice(0, 1000), updatedAt: now };
    }
    case 'failed':
      return { state: 'failed', lastError: tick.error.slice(0, 1000), completedAt: now, updatedAt: now };
  }
}

/**
 * Run one tick of `row` if it is claimable now, and persist what happened.
 *
 * Returns the row as it now stands — unchanged when another tick holds it, which is
 * not an error: the caller is simply told where the upload is.
 */
export async function advanceYouTubeUpload(
  db: Db, env: Env, row: YouTubeUploadRow, opts: AdvanceYouTubeUploadOptions = {},
): Promise<YouTubeUploadRow> {
  if (row.state === 'succeeded' || row.state === 'failed') return row;
  const claimed = await claim(db, row);
  if (!claimed) return row;

  let tick: YouTubeUploadTick;
  try {
    const accessToken = await freshYouTubeToken(db, env, claimed.tenantId, claimed.userId, claimed.connectionId);
    tick = await runYouTubeUploadTick({
      uploadUrl: claimed.uploadUrl,
      bytesSent: claimed.bytesSent,
      byteSize: claimed.byteSize,
      mimeType: claimed.mimeType,
      title: claimed.title,
      description: claimed.description,
      privacyStatus: claimed.privacyStatus as YouTubePrivacy,
    }, {
      accessToken,
      source: sourceFor(env, claimed, opts.fetchImpl),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.chunkBytes ? { chunkBytes: opts.chunkBytes } : {}),
      ...(opts.maxChunks ? { maxChunks: opts.maxChunks } : {}),
    });
  } catch (error) {
    tick = tokenTick(claimed, error);
  }

  const [updated] = await db.update(youtubeUploads).set(patchForTick(claimed, tick))
    .where(scopedToTenant(youtubeUploads, claimed.tenantId, eq(youtubeUploads.id, claimed.id)))
    .returning();
  const next = updated ?? claimed;

  // If the upload succeeded, poll YouTube for processing status and transition to 'processing' if needed
  if (next.state === 'succeeded' && next.videoId) {
    try {
      const accessToken = await freshYouTubeToken(db, env, next.tenantId, next.userId, next.connectionId);
      const processingStatus = await fetchYouTubeVideoProcessingStatus(accessToken, next.videoId, opts.fetchImpl);
      if (processingStatus === 'processing') {
        // Transition to 'processing' state to keep the post 'uploading' until YouTube finishes
        await db.update(youtubeUploads)
          .set({ state: 'processing', processingStatus, updatedAt: new Date() })
          .where(scopedToTenant(youtubeUploads, next.tenantId, eq(youtubeUploads.id, next.id)));
        return { ...next, state: 'processing', processingStatus };
      } else if (processingStatus === 'processed' || processingStatus === 'failed' || processingStatus === 'rejected' || processingStatus === 'terminated') {
        // Update the processing status and keep state as succeeded (terminal)
        await db.update(youtubeUploads)
          .set({ processingStatus, updatedAt: new Date() })
          .where(scopedToTenant(youtubeUploads, next.tenantId, eq(youtubeUploads.id, next.id)));
      }
    } catch (error) {
      // If polling fails, leave the upload as succeeded (terminal) and log the error
      reportCaughtError(error, {
        source: 'application/youtube/youtubeUploadJobs.ts',
        operation: 'fetchYouTubeVideoProcessingStatus',
        context: { uploadId: next.id, videoId: next.videoId },
      });
    }
  }

  if (next.state === 'succeeded') {
    await db.update(credentials).set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(credentials.connectionId, next.connectionId), eq(credentials.tenantId, next.tenantId)));
  }
  if (next.state === 'succeeded' || next.state === 'failed') {
    // A write-back failure must not undo the upload: the video IS on YouTube. The
    // campaign batch reconciles a post whose write-back was lost.
    if (opts.onSettled) {
      await opts.onSettled(db, env, next).catch((error: unknown) => reportCaughtError(error, {
        source: 'application/youtube/youtubeUploadJobs.ts',
        operation: 'onSettled',
        context: { uploadId: next.id },
      }));
    }
  } else {
    // More to send: make sure the gated cron runs, whether or not a tab keeps driving it.
    await signalPendingWork(env);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One upload, as its owner may see it. */
export async function getYouTubeUpload(db: Db, tenantId: number, userId: string, id: string): Promise<YouTubeUploadRow | null> {
  const [row] = await db.select().from(youtubeUploads)
    .where(scopedToTenant(youtubeUploads, tenantId, eq(youtubeUploads.id, id), eq(youtubeUploads.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** The latest upload behind each campaign post, in ONE query. */
export async function youtubeUploadsForPosts(db: Db, tenantId: number, postIds: readonly number[]): Promise<Map<number, YouTubeUploadRow>> {
  const out = new Map<number, YouTubeUploadRow>();
  if (postIds.length === 0) return out;
  const rows = await db.select().from(youtubeUploads)
    .where(scopedToTenant(youtubeUploads, tenantId, inArray(youtubeUploads.campaignPostId, [...postIds])))
    .orderBy(asc(youtubeUploads.createdAt));
  // Oldest first, so the newest attempt per post wins the map.
  for (const row of rows) if (row.campaignPostId != null) out.set(row.campaignPostId, row);
  return out;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/** Claimable uploads across every tenant, oldest-touched first. */
export async function dueYouTubeUploads(db: Db, limit = 3): Promise<YouTubeUploadRow[]> {
  return db.select().from(youtubeUploads)
    // Cross-tenant by design: the sweep serves every workspace. Each row carries its
    // own tenant, and every write after this read is scoped to it.
    .where(acrossTenants(youtubeUploads, 'scheduled_sweep', inArray(youtubeUploads.state, ['queued', 'uploading', 'processing']), claimable))
    .orderBy(asc(youtubeUploads.updatedAt))
    .limit(limit);
}

/**
 * Advance every claimable upload by one tick.
 *
 * This is what makes the upload survive the request that started it: a tab closed
 * mid-upload, an evicted isolate and a 5xx all end with a `queued` row the next
 * frequent tick picks up from the offset Google confirmed.
 */
export async function runYouTubeUploadSweep(
  env: Env, db: Db, opts: { maxUploads?: number; maxChunks?: number; onSettled?: YouTubeUploadSettled } = {},
): Promise<{ uploads: number; succeeded: number; failed: number; progressed: number }> {
  const due = await dueYouTubeUploads(db, opts.maxUploads ?? 3);
  let succeeded = 0;
  let failed = 0;
  let progressed = 0;
  for (const row of due) {
    try {
      const next = await advanceYouTubeUpload(db, env, row, {
        maxChunks: opts.maxChunks ?? 6,
        ...(opts.onSettled ? { onSettled: opts.onSettled } : {}),
      });
      if (next.state === 'succeeded') succeeded += 1;
      else if (next.state === 'failed') failed += 1;
      else if (next.bytesSent > row.bytesSent) progressed += 1;
    } catch (error) {
      // One tenant's broken upload must not stop the tick for everyone else.
      reportCaughtError(error, {
        source: 'application/youtube/youtubeUploadJobs.ts',
        operation: 'runYouTubeUploadSweep',
        context: { uploadId: row.id },
      });
    }
  }
  return { uploads: due.length, succeeded, failed, progressed };
}
