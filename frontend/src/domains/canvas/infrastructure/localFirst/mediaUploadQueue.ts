/**
 * THE MEDIA UPLOAD QUEUE — move a board's local blobs to the tenant's private storage, then tell
 * the server about them.
 *
 * It drains the `canvas-media` manifests that are `local` (or were left `uploading` by a crash), when
 * the caller says an upload is possible (signed in, a tenant, online), through the app's one uploader
 * (`uploadCanvasFile` → `BRAIN_UPLOAD_PATH`, private visibility). A success is ONE transaction:
 *
 *   - the manifest becomes `uploaded` with its `storageKey` and is journaled (its first event);
 *   - every object of the board that referred to `media:<id>` is rewritten to the uploaded URL (and
 *     `storageKey`) and journaled, `dependsOn` the manifest's event — a normal edit, so peers get it,
 *     and the server never holds an object pointing at a blob it cannot serve.
 *
 * Failures retry on the next drain. After `maxAttempts` (5) the item is `failed`, is reported, and
 * waits for a person's manual `retry`. The local blob is evicted only once the object's rewrite has
 * synced AND a grace period (7 days) has passed (`evictUploaded`); thumbnails are the caller's.
 */

import { selectRecords, type LocalRecord } from '@builderforce/local-first';
import { reportLocalFirstFailure, type LocalFirstFailureSink } from '@/lib/localFirst/reportLocalFirstFailure';
import type { BlobStore } from './blobStore';
import type { BoardWriteContext } from './boardCommit';
import { writeRecord } from './boardJournal';
import { childRecordsOf } from './boardReplica';
import {
  CANVAS_MEDIA,
  CANVAS_OBJECT,
  eventKey,
  rewriteMediaRefs,
  mediaUrl,
  syncedMediaPayload,
  type MediaPayload,
  type ObjectPayload,
} from './boardRecords';

export const MAX_UPLOAD_ATTEMPTS = 5;
export const BLOB_EVICTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface UploadedFile { url: string; storageKey: string }
export type CanvasUploader = (file: File) => Promise<UploadedFile | null>;

export interface MediaUploadQueueOptions {
  ctx: BoardWriteContext;
  blobs: BlobStore;
  /** Whether an upload can happen now: signed in with a tenant, and online. */
  canUpload: () => boolean;
  /** `uploadCanvasFile` by default (loaded on first use, so the API client stays out of an offline boot). */
  upload?: CanvasUploader;
  maxAttempts?: number;
  report?: LocalFirstFailureSink;
}

export interface DrainResult {
  uploaded: string[];
  /** Back to `local` after a failed attempt, to be tried on the next drain. */
  retrying: string[];
  /** Out of attempts (or its bytes are gone): waits for a manual `retry`. */
  failed: string[];
}

const defaultUpload: CanvasUploader = async (file) => (await import('@/lib/canvasMediaStore')).uploadCanvasFile(file);

export function createMediaUploadQueue(options: MediaUploadQueueOptions) {
  const { ctx, blobs } = options;
  const maxAttempts = options.maxAttempts ?? MAX_UPLOAD_ATTEMPTS;
  const upload = options.upload ?? defaultUpload;
  const report = options.report ?? reportLocalFirstFailure;
  let draining: Promise<DrainResult> | undefined;

  /** A local-only change of a manifest (attempt bookkeeping): never journaled. */
  const setProgress = (mediaId: string, patch: Partial<MediaPayload>): Promise<LocalRecord<MediaPayload> | undefined> =>
    ctx.store.transact(async (tx) => {
      const media = await tx.get<MediaPayload>(CANVAS_MEDIA, mediaId);
      if (!media || media.deletedAt || media.payload.status === 'uploaded') return undefined;
      return writeRecord(tx, ctx, media, { entityType: CANVAS_MEDIA, id: mediaId, payload: { ...media.payload, ...patch }, destination: media.destination, boardId: media.payload.boardId, journal: false });
    });

  /** The success transaction: manifest uploaded, referring objects rewritten, both journaled. */
  const finish = (mediaId: string, uploaded: UploadedFile): Promise<boolean> =>
    ctx.store.transact(async (tx) => {
      const media = await tx.get<MediaPayload>(CANVAS_MEDIA, mediaId);
      if (!media || media.deletedAt || media.payload.status === 'uploaded') return false;
      const payload: MediaPayload = { ...media.payload, status: 'uploaded', storageKey: uploaded.storageKey };
      const written = await writeRecord(tx, ctx, media, {
        entityType: CANVAS_MEDIA, id: mediaId, payload, destination: media.destination, boardId: payload.boardId, syncPayload: syncedMediaPayload(payload),
      });
      const children = await childRecordsOf(tx, payload.boardId);
      for (const object of children.objects) {
        if (!JSON.stringify(object.payload).includes(mediaUrl(mediaId))) continue;
        await writeRecord<ObjectPayload>(tx, ctx, object, {
          entityType: CANVAS_OBJECT,
          id: object.id,
          payload: rewriteMediaRefs(object.payload, mediaId, uploaded),
          destination: object.destination,
          boardId: payload.boardId,
          dependsOn: [eventKey(CANVAS_MEDIA, mediaId, written.version)],
        });
      }
      return true;
    });

  async function attempt(media: LocalRecord<MediaPayload>, result: DrainResult): Promise<void> {
    const attempts = (media.payload.attempts ?? 0) + 1;
    await setProgress(media.id, { status: 'uploading', attempts });
    const exhausted = async (why: unknown): Promise<void> => {
      const failedNow = attempts >= maxAttempts;
      await setProgress(media.id, { status: failedNow ? 'failed' : 'local', attempts });
      (failedNow ? result.failed : result.retrying).push(media.id);
      if (failedNow) report('mediaUploadQueue.exhausted', why instanceof Error ? why : new Error(String(why)));
    };
    const blob = await blobs.get(media.id);
    if (!blob) {
      // The bytes are gone: no retry can fix that.
      await setProgress(media.id, { status: 'failed', attempts });
      result.failed.push(media.id);
      report('mediaUploadQueue.blobMissing', new Error(`blob_missing: ${media.id}`));
      return;
    }
    let uploaded: UploadedFile | null = null;
    try {
      uploaded = await upload(new File([blob], media.payload.name, { type: media.payload.mimeType }));
    } catch (error) {
      await exhausted(error);
      return;
    }
    if (!uploaded) {
      await exhausted(new Error('upload_returned_nothing'));
      return;
    }
    if (await finish(media.id, uploaded)) result.uploaded.push(media.id);
  }

  async function run(): Promise<DrainResult> {
    const result: DrainResult = { uploaded: [], retrying: [], failed: [] };
    if (!options.canUpload()) return result;
    const due = await ctx.store.read((tx) => selectRecords<MediaPayload>(tx, CANVAS_MEDIA, (row) =>
      !row.deletedAt && row.destination.kind === 'bound' && (row.payload.status === 'local' || row.payload.status === 'uploading')));
    for (const media of due) {
      if (!options.canUpload()) break;
      try {
        await attempt(media, result);
      } catch (error) {
        report('mediaUploadQueue.attempt', error);
        result.retrying.push(media.id);
      }
    }
    return result;
  }

  /** Drain every due manifest once. Single-flight: a second call joins the running one. */
  const drain = (): Promise<DrainResult> => {
    draining ??= run().finally(() => { draining = undefined; });
    return draining;
  };

  return {
    drain,
    /** A person's retry of a `failed` item: back to `local` with a fresh attempt count, then drained. */
    async retry(mediaId: string): Promise<DrainResult> {
      await ctx.store.transact(async (tx) => {
        const media = await tx.get<MediaPayload>(CANVAS_MEDIA, mediaId);
        if (!media || media.deletedAt || media.payload.status !== 'failed') return;
        await writeRecord(tx, ctx, media, { entityType: CANVAS_MEDIA, id: mediaId, payload: { ...media.payload, status: 'local', attempts: 0 }, destination: media.destination, boardId: media.payload.boardId, journal: false });
      });
      return drain();
    },
    /**
     * Delete the local blobs of media that are `uploaded`, whose rewrite no longer has a pending event,
     * and that were last written more than `graceMs` ago. Returns the ids evicted.
     */
    async evictUploaded(graceMs: number = BLOB_EVICTION_GRACE_MS): Promise<string[]> {
      const cutoff = (ctx.now?.() ?? new Date()).getTime() - graceMs;
      const candidates = await ctx.store.read(async (tx) => {
        const uploaded = await selectRecords<MediaPayload>(tx, CANVAS_MEDIA, (row) => !row.deletedAt && row.payload.status === 'uploaded' && Date.parse(row.updatedAt) <= cutoff);
        const owed = new Set<string>();
        await tx.scanPending((event) => { if (!event.deadLetter) owed.add((event.payload as { boardId?: string } | null)?.boardId ?? event.clientEntityId); });
        return uploaded.filter((row) => !owed.has(row.payload.boardId) && !owed.has(row.id));
      });
      const evicted: string[] = [];
      for (const media of candidates) {
        await blobs.delete(media.id);
        evicted.push(media.id);
      }
      return evicted;
    },
  };
}

export type MediaUploadQueue = ReturnType<typeof createMediaUploadQueue>;
