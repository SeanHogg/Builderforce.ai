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
import { EMPTY_STAT_SET, isRacy, msToNs, reusedHash, sameRow } from './statManifest.js';
export class StatWalk {
    deps;
    prior;
    hints;
    startNs;
    visited = new Set();
    upserts = [];
    /** A file racy against the stored reference time would leave the racy window if the reference time moved. */
    refresh = false;
    ended = false;
    constructor(deps, prior, hints, startNs) {
        this.deps = deps;
        this.prior = prior;
        this.hints = hints;
        this.startNs = startNs;
    }
    static async start(deps) {
        const startNs = msToNs(deps.now());
        // git starts beside the load but is awaited only by a file the stat path cannot clear: a warm walk never waits on it.
        // git failing is the stat path, silently.
        const hints = deps.gitHints ? deps.gitHints(deps.root).catch(() => undefined) : Promise.resolve(undefined);
        const prior = deps.rule === undefined
            ? EMPTY_STAT_SET
            : await deps.cache.load(deps.rootId, deps.rule).catch((error) => { deps.onError?.(error); return EMPTY_STAT_SET; });
        return new StatWalk(deps, prior, hints, startNs);
    }
    /** The file's content hash: the stored one when it may be reused, else the digest of its bytes (read once). */
    async hashOf(rel, stat, read) {
        const row = this.prior.rows.get(rel);
        let reused = reusedHash(stat, row, this.prior, undefined);
        let hint;
        if (reused === undefined && row) {
            const hints = await this.hints;
            hint = hints?.blobs.get(rel);
            reused = reusedHash(stat, row, this.prior, hint, hints?.takenAtNs);
        }
        let hash;
        let gitBlob;
        if (reused !== undefined) {
            hash = reused;
            gitBlob = row?.gitBlob;
        }
        else {
            const bytes = await read();
            hash = this.deps.digest(bytes);
            if (this.deps.gitBlobId) {
                hint ??= (await this.hints)?.blobs.get(rel);
                if (hint !== undefined && this.deps.gitBlobId(bytes) === hint)
                    gitBlob = hint;
            }
        }
        const next = { path: rel, ...stat, hash, ...(gitBlob !== undefined ? { gitBlob } : {}) };
        this.visited.add(rel);
        if (!sameRow(row, next))
            this.upserts.push(next);
        else if (isRacy(stat.mtimeNs, this.prior.writtenAtNs) && !isRacy(stat.mtimeNs, this.startNs))
            this.refresh = true;
        return hash;
    }
    /** Saves the walk's delta, once. `complete`: the whole root was walked. */
    async end(complete) {
        if (this.ended || this.deps.rule === undefined)
            return;
        this.ended = true;
        const deletes = complete ? [...this.prior.rows.keys()].filter((p) => !this.visited.has(p)) : [];
        const replace = !!this.prior.stale;
        if (this.upserts.length === 0 && deletes.length === 0 && !(complete && this.refresh) && !replace)
            return;
        const writtenAtNs = complete || replace ? this.startNs : this.prior.writtenAtNs ?? this.startNs;
        await this.deps.cache
            .save(this.deps.rootId, { rule: this.deps.rule, upserts: this.upserts, deletes, writtenAtNs, ...(replace ? { replace: true } : {}) })
            .catch((error) => { this.deps.onError?.(error); });
    }
}
//# sourceMappingURL=statWalk.js.map