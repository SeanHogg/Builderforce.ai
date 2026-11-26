/**
 * The Reviews panel's reading of the files the server lacks from ONE `SyncStatus` (the Server tab, the Server badge, the chip). The skipped list's own split (files against folders
 * the walk never read) is `syncDeltaModel.ts`'s `splitSkipped`. Pure over what the host reported; nothing is invented.
 */

import type { SyncStatus } from '../../types';
import { splitSkipped } from './syncDeltaModel';

/**
 * The files the server lacks, from ONE reading of a sync status. `missing` is the skipped files when the host
 * recorded any, else the count gap; `tooLarge` is the part of the skipped files the review could not store
 * because they exceed the size cap, so it can never be larger than `missing`.
 */
export interface SyncGap { missing: number; tooLarge: number }

export function syncGap(status: SyncStatus | null | undefined): SyncGap {
    if (!status) return { missing: 0, tooLarge: 0 };
    // Folders the walk never reads are recorded in the same list; they are not files the server is missing.
    const files = status.skipped === undefined ? [] : splitSkipped(status.skipped).files;
    if (files.length > 0) return { missing: files.length, tooLarge: files.filter((f) => f.reason === 'too-large').length };
    return { missing: status.server ? Math.max(0, status.local.files - status.server.files) : 0, tooLarge: 0 };
}
