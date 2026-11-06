/**
 * The Sync drawer's readings of a `SyncStatus`: the six pipeline steps and their state, the
 * local-against-server bars, and a byte size in words. Every step is derived from what the
 * host reported; a step it did not report on is "waiting", never "done".
 */

import type { SyncStatus } from '../../types';
import { splitSkipped } from './syncDeltaModel';

export type StepId = 'walk' | 'graph' | 'upload' | 'match' | 'analyse' | 'skipped';
export type StepState = 'ok' | 'pending' | 'attention';

export const STEP_ORDER: readonly StepId[] = ['walk', 'graph', 'upload', 'match', 'analyse', 'skipped'];

export const COUNTS = ['files', 'edges', 'docs'] as const;
export type CountId = (typeof COUNTS)[number];

export function pipelineSteps(s: SyncStatus): Array<{ id: StepId; state: StepState }> {
    const { local, server } = s;
    // Only counts both sides measured are compared: an unmeasured one (edges of a linked folder) can neither match nor differ.
    const same = !!server && COUNTS.every((k) => local[k] === undefined || server[k] === undefined || server[k] === local[k]) && !local.truncated && !server.truncated;
    const collected = s.sources.filter((x) => x.state === 'collected').length;
    const states: Record<StepId, StepState> = {
        walk: local.files > 0 ? 'ok' : 'pending',
        graph: (local.edges ?? 0) > 0 || local.docs > 0 ? (local.truncated ? 'attention' : 'ok') : 'pending',
        upload: server ? 'ok' : 'pending',
        match: !server ? 'pending' : same ? 'ok' : 'attention',
        analyse: collected === 0 ? 'pending' : s.sources.some((x) => x.state === 'absent') ? 'attention' : 'ok',
        // No record of what was skipped is unknown, which is not the same as "nothing skipped".
        // Folders the walk never reads are not skipped files.
        skipped: s.skipped === undefined ? 'pending' : splitSkipped(s.skipped).files.length === 0 ? 'ok' : 'attention',
    };
    return STEP_ORDER.map((id) => ({ id, state: states[id] }));
}

/** The server count as a fraction of the local one (capped at 1); 0 when nothing is local. */
export function serverShare(local: number | undefined, server: number | undefined): number {
    return local !== undefined && local > 0 && server !== undefined ? Math.min(1, server / local) : 0;
}

export type ParityNote = { kind: 'all' } | { kind: 'missing'; count: number };

/** What a local-against-server pair says in words: the server has all of it, or this many are not there yet. Null when the server was not read. */
export function parityNote(local: number | undefined, server: number | undefined): ParityNote | null {
    if (local === undefined || server === undefined) return null;
    return server >= local ? { kind: 'all' } : { kind: 'missing', count: local - server };
}

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

/** How many files the server lacks. */
export const missingFilesOf = (status: SyncStatus | null | undefined): number => syncGap(status).missing;
