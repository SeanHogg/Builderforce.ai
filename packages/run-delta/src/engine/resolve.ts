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

import type { ChangedFileInput, DeltaPorts, RunChangeSetInput, SideText, UnresolvedFile } from '../contract.js';
import { matchRenames } from './renames.js';
import { compareStr, normalizeEol, normalizePath } from './text.js';

/** Reasons that mean "the before side exists but could not be read", not "nothing to compare". */
export const UNRESOLVED_BEFORE: ReadonlySet<UnresolvedFile['reason']> = new Set(['preimage-too-large', 'preimage-missing', 'git-unavailable']);

export interface ResolvedSides {
    /** In-run, analyzable files at their logical path, sorted. */
    changed: ChangedFileInput[];
    before: Map<string, SideText>;
    after: Map<string, SideText>;
    /** Sorted by path. */
    excluded: UnresolvedFile[];
    /** In-run files analyzed on their after side only (before side unresolved), sorted. */
    unknownBefore: string[];
    renamed: Array<{ from: string; to: string }>;
    /** In-run files before any exclusion. */
    inRunCount: number;
}

const isUnresolved = (v: SideText | UnresolvedFile): v is UnresolvedFile => 'reason' in v;

function normalizedFiles(files: readonly ChangedFileInput[]): ChangedFileInput[] {
    const byPath = new Map<string, ChangedFileInput>();
    const sorted = files.map((f) => ({ ...f, path: normalizePath(f.path) })).sort((a, b) => compareStr(a.path, b.path));
    for (const f of sorted) if (!byPath.has(f.path)) byPath.set(f.path, f);
    return [...byPath.values()];
}

function normalizedReply(reply: Map<string, SideText | UnresolvedFile>): Map<string, SideText | UnresolvedFile> {
    const out = new Map<string, SideText | UnresolvedFile>();
    for (const key of [...reply.keys()].sort(compareStr)) {
        const v = reply.get(key)!;
        const path = normalizePath(key);
        if (out.has(path)) continue;
        out.set(path, isUnresolved(v)
            ? { path, reason: v.reason }
            : { path, ...(v.hash ? { hash: v.hash } : {}), ...(v.text !== undefined ? { text: normalizeEol(v.text) } : {}) });
    }
    return out;
}

/** The side text of a file the change set says exists there, or why it cannot be used. */
function sideOf(reply: Map<string, SideText | UnresolvedFile>, path: string): SideText | UnresolvedFile['reason'] {
    const v = reply.get(path);
    if (!v) return 'preimage-missing';
    if (isUnresolved(v)) return v.reason;
    return v.text === undefined ? 'binary' : v;
}

export async function resolveSides(input: RunChangeSetInput, ports: DeltaPorts): Promise<ResolvedSides> {
    const files = normalizedFiles(input.files);
    const excluded = new Map<string, UnresolvedFile>();
    const inRun = files.filter((f) => {
        if (f.attribution !== 'outside-run') return true;
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

    const kept: ChangedFileInput[] = [];
    const unknownBefore: string[] = [];
    const before = new Map<string, SideText>(), after = new Map<string, SideText>();
    for (const f of inRun) {
        const b = f.beforeHash !== undefined ? sideOf(beforeAll, f.path) : undefined;
        const a = f.afterHash !== undefined ? sideOf(afterAll, f.path) : undefined;
        if (typeof a === 'string') { excluded.set(f.path, { path: f.path, reason: a }); continue; }
        if (typeof b === 'string') {
            excluded.set(f.path, { path: f.path, reason: b });
            if (!UNRESOLVED_BEFORE.has(b) || !a) continue;
            unknownBefore.push(f.path);
        } else if (b) before.set(f.path, b);
        kept.push(f);
        if (a) after.set(f.path, a);
    }

    // Renames: a deleted file paired with an ADDED file (no before hash) becomes one entry at the new path.
    const deleted = kept.filter((f) => before.has(f.path) && !after.has(f.path));
    const added = kept.filter((f) => f.beforeHash === undefined && after.has(f.path));
    const pairs = matchRenames(
        deleted.map((f) => ({ path: f.path, ...(f.beforeHash ? { hash: f.beforeHash } : {}), text: before.get(f.path)!.text })),
        added.map((f) => ({ path: f.path, ...(f.afterHash ? { hash: f.afterHash } : {}), text: after.get(f.path)!.text })),
    );
    const byPath = new Map(kept.map((f) => [f.path, f]));
    for (const { from, to } of pairs) {
        const old = byPath.get(from)!, cur = byPath.get(to)!;
        byPath.delete(from);
        byPath.set(to, { ...cur, ...(old.beforeHash ? { beforeHash: old.beforeHash } : {}), status: 'renamed' });
        before.set(to, before.get(from)!);
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
