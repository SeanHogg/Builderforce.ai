/**
 * THE UPLOAD STATUS OF A BOARD'S MEDIA — what a person is told about uploads that did not go.
 *
 * A read over the `canvas-media` manifests (the same style as `listBoardConflicts`): the items the
 * queue gave up on (`failed`, waiting for a manual retry) and the ones it is backing off from
 * (`local` with a `nextAttemptAt` in the future). A healthy `local` or `uploading` item is not an
 * issue and is not listed. Nothing here writes; the retry is `MediaUploadQueue.retry`.
 */

import { selectRecords, type LocalFirstStore } from '@builderforce/local-first';
import { CANVAS_MEDIA, type MediaPayload } from './boardRecords';

export interface BoardMediaIssue {
  id: string;
  name: string;
  status: 'failed' | 'retrying';
  attempts: number;
}

export async function listBoardMediaIssues(store: LocalFirstStore, boardId: string, now: Date = new Date()): Promise<BoardMediaIssue[]> {
  const at = now.toISOString();
  const rows = await store.read((tx) => selectRecords<MediaPayload>(tx, CANVAS_MEDIA, (row) =>
    !row.deletedAt && row.payload.boardId === boardId
    && (row.payload.status === 'failed' || (row.payload.status === 'local' && !!row.payload.nextAttemptAt && row.payload.nextAttemptAt > at))));
  return rows
    .map((row): BoardMediaIssue => ({ id: row.id, name: row.payload.name, status: row.payload.status === 'failed' ? 'failed' : 'retrying', attempts: row.payload.attempts ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
