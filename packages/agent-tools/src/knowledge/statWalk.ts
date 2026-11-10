/**
 * knowledge/statWalk.ts — one walk's use of the stat manifest (PRD 41 B2): load the root's rows once, decide per file whether
 * its stored hash can be reused (stat tuple, racy rule, git blob hint), and save ONE delta at the end. Pure: the digest, the
 * git blob id and the clock are injected.
 *
 *   - The reference time is the START of the walk: every stat and read of this walk happens after it, so a file changed in
 *     the same tick as its stat is still racy against it next time.
 *   - A complete walk deletes the rows of files it did not find and moves the reference time (only when something changed,
 *     or a racy file would leave the racy window). A capped or stopped walk only upserts what it visited and keeps the stored
 *     reference time: rows it never visited are not refreshed.
 *   - A file that is read records a git blob hint only when the blob id of the bytes READ equals the index blob git reported
 *     clean, so a save between `git status` and the read, or an autocrlf / clean-filter difference, never records a hint for
 *     bytes git never saw.
 *   - A racy file (including one with a future mtime) is re-read every walk, but writes nothing unless its row changed or the
 *     save would move it out of the racy window.
 */

import { EMPTY_STAT_SET, isRacy, msToNs, reusedHash, sameRow, type FileStat, type GitHints, type HashCache, type StatRow, type StatSet } from './statManifest.js';

export interface StatWalkDeps {
    cache: HashCache;
    rootId: string;
    /** Absolute root path handed to `gitHints`. */
    root: string;
    /** The hash rule of `digest`; undefined ⇒ the rows are neither trusted nor saved (a host digest of unknown rule). */
    rule: string | undefined;
    digest: (bytes: Uint8Array) => string;
    gitHints?: (rootPath: string) => Promise<GitHints | undefined>;
    /** The git blob id of bytes (`sha1("blob <len>\0" + bytes)`); without it no blob hint is ever recorded. */
    gitBlobId?: (bytes: Uint8Array) => string;
    onError?: (error: unknown) => void;
    now: () => number;
}

export class StatWalk {
    private readonly visited = new Set<string>();
    private readonly upserts: StatRow[] = [];
    /** A file racy against the stored reference time would leave the racy window if the reference time moved. */
    private refresh = false;
    private ended = false;

    private constructor(
        private readonly deps: StatWalkDeps,
        private readonly prior: StatSet,
        private readonly hints: Promise<GitHints | undefined>,
        private readonly startNs: bigint,
    ) {}

    static async start(deps: StatWalkDeps): Promise<StatWalk> {
        const startNs = msToNs(deps.now());
        // git starts beside the load but is awaited only by a file the stat path cannot clear: a warm walk never waits on it.
        // git failing is the stat path, silently.
        const hints = deps.gitHints ? deps.gitHints(deps.root).catch(() => undefined) : Promise.resolve(undefined);
        const prior = deps.rule === undefined
            ? EMPTY_STAT_SET
            : await deps.cache.load(deps.rootId, deps.rule).catch((error: unknown) => { deps.onError?.(error); return EMPTY_STAT_SET; });
        return new StatWalk(deps, prior, hints, startNs);
    }

    /** The file's content hash: the stored one when it may be reused, else the digest of its bytes (read once). */
    async hashOf(rel: string, stat: FileStat, read: () => Promise<Uint8Array>): Promise<string> {
        const row = this.prior.rows.get(rel);
        let reused = reusedHash(stat, row, this.prior, undefined);
        let hint: string | undefined;
        if (reused === undefined && row) {
            const hints = await this.hints;
            hint = hints?.blobs.get(rel);
            reused = reusedHash(stat, row, this.prior, hint, hints?.takenAtNs);
        }
        let hash: string;
        let gitBlob: string | undefined;
        if (reused !== undefined) {
            hash = reused;
            gitBlob = row?.gitBlob;
        } else {
            const bytes = await read();
            hash = this.deps.digest(bytes);
            if (this.deps.gitBlobId) {
                hint ??= (await this.hints)?.blobs.get(rel);
                if (hint !== undefined && this.deps.gitBlobId(bytes) === hint) gitBlob = hint;
            }
        }
        const next: StatRow = { path: rel, ...stat, hash, ...(gitBlob !== undefined ? { gitBlob } : {}) };
        this.visited.add(rel);
        if (!sameRow(row, next)) this.upserts.push(next);
        else if (isRacy(stat.mtimeNs, this.prior.writtenAtNs) && !isRacy(stat.mtimeNs, this.startNs)) this.refresh = true;
        return hash;
    }

    /** Saves the walk's delta, once. `complete`: the whole root was walked. */
    async end(complete: boolean): Promise<void> {
        if (this.ended || this.deps.rule === undefined) return;
        this.ended = true;
        const deletes = complete ? [...this.prior.rows.keys()].filter((p) => !this.visited.has(p)) : [];
        const replace = !!this.prior.stale;
        if (this.upserts.length === 0 && deletes.length === 0 && !(complete && this.refresh) && !replace) return;
        const writtenAtNs = complete || replace ? this.startNs : this.prior.writtenAtNs ?? this.startNs;
        await this.deps.cache
            .save(this.deps.rootId, { rule: this.deps.rule, upserts: this.upserts, deletes, writtenAtNs, ...(replace ? { replace: true as const } : {}) })
            .catch((error: unknown) => { this.deps.onError?.(error); });
    }
}
