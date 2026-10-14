/**
 * `replay_page_captures` rows and their R2 objects (PRD 33 §3.2, §5.2) — the storage
 * half of the page review. The runner callback is the ONE writer of a capture row
 * (`recordCapture` in `pageCapture.ts`); everything here is the storage it uses and
 * the reads a member makes. The core table hangs off `replay_sites`, so every
 * statement carries the site id the scope already bound to the caller's workspace.
 *
 *   R2: replay/pages/t<tenant>/<site>/<release>/<pathHash>-<device>-<screenshot|fold|rects>.<jpg|json>
 *       replay/pages/t<tenant>/<site>/after/<prescriptionId>-<device>.jpg
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  fnv1a64,
  REPLAY_PATHS,
  type PageRect,
  type ReplayCaptureDevice,
  type ReplayPageA11yFacts,
  type ReplayPageCaptureDto,
  type ReplayPageContentFacts,
  type ReplayPageLabPerf,
  type ReplayPageScoreDto,
  type ReplayPageSeoFacts,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPageCaptures } from '../../infrastructure/database/schema';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../domain/shared/errors';
import { asJsonObject } from '../../domain/shared/json';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';

export type CaptureRow = typeof replayPageCaptures.$inferSelect;

export const PAGE_CAPTURE_PREFIX = 'replay/pages/';

/** What a runner may upload for a capture, and what a member may read back. */
export const CAPTURE_ASSETS = {
  screenshot: { ext: 'jpg', contentType: 'image/jpeg', maxBytes: 8 * 1024 * 1024 },
  fold: { ext: 'jpg', contentType: 'image/jpeg', maxBytes: 2 * 1024 * 1024 },
  rects: { ext: 'json', contentType: 'application/json', maxBytes: 512 * 1024 },
} as const;
export type CaptureAsset = keyof typeof CAPTURE_ASSETS;

/** The after-render assets a member may read (`capturesAsset` with `after-desktop` / `after-phone`). */
export const AFTER_ASSETS = { 'after-desktop': 'desktop', 'after-phone': 'phone' } as const;
export type AfterAsset = keyof typeof AFTER_ASSETS;
const AFTER_MAX_BYTES = 8 * 1024 * 1024;

export const isCaptureAsset = (value: string): value is CaptureAsset => Object.prototype.hasOwnProperty.call(CAPTURE_ASSETS, value);
export const isAfterAsset = (value: string): value is AfterAsset => Object.prototype.hasOwnProperty.call(AFTER_ASSETS, value);
export const isCaptureDevice = (value: unknown): value is ReplayCaptureDevice => value === 'desktop' || value === 'phone';

const releaseSegment = (releaseKey: string) => encodeURIComponent(releaseKey || 'none');

export function captureAssetKey(
  input: { tenantId: number; siteId: string; releaseKey: string; path: string; device: ReplayCaptureDevice },
  asset: CaptureAsset,
): string {
  return `${PAGE_CAPTURE_PREFIX}t${input.tenantId}/${input.siteId}/${releaseSegment(input.releaseKey)}/${fnv1a64(input.path)}-${input.device}-${asset}.${CAPTURE_ASSETS[asset].ext}`;
}

export function afterAssetKey(input: { tenantId: number; siteId: string; prescriptionId: string; device: ReplayCaptureDevice }): string {
  return `${PAGE_CAPTURE_PREFIX}t${input.tenantId}/${input.siteId}/after/${input.prescriptionId}-${input.device}.jpg`;
}

/** The R2 prefix of every capture of a site (the retention sweep and erase delete under it). */
export const siteCapturePrefix = (tenantId: number, siteId: string) => `${PAGE_CAPTURE_PREFIX}t${tenantId}/${siteId}/`;

/** Store one runner upload under its deterministic key. */
export async function putObject(
  env: Env,
  key: string,
  input: { contentType: string | undefined; body: ArrayBuffer; expected: string; maxBytes: number },
): Promise<void> {
  const type = (input.contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (type !== input.expected) throw new ValidationError(`The upload must be ${input.expected}`);
  if (input.body.byteLength === 0) throw new ValidationError('The upload is empty');
  if (input.body.byteLength > input.maxBytes) throw new ValidationError(`The upload exceeds ${input.maxBytes} bytes`);
  const bucket = env.UPLOADS;
  if (!bucket) throw new ServiceUnavailableError('Object storage is not configured');
  await bucket.put(key, input.body, { httpMetadata: { contentType: input.expected } });
}

export const afterUploadLimits = { expected: 'image/jpeg', maxBytes: AFTER_MAX_BYTES } as const;

export interface CaptureFactsInput {
  seo: ReplayPageSeoFacts | null;
  content: ReplayPageContentFacts | null;
  labPerf: ReplayPageLabPerf | null;
  a11y: ReplayPageA11yFacts | null;
}

/** Upsert the capture of (site, path, release, device) — a re-capture of the same grain replaces it. */
export async function upsertCapture(
  db: Db,
  input: { tenantId: number; siteId: string; path: string; releaseKey: string; device: ReplayCaptureDevice; facts: CaptureFactsInput; now: Date },
): Promise<CaptureRow> {
  const keys = {
    screenshotKey: captureAssetKey(input, 'screenshot'),
    foldScreenshotKey: captureAssetKey(input, 'fold'),
    rectMapKey: captureAssetKey(input, 'rects'),
  };
  const values = {
    capturedAt: input.now,
    ...keys,
    seo: input.facts.seo,
    content: input.facts.content,
    labPerf: input.facts.labPerf,
    a11y: input.facts.a11y,
    score: null,
  };
  const [row] = await db
    .insert(replayPageCaptures)
    .values({ siteId: input.siteId, path: input.path, releaseKey: input.releaseKey, deviceClass: input.device, ...values })
    .onConflictDoUpdate({
      target: [replayPageCaptures.siteId, replayPageCaptures.path, replayPageCaptures.releaseKey, replayPageCaptures.deviceClass],
      set: values,
    })
    .returning();
  if (!row) throw new Error('replay page capture upsert returned no row');
  return row;
}

export async function setCaptureScore(db: Db, siteId: string, captureId: string, score: ReplayPageScoreDto): Promise<void> {
  await db.update(replayPageCaptures).set({ score }).where(and(eq(replayPageCaptures.siteId, siteId), eq(replayPageCaptures.id, captureId)));
}

/** A site's captures, newest first (optionally of some paths). */
export async function listCaptures(db: Db, siteId: string, opts: { paths?: readonly string[]; limit?: number } = {}): Promise<CaptureRow[]> {
  if (opts.paths && opts.paths.length === 0) return [];
  return db
    .select()
    .from(replayPageCaptures)
    .where(and(
      eq(replayPageCaptures.siteId, siteId),
      opts.paths ? inArray(replayPageCaptures.path, [...opts.paths]) : undefined,
    ))
    .orderBy(desc(replayPageCaptures.capturedAt))
    .limit(opts.limit ?? 500);
}

/** One capture inside the scope; 404 outside it. */
export async function findCapture(db: Db, scope: ReplayScope, captureId: string): Promise<CaptureRow> {
  if (!isUuid(captureId)) throw new NotFoundError('Capture', captureId);
  const [row] = await db
    .select()
    .from(replayPageCaptures)
    .where(and(eq(replayPageCaptures.siteId, scope.siteId), eq(replayPageCaptures.id, captureId)))
    .limit(1);
  if (!row) throw new NotFoundError('Capture', captureId);
  return row;
}

/** A member-authorised asset URL (`REPLAY_PATHS.capturesAsset`). */
export function captureAssetUrl(siteId: string, captureId: string, asset: CaptureAsset | AfterAsset): string {
  return `${REPLAY_PATHS.capturesAsset.replace(':captureId', encodeURIComponent(captureId)).replace(':asset', asset)}?site=${encodeURIComponent(siteId)}`;
}

const facts = <T extends object>(raw: unknown): T | null => asJsonObject<T>(raw);

export function scoreOf(raw: unknown): ReplayPageScoreDto | null {
  const s = asJsonObject<Record<string, unknown>>(raw);
  if (!s || typeof s.total !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { total: s.total, conversion: n(s.conversion), frustration: n(s.frustration), seo: n(s.seo), performance: n(s.performance), accessibility: n(s.accessibility) };
}

export function toCaptureDto(row: CaptureRow): ReplayPageCaptureDto {
  const at = row.capturedAt instanceof Date ? row.capturedAt : new Date(String(row.capturedAt));
  return {
    id: row.id,
    path: row.path,
    releaseKey: row.releaseKey,
    deviceClass: row.deviceClass === 'phone' ? 'phone' : 'desktop',
    capturedAt: at.toISOString(),
    screenshotUrl: row.screenshotKey ? captureAssetUrl(row.siteId, row.id, 'screenshot') : null,
    foldScreenshotUrl: row.foldScreenshotKey ? captureAssetUrl(row.siteId, row.id, 'fold') : null,
    seo: facts<ReplayPageSeoFacts>(row.seo),
    content: facts<ReplayPageContentFacts>(row.content),
    labPerf: facts<ReplayPageLabPerf>(row.labPerf),
    a11y: facts<ReplayPageA11yFacts>(row.a11y),
    score: scoreOf(row.score),
  };
}

/** The capture's rect map, or [] when it was never stored. */
export async function readRectMap(env: Env, row: Pick<CaptureRow, 'rectMapKey'>): Promise<PageRect[]> {
  if (!row.rectMapKey) return [];
  const object = await env.UPLOADS?.get(row.rectMapKey);
  if (!object) return [];
  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((r): r is PageRect => !!r && typeof r === 'object' && typeof (r as PageRect).selector === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The capture's fold screenshot as a `data:` URL (the vision request's image part), or null. */
export async function foldDataUrl(env: Env, row: Pick<CaptureRow, 'foldScreenshotKey'>): Promise<string | null> {
  if (!row.foldScreenshotKey) return null;
  const object = await env.UPLOADS?.get(row.foldScreenshotKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Stream one stored object to a member. */
export async function streamObject(env: Env, key: string | null | undefined, what: string): Promise<{ body: ReadableStream; contentType: string; size: number }> {
  if (!key) throw new NotFoundError('Asset', what);
  const object = await env.UPLOADS?.get(key);
  if (!object) throw new NotFoundError('Asset', what);
  return { body: object.body, contentType: object.httpMetadata?.contentType ?? 'application/octet-stream', size: object.size };
}
