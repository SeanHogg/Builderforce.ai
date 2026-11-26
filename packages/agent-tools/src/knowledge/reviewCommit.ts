/**
 * knowledge/reviewCommit.ts — the git commit a root's last COMPLETED review ran at, kept beside the root's local snapshot.
 *
 * The platform records it next to the review's digest so Compare's "before" can read its source at that commit. It must be the
 * commit of the review, never of the moment a pack is sent: the host records it when the review completes (and only when the
 * reviewed folder was clean then — the host decides, this file just keeps the answer), and the pump reads what was recorded.
 * Memory's `ScopeRecord` has no field for it, so it lives here, the same lifetime as the snapshot it describes.
 *
 * `undefined` is "unknown": no git, a dirty tree at review time, or a review that recorded none. Recording undefined REPLACES
 * an older value — a later review's unknown must never leave the previous review's commit standing for it.
 */
import { reviewCommitFileName, type KnowledgeFiles } from './fileManifest.js';

interface ReviewCommitRecord { sha: string }

/** Records the commit the root's review ran at (or clears it with `undefined`). */
export async function writeReviewCommit(files: KnowledgeFiles, rootId: string, sha: string | undefined): Promise<void> {
    const name = reviewCommitFileName(rootId);
    if (sha === undefined) {
        if (files.remove) await files.remove(name);
        else await files.write(name, '{}');
        return;
    }
    await files.write(name, JSON.stringify({ sha } satisfies ReviewCommitRecord));
}

/**
 * The recorded commit; undefined when none was recorded. A file that does not parse THROWS (the caller reports it): a damaged
 * record is a fault to see, not an "unknown" to swallow.
 */
export async function readReviewCommit(files: KnowledgeFiles, rootId: string): Promise<string | undefined> {
    const text = await files.read(reviewCommitFileName(rootId));
    if (text === undefined || text === '') return undefined;
    const record = JSON.parse(text) as Partial<ReviewCommitRecord> | null;
    return typeof record?.sha === 'string' && record.sha ? record.sha : undefined;
}
