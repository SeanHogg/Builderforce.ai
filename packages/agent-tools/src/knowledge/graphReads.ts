/**
 * knowledge/graphReads.ts — what the repo graph read of each FILE, and what it left out (PRD 41 A9).
 *
 * The graph has no file-count cap: every source file is read, in bounded concurrent batches, and
 * only its parsed facts are kept. A file it cannot use is COUNTED here by reason — never dropped
 * silently — so diagnostics can show, per system, the files read and the files skipped and why.
 *
 * The graph reads FILES; it does not know systems. The systems are detected once, by the systems
 * record ({@link recordSystems}), which assigns these files to them.
 *
 * The analysis runs inside the review (as an analyzer), the systems record is written after it:
 * {@link noteGraphReads} / {@link takeGraphReads} carry one to the other per root, in process.
 */

/** Why a source file was not added to the repo graph. */
export type GraphSkipReason = 'too-large' | 'unreadable' | 'unsupported' | 'listing-truncated';

/** The files the repo graph read and skipped, root-relative. */
export interface GraphFileReads {
    read: string[];
    skipped: Array<{ reason: GraphSkipReason; paths: string[] }>;
    /** Whether the repo map would read a file at this path: the files a system's reading should account for. Absent ⇒ every file counts. */
    accepts?(path: string): boolean;
}

/** Records each file's outcome while the repo graph is fed. */
export class GraphReadTally {
    private readonly readPaths: string[] = [];
    private readonly skips = new Map<GraphSkipReason, string[]>();

    read(path: string): void {
        this.readPaths.push(path);
    }

    skip(path: string, reason: GraphSkipReason): void {
        (this.skips.get(reason) ?? this.skips.set(reason, []).get(reason)!).push(path);
    }

    result(accepts?: (path: string) => boolean): GraphFileReads {
        return {
            read: [...this.readPaths].sort(),
            skipped: [...this.skips].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, paths]) => ({ reason, paths: [...paths].sort() })),
            ...(accepts ? { accepts } : {}),
        };
    }
}

const noted = new Map<string, GraphFileReads>();

/** Remembers the latest reading of a root's repo graph (root-relative file paths). */
export function noteGraphReads(rootId: string, reads: GraphFileReads | undefined): void {
    if (reads) noted.set(rootId, reads);
    else noted.delete(rootId);
}

/** The reading noted for a root, once: the systems record takes it and it is forgotten. */
export function takeGraphReads(rootId: string): GraphFileReads | undefined {
    const reads = noted.get(rootId);
    noted.delete(rootId);
    return reads;
}
