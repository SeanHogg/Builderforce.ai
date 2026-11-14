/**
 * engine/resolve.ts — steps 1–2 of the §6 "Agent run" sequence: the attribution filter, the C1
 * resolution of both sides through `ports.texts`, and rename matching.
 *
 *  - A file whose change-set `attribution` is `outside-run` goes to `excluded`
 *    (`changed-outside-run`) and never reaches a rule (C1, concurrent human edits).
 *  - A `binary`, `changed-ignored` or `submodule-moved` file (on either side), or one whose AFTER side
 *    cannot be resolved, is excluded too.
 *  - A file whose BEFORE side cannot be resolved ({@link UNRESOLVED_BEFORE}) is listed in `excluded`
 *    with that reason but KEEPS its after side: rules still run on it and its findings show as
 *    `present` (only lineage is lost; an after-side problem is never hidden).
 *  - A deleted file and an ADDED file (no before hash) that the {@link matchRenames rename matcher}
 *    pairs become ONE entry at the new (logical) path, with the before text keyed under it.
 *
 * Paths and texts leave here normalized (POSIX/NFC, LF), so nothing downstream depends on the OS.
 */
import { matchRenames } from './renames.js';
import { compareStr, normalizeEol, normalizePath } from './text.js';
/** Reasons that mean "the before side exists but could not be read", not "nothing to compare". */
export const UNRESOLVED_BEFORE = new Set(['preimage-too-large', 'preimage-missing', 'git-unavailable']);
const isUnresolved = (v) => 'reason' in v;
function normalizedFiles(files) {
    const byPath = new Map();
    const sorted = files.map((f) => ({ ...f, path: normalizePath(f.path) })).sort((a, b) => compareStr(a.path, b.path));
    for (const f of sorted)
        if (!byPath.has(f.path))
            byPath.set(f.path, f);
    return [...byPath.values()];
}
function normalizedReply(reply) {
    const out = new Map();
    for (const key of [...reply.keys()].sort(compareStr)) {
        const v = reply.get(key);
        const path = normalizePath(key);
        if (out.has(path))
            continue;
        out.set(path, isUnresolved(v)
            ? { path, reason: v.reason }
            : { path, ...(v.hash ? { hash: v.hash } : {}), ...(v.text !== undefined ? { text: normalizeEol(v.text) } : {}) });
    }
    return out;
}
/** The side text of a file the change set says exists there, or why it cannot be used. */
function sideOf(reply, path) {
    const v = reply.get(path);
    if (!v)
        return 'preimage-missing';
    if (isUnresolved(v))
        return v.reason;
    return v.text === undefined ? 'binary' : v;
}
export async function resolveSides(input, ports) {
    const files = normalizedFiles(input.files);
    const excluded = new Map();
    const inRun = files.filter((f) => {
        if (f.attribution !== 'outside-run')
            return true;
        excluded.set(f.path, { path: f.path, reason: 'changed-outside-run' });
        return false;
    });
    const beforePaths = inRun.filter((f) => f.beforeHash !== undefined).map((f) => f.path);
    const afterPaths = inRun.filter((f) => f.afterHash !== undefined).map((f) => f.path);
    const [beforeReply, afterReply] = await Promise.all([
        beforePaths.length > 0 ? ports.texts('before', beforePaths) : Promise.resolve(new Map()),
        afterPaths.length > 0 ? ports.texts('after', afterPaths) : Promise.resolve(new Map()),
    ]);
    const beforeAll = normalizedReply(beforeReply), afterAll = normalizedReply(afterReply);
    const kept = [];
    const unknownBefore = [];
    const before = new Map(), after = new Map();
    for (const f of inRun) {
        const b = f.beforeHash !== undefined ? sideOf(beforeAll, f.path) : undefined;
        const a = f.afterHash !== undefined ? sideOf(afterAll, f.path) : undefined;
        if (typeof a === 'string') {
            excluded.set(f.path, { path: f.path, reason: a });
            continue;
        }
        if (typeof b === 'string') {
            excluded.set(f.path, { path: f.path, reason: b });
            if (!UNRESOLVED_BEFORE.has(b) || !a)
                continue;
            unknownBefore.push(f.path);
        }
        else if (b)
            before.set(f.path, b);
        kept.push(f);
        if (a)
            after.set(f.path, a);
    }
    // Renames: a deleted file paired with an ADDED file (no before hash) becomes one entry at the new path.
    const deleted = kept.filter((f) => before.has(f.path) && !after.has(f.path));
    const added = kept.filter((f) => f.beforeHash === undefined && after.has(f.path));
    const pairs = matchRenames(deleted.map((f) => ({ path: f.path, ...(f.beforeHash ? { hash: f.beforeHash } : {}), text: before.get(f.path).text })), added.map((f) => ({ path: f.path, ...(f.afterHash ? { hash: f.afterHash } : {}), text: after.get(f.path).text })));
    const byPath = new Map(kept.map((f) => [f.path, f]));
    for (const { from, to } of pairs) {
        const old = byPath.get(from), cur = byPath.get(to);
        byPath.delete(from);
        byPath.set(to, { ...cur, ...(old.beforeHash ? { beforeHash: old.beforeHash } : {}), status: 'renamed' });
        before.set(to, before.get(from));
        before.delete(from);
    }
    return {
        changed: [...byPath.values()].sort((a, b) => compareStr(a.path, b.path)),
        before,
        after,
        excluded: [...excluded.values()].sort((a, b) => compareStr(a.path, b.path)),
        unknownBefore: unknownBefore.sort(compareStr),
        renamed: pairs.map(({ from, to }) => ({ from, to })),
        inRunCount: inRun.length,
    };
}
//# sourceMappingURL=resolve.js.map