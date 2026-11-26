/**
 * The stage's own counters: what the renderer spy test and the P1a measurements read (PRD 43 B1a done checks — a camera
 * switch creates 0 `InstancedMesh` and makes ≤ 3 attribute uploads per batch). Every GPU upload the stage makes goes
 * through {@link uploadRange}, so the counters cannot miss one.
 */

import type { BufferAttribute, InstancedBufferAttribute } from 'three';

export interface StageStats {
    meshesCreated: number;
    uploads: number;
    bytesUploaded: number;
    /** Uploads per mark batch (index = batch). */
    uploadsByBatch: number[];
}

export const createStats = (): StageStats => ({ meshesCreated: 0, uploads: 0, bytesUploaded: 0, uploadsByBatch: [] });

/**
 * Marks `count` items from `start` of `attr` for upload (a ranged `bufferSubData`), and counts it. Ranges ACCUMULATE
 * until three uploads them (it clears them after the upload): two writes to one attribute in one commit — a repaint and
 * a drill append — must both reach the GPU, so a later range never drops an earlier one.
 */
export function uploadRange(stats: StageStats, attr: BufferAttribute | InstancedBufferAttribute, start: number, count: number, batch = -1): void {
    if (count <= 0) return;
    attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize);
    attr.needsUpdate = true;
    stats.uploads++;
    stats.bytesUploaded += count * attr.itemSize * (attr.array as ArrayLike<number> & { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    if (batch >= 0) stats.uploadsByBatch[batch] = (stats.uploadsByBatch[batch] ?? 0) + 1;
}
