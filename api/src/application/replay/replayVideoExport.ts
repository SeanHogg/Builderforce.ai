/**
 * MP4 export of one kept recording (PRD 33 D10, §8 S4b).
 *
 * A replay is a DOM reconstruction, so a video is RENDERED: the QA runner container
 * (job kind `replay_export` — no new queue, no new container) opens the CDN player
 * bundle in headless Chromium, plays the chunks with `skipInactive`, records the page
 * and uploads the file back. Flow:
 *
 *   requestExport   member, POST  → row `queued` + runner dispatch (or `unavailable`)
 *   runner          GET chunks, PATCH running|failed, POST video → `done`
 *   exportStatus    member, GET   → cached 5 s
 *   downloadExport  member, GET   → streams `replay-exports/t<tenant>/<id>.<ext>`
 *
 * METERING. An export costs {@link REPLAY_EXPORT_UNITS}, charged ONCE through the one
 * usage module (`chargeUnits`) under the ledger reference `replay-export:<exportId>`,
 * and only when the file is DELIVERED: a render that fails, or a deploy with no
 * runner (`unavailable`), costs nothing. Affordability is checked up front so a
 * request that cannot be paid for is refused before any work starts.
 *
 * RUNNER AUTH. The runner gets a capability token for exactly one export (an opaque
 * JWT: type, tenant, export id, one-hour expiry) rather than the tenant-wide QA agent
 * token. Its claims deliberately carry no `tid`/`sub`, so the platform's user auth
 * rejects it everywhere else.
 */

import { REPLAY_PLAYER_GLOBAL, type ReplayExportDto, type ReplayManifest } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { signOpaqueJwt, verifyOpaqueJwt } from '../../infrastructure/auth/JwtService';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { DAY_MS, MINUTE_MS } from '../../domain/shared/time';
import { dispatchQaRunnerJob, qaRunnerProvisioned } from '../qa/dispatchQaRunner';
import { loadRecorderManifest } from './ReplayConfigService';
import { ReplayReadService } from './ReplayReadService';
import { replayReadKeys } from './replayCacheKeys';
import { listChunkSeqs } from './replayChunkStore';
import {
  EXPORT_CONTENT_TYPES,
  EXPORT_RETENTION_DAYS,
  EXPORT_TRANSITIONS,
  exportObjectKey,
  findExport,
  findExportForRunner,
  findReusableExport,
  formatOfContentType,
  insertExport,
  moveExport,
  toExportDto,
  type ExportRow,
} from './replayExportStore';
import { chargeUnits, hasUnits } from './replayUsage';

/** What one export costs (D10). */
export const REPLAY_EXPORT_UNITS = 10;
/** Largest file the runner may upload (a Worker request body tops out near 100 MB). */
export const MAX_EXPORT_BYTES = 95 * 1024 * 1024;
/** A queued/running export older than this is presumed dead and may be requested again. */
export const EXPORT_STALE_MS = 30 * MINUTE_MS;
const TOKEN_TTL_SECONDS = 60 * 60;
const STATUS_BUCKET_MS = 5_000;
const EXPORT_TOKEN_TYPE = 'replay-export';
/** Where the runner's callbacks are mounted (under `/api/replay`). */
export const EXPORT_RUNNER_PREFIX = '/api/replay/export-runner';

/** Machine-readable `error` values the frontend translates (`replay.export.error.<code>`). */
export const EXPORT_ERRORS = {
  runnerUnavailable: 'runner_unavailable',
  insufficientUnits: 'insufficient_units',
  noChunks: 'no_chunks',
  dispatchFailed: 'dispatch_failed',
  timedOut: 'timed_out',
} as const;

/** The ledger reference of an export's one charge — its idempotency key. */
export function replayExportReference(exportId: string): string {
  return `replay-export:${exportId}`;
}

/** The player bundle + stylesheet from the CDN manifest, or null when not published. */
export function playerAssets(manifest: unknown): { url: string; cssUrl: string } | null {
  const player = (manifest as Partial<ReplayManifest> | null)?.player;
  if (!player || typeof player.url !== 'string' || typeof player.cssUrl !== 'string') return null;
  if (!player.url.startsWith('https://') || !player.cssUrl.startsWith('https://')) return null;
  return { url: player.url, cssUrl: player.cssUrl };
}

interface ExportClaims {
  typ: string;
  /** Tenant — NOT `tid`, so the user auth middleware never accepts this token. */
  xt: number;
  eid: string;
  exp: number;
}

export async function mintExportToken(env: Env, tenantId: number, exportId: string, now: Date = new Date()): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS;
  return signOpaqueJwt({ typ: EXPORT_TOKEN_TYPE, xt: tenantId, eid: exportId, exp }, env.JWT_SECRET);
}

/** The export a runner callback acts on: the token must name exactly this export. */
export async function authorizeExportRunner(env: Env, db: Db, authorization: string | undefined, exportId: string): Promise<ExportRow> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new UnauthorizedError('Missing export token');
  let claims: ExportClaims;
  try {
    claims = await verifyOpaqueJwt<ExportClaims>(token, env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired export token');
  }
  if (claims.typ !== EXPORT_TOKEN_TYPE || claims.eid !== exportId || !Number.isInteger(claims.xt)) {
    throw new UnauthorizedError('Export token does not match this export');
  }
  const row = await findExportForRunner(db, claims.xt, exportId);
  if (!row) throw new NotFoundError('Export', exportId);
  return row;
}

/** The `replay_export` job body the runner reads (`api/qa-container/replayExport.mjs`). */
function jobPayload(
  env: Env,
  input: { exportId: string; token: string; seqs: number[]; player: { url: string; cssUrl: string }; viewport: { w: number; h: number }; durationMs: number },
): Record<string, unknown> {
  const base = (env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
  const runner = `${base}${EXPORT_RUNNER_PREFIX}/${encodeURIComponent(input.exportId)}`;
  return {
    exportId: input.exportId,
    exportToken: input.token,
    chunkUrls: input.seqs.map((seq) => `${runner}/chunks/${seq}`),
    statusUrl: runner,
    uploadUrl: `${runner}/video`,
    playerUrl: input.player.url,
    playerCssUrl: input.player.cssUrl,
    playerGlobal: REPLAY_PLAYER_GLOBAL,
    viewport: input.viewport,
    durationMs: input.durationMs,
  };
}

/** Request an export of one recording. Reuses a live or finished one; never charges here. */
export async function requestExport(
  env: Env,
  db: Db,
  scope: ReplayScope,
  recordingId: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<ReplayExportDto> {
  if (!isUuid(recordingId)) throw new NotFoundError('Recording', recordingId);
  const recording = await new ReplayReadService(env, db).getRecording(scope, recordingId);

  const since = new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS);
  const existing = await findReusableExport(db, scope, recordingId, since);
  if (existing) {
    const stale = existing.status !== 'done' && now.getTime() - existing.createdAt.getTime() > EXPORT_STALE_MS;
    if (!stale) return toExportDto(existing);
    await moveExport(db, scope.tenantId, existing.id, 'failed', { error: EXPORT_ERRORS.timedOut });
  }

  const base = { scope, recordingId, requestedBy: userId };
  const player = qaRunnerProvisioned(env) ? playerAssets(await loadRecorderManifest(env)) : null;
  if (!player) {
    return toExportDto(await insertExport(db, { ...base, status: 'unavailable', error: EXPORT_ERRORS.runnerUnavailable }));
  }
  if (!(await hasUnits(env, db, scope.tenantId, REPLAY_EXPORT_UNITS, now))) {
    return toExportDto(await insertExport(db, { ...base, status: 'failed', error: EXPORT_ERRORS.insufficientUnits }));
  }
  const seqs = await listChunkSeqs(env, {
    tenantId: scope.tenantId,
    siteId: scope.siteId,
    recordingId,
    startedAt: new Date(recording.startedAt),
  });
  if (seqs.length === 0) {
    return toExportDto(await insertExport(db, { ...base, status: 'failed', error: EXPORT_ERRORS.noChunks }));
  }

  const row = await insertExport(db, { ...base, status: 'queued' });
  const token = await mintExportToken(env, scope.tenantId, row.id, now);
  const dispatched = await dispatchQaRunnerJob(env, {
    kind: 'replay_export',
    jobId: row.id,
    payload: jobPayload(env, {
      exportId: row.id,
      token,
      seqs,
      player,
      viewport: recording.viewport,
      durationMs: recording.durationMs,
    }),
  }).catch(() => false);
  if (!dispatched) {
    const failed = await moveExport(db, scope.tenantId, row.id, 'failed', { error: EXPORT_ERRORS.dispatchFailed });
    return toExportDto(failed ?? row);
  }
  return toExportDto(row);
}

/** An export's status for its member (cached per 5-second bucket). */
export async function exportStatus(env: Env, db: Db, scope: ReplayScope, exportId: string, now: Date = new Date()): Promise<ReplayExportDto> {
  if (!isUuid(exportId)) throw new NotFoundError('Export', exportId);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.exportStatus(exportId, Math.floor(now.getTime() / STATUS_BUCKET_MS)), async () => {
    const row = await findExport(db, scope, exportId);
    if (!row) throw new NotFoundError('Export', exportId);
    return toExportDto(row);
  }, { kvTtlSeconds: 60, l1TtlMs: STATUS_BUCKET_MS });
}

/** The finished file, streamed. 404 until the export is done. */
export async function downloadExport(
  env: Env,
  db: Db,
  scope: ReplayScope,
  exportId: string,
): Promise<{ body: ReadableStream; contentType: string; size: number; filename: string }> {
  if (!isUuid(exportId)) throw new NotFoundError('Export', exportId);
  const row = await findExport(db, scope, exportId);
  if (!row || row.status !== 'done' || !row.r2Key) throw new NotFoundError('Export', exportId);
  const object = await env.UPLOADS?.get(row.r2Key);
  if (!object) throw new NotFoundError('Export', exportId);
  const format = row.format === 'webm' ? 'webm' : 'mp4';
  return {
    body: object.body,
    contentType: EXPORT_CONTENT_TYPES[format],
    size: object.size,
    filename: `recording-${row.recordingId}.${format}`,
  };
}

// ── Runner callbacks (the export's capability token, never a member) ───────────

/** One stored chunk of the export's recording, for the runner. */
export async function runnerChunk(env: Env, db: Db, row: ExportRow, seq: number): Promise<ArrayBuffer> {
  return new ReplayReadService(env, db).chunk({ tenantId: row.tenantId, siteId: row.siteId }, row.recordingId, seq);
}

/** The runner reports progress or failure. A move from a terminal status is ignored. */
export async function runnerReport(
  db: Db,
  row: ExportRow,
  input: { status: 'running' | 'failed'; error?: string | null },
): Promise<ReplayExportDto> {
  const moved = await moveExport(db, row.tenantId, row.id, input.status, input.status === 'failed' ? { error: input.error ?? 'render_failed' } : {});
  return toExportDto(moved ?? row);
}

/**
 * The runner delivers the file: store it, mark the export done and charge its units
 * — once. A retried upload of a finished export changes nothing and charges nothing.
 */
export async function runnerUpload(
  env: Env,
  db: Db,
  row: ExportRow,
  input: { contentType: string | undefined; length: number | null; body: ReadableStream | ArrayBuffer },
): Promise<ReplayExportDto> {
  if (row.status === 'done') return toExportDto(row);
  if (!(EXPORT_TRANSITIONS.done as readonly string[]).includes(row.status)) throw new ConflictError('This export is no longer open');
  const format = formatOfContentType(input.contentType);
  if (!format) throw new ValidationError('The export must be video/mp4 or video/webm');
  const length = input.body instanceof ArrayBuffer ? input.body.byteLength : input.length;
  if (!length || length <= 0) throw new ValidationError('The export body is empty or has no length');
  if (length > MAX_EXPORT_BYTES) throw new ValidationError(`The export exceeds ${MAX_EXPORT_BYTES} bytes`);
  const bucket = env.UPLOADS;
  if (!bucket) throw new ServiceUnavailableError('Object storage is not configured');

  const key = exportObjectKey(row.tenantId, row.id, format);
  const options = {
    httpMetadata: { contentType: EXPORT_CONTENT_TYPES[format] },
    customMetadata: { tenantId: String(row.tenantId), exportId: row.id },
  };
  if (input.body instanceof ArrayBuffer) {
    await bucket.put(key, input.body, options);
  } else {
    // R2 needs a stream of known length; the Workers runtime provides FixedLengthStream.
    const Fixed = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream }).FixedLengthStream;
    if (!Fixed) {
      await bucket.put(key, await new Response(input.body).arrayBuffer(), options);
    } else {
      const fixed = new Fixed(length);
      await Promise.all([bucket.put(key, fixed.readable, options), input.body.pipeTo(fixed.writable)]);
    }
  }

  const done = await moveExport(db, row.tenantId, row.id, 'done', { format, r2Key: key, error: null });
  if (!done) {
    // Another delivery of the same export won the move; it charged, this one does not.
    const current = await findExportForRunner(db, row.tenantId, row.id);
    return toExportDto(current ?? row);
  }
  await chargeUnits(env, db, {
    tenantId: row.tenantId,
    siteId: row.siteId,
    recordingId: row.recordingId,
    unitIndex: 0,
    units: REPLAY_EXPORT_UNITS,
    reference: replayExportReference(row.id),
    memo: `Insights export ${row.id} · recording ${row.recordingId}`,
  });
  return toExportDto(done);
}
