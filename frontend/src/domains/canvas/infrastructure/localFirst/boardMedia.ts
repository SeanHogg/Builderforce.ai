/**
 * ADDING MEDIA TO A BOARD — the bytes to the `BlobStore`, a `canvas-media` manifest to the store,
 * and a `media:<id>` URL back for the object to carry.
 *
 * No data URL is ever written into a board again (design §5): an image, a clip or a recorded take is
 * a blob on this device and a small manifest record, whether or not anybody is signed in. The
 * manifest starts `local`; the upload queue (`mediaUploadQueue.ts`) moves it to `uploaded` when there
 * is an account to upload for. Until then the manifest is not journaled, and neither is any object
 * that refers to it (`boardJournal.ts`).
 *
 * The blob and the manifest live in two databases and cannot share a transaction, so the order is
 * the safe one: blob first, then manifest, and a failed manifest removes the blob it just wrote.
 */

import { destinationKey } from '@builderforce/local-first';
import { writeRecord } from './boardJournal';
import { BoardCommitError, type BoardWriteContext } from './boardCommit';
import type { BlobStore } from './blobStore';
import { CANVAS_BOARD, CANVAS_MEDIA, MEDIA_URL_PREFIX, mediaUrl, type BoardPayload, type MediaPayload } from './boardRecords';
import { reportLocalFirstFailure, type LocalFirstFailureSink } from '@/lib/localFirst/reportLocalFirstFailure';

export interface AttachMediaInput {
  boardId: string;
  file: Blob;
  name: string;
  /** The object the media is for, when it already exists. */
  objectId?: string;
  mediaId?: string;
}

export interface AttachedMedia {
  mediaId: string;
  /** What the object carries: `media:<id>`, resolved to an object URL at render. */
  url: string;
}

/** Add media to a board. Refuses (`BlobQuotaError`) over a storage cap. */
export async function attachBoardMedia(
  ctx: BoardWriteContext,
  blobs: BlobStore,
  input: AttachMediaInput,
  report: LocalFirstFailureSink = reportLocalFirstFailure,
): Promise<AttachedMedia> {
  const mediaId = input.mediaId ?? crypto.randomUUID();
  // The board's workspace is the quota partition: one workspace's media never uses another's room.
  const owner = await ctx.store.read((tx) => tx.get<BoardPayload>(CANVAS_BOARD, input.boardId));
  if (!owner || owner.deletedAt) throw new BoardCommitError('board_not_found', `No local board: ${input.boardId}`);
  const stored = await blobs.put(mediaId, input.file, { partition: destinationKey(owner.destination) });
  try {
    await ctx.store.transact(async (tx) => {
      const header = await tx.get<BoardPayload>(CANVAS_BOARD, input.boardId);
      if (!header || header.deletedAt) throw new BoardCommitError('board_not_found', `No local board: ${input.boardId}`);
      const payload: MediaPayload = {
        boardId: input.boardId,
        ...(input.objectId ? { objectId: input.objectId } : {}),
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        sha256: stored.sha256,
        name: input.name,
        status: 'local',
        attempts: 0,
      };
      await writeRecord(tx, ctx, undefined, { entityType: CANVAS_MEDIA, id: mediaId, payload, destination: header.destination, boardId: input.boardId, journal: false });
    });
  } catch (error) {
    // The manifest did not commit: the blob is an orphan nobody can reference. Remove it.
    await blobs.delete(mediaId).catch((cleanup: unknown) => report('boardMedia.orphanBlob', cleanup));
    throw error;
  }
  return { mediaId, url: mediaUrl(mediaId) };
}

/**
 * A URL the page can render: a `media:<id>` becomes an object URL over the stored bytes (the caller
 * revokes it); any other URL (an uploaded file, someone else's https) is returned as it is.
 */
export async function resolveMediaUrl(blobs: BlobStore, url: string): Promise<string | undefined> {
  if (!url.startsWith(MEDIA_URL_PREFIX)) return url;
  const blob = await blobs.get(url.slice(MEDIA_URL_PREFIX.length));
  return blob ? URL.createObjectURL(blob) : undefined;
}
