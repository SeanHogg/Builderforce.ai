/**
 * knowledge/graphReads.ts — what the repo graph read of each system, and what it left out (PRD 41 A9).
 *
 * The graph has no file-count cap: every source file is read, in bounded concurrent batches, and
 * only its parsed facts are kept. A file it cannot use is COUNTED here by reason — never dropped
 * silently — so diagnostics can show, per system, the files read and the files skipped and why.
 *
 * The analysis runs inside the review (as an analyzer), the systems record is written after it:
 * {@link noteGraphReads} / {@link takeGraphReads} carry one to the other per root, in process.
 */

import type { GraphReadSkip } from '@seanhogg/builderforce-memory/knowledge';

/** Why a source file was not added to the repo graph. */
export type GraphSkipReason = 'too-large' | 'unreadable' | 'unsupported' | 'listing-truncated';

/** One system's reading by the repo graph. `path` is relative to the reviewed root, '' for the root itself. */
export interface SystemGraphRead {
    path: string;
    read: number;
    skipped: GraphReadSkip[];
}

/** Counts reads and skips per system while the repo graph is fed. */
export class GraphReadTally {
    private readonly reads = new Map<string, { read: number; skipped: Map<string, number> }>();

    private of(system: string) {
        let r = this.reads.get(system);
        if (!r) this.reads.set(system, (r = { read: 0, skipped: new Map() }));
        return r;
    }

    /** A system with files the graph could use, even when none was read. */
    expect(system: string): void {
        this.of(system);
    }

    read(system: string): void {
        this.of(system).read++;
    }

    skip(system: string, reason: GraphSkipReason, count = 1): void {
        const r = this.of(system);
        r.skipped.set(reason, (r.skipped.get(reason) ?? 0) + count);
    }

    /** Sorted by system, then reason. */
    result(): SystemGraphRead[] {
        return [...this.reads]
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([path, r]) => ({
                path,
                read: r.read,
                skipped: [...r.skipped].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count })),
            }));
    }
}

const noted = new Map<string, SystemGraphRead[]>();

/** Remembers the latest reading of a root's repo graph (root-relative system paths). */
export function noteGraphReads(rootId: string, reads: readonly SystemGraphRead[]): void {
    noted.set(rootId, [...reads]);
}

/** The reading noted for a root, once: the systems record takes it and it is forgotten. */
export function takeGraphReads(rootId: string): SystemGraphRead[] | undefined {
    const reads = noted.get(rootId);
    noted.delete(rootId);
    return reads;
}
