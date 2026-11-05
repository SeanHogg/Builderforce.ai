/**
 * The Sync drawer's readings of a `SyncStatus`: the six pipeline steps and their state, the
 * local-against-server bars, and a byte size in words. Every step is derived from what the
 * host reported; a step it did not report on is "waiting", never "done".
 */

import type { SyncStatus } from '../../types';

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
        skipped: s.skipped === undefined ? 'pending' : s.skipped.length === 0 ? 'ok' : 'attention',
    };
    return STEP_ORDER.map((id) => ({ id, state: states[id] }));
}

/** The server count as a fraction of the local one (capped at 1); 0 when nothing is local. */
export function serverShare(local: number | undefined, server: number | undefined): number {
    return local !== undefined && local > 0 && server !== undefined ? Math.min(1, server / local) : 0;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
