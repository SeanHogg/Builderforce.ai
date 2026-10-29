/**
 * knowledge/workspaceFingerprint.ts — WHICH tree an analysis describes (PRD 38 §4.5).
 *
 * The code pack's analyzers are expensive and deterministic over a tree, so their output is
 * keyed by the tree: the HEAD commit plus — when the working tree is dirty — a hash of what
 * differs from it (`git status`, the tracked diff and the untracked files' blob ids), so two
 * dirty snapshots of one commit never collide. The analyzers' own scratch output
 * (`.builderforce/code-analysis/`) is not a change.
 *
 * ONE definition: the `analyze_codebase` tool stamps it on the snapshot it produces, the
 * per-sha cache (`workspaceAnalysis.ts`) keys on it, and the upload id (`analysisSha`)
 * derives from it. Pure over the surface's shell.
 */

import { hashText } from '@seanhogg/builderforce-memory/ingest';
import type { CapabilityProvider } from '../capabilities.js';
import { shellRunWithStop } from '../git-repo-scope.js';

/** Untracked files whose content is hashed (beyond this, their names still count). */
const MAX_UNTRACKED_HASHED = 200;
const ANALYSIS_SCRATCH = '.builderforce/code-analysis/';

export interface WorkspaceFingerprint {
    commit: string | null;
    branch: string | null;
    /** null ⇒ git could not say. */
    dirty: boolean | null;
    /** Present only when {@link dirty}: a digest of the uncommitted state. */
    dirtyHash?: string;
}

interface FingerprintCtx { caps: Pick<CapabilityProvider, 'shell'>; signal?: AbortSignal }

/** The command's stdout (trailing whitespace dropped; `porcelain` output keeps its leading column), or null when it failed. */
async function git(ctx: FingerprintCtx, command: string): Promise<string | null> {
    try {
        const r = await shellRunWithStop(ctx as Parameters<typeof shellRunWithStop>[0], command) as { exitCode?: number; stdout?: string };
        return r.exitCode === 0 ? (r.stdout ?? '').trimEnd() : null;
    } catch {
        return null;
    }
}

const pathOfStatusLine = (line: string): string => line.slice(3).replace(/^"|"$/g, '');

export async function workspaceFingerprint(ctx: FingerprintCtx): Promise<WorkspaceFingerprint> {
    if (!ctx.caps.shell) return { commit: null, branch: null, dirty: null };
    const [commit, branch, status] = [
        (await git(ctx, 'git rev-parse HEAD'))?.trim() ?? null,
        (await git(ctx, 'git branch --show-current'))?.trim() ?? null,
        await git(ctx, 'git status --porcelain --untracked-files=all'),
    ];
    if (status === null) return { commit, branch, dirty: null };
    const changes = status.split('\n').filter((line) => line.trim() && !pathOfStatusLine(line).startsWith(ANALYSIS_SCRATCH));
    if (changes.length === 0) return { commit, branch, dirty: false };

    const untracked = changes.filter((l) => l.startsWith('??')).map(pathOfStatusLine).filter((p) => !p.includes('"')).slice(0, MAX_UNTRACKED_HASHED);
    const diff = await git(ctx, 'git diff HEAD');
    const blobs = untracked.length ? await git(ctx, `git hash-object -- ${untracked.map((p) => `"${p}"`).join(' ')}`) : '';
    const dirtyHash = hashText([changes.sort().join('\n'), diff ?? '', blobs ?? ''].join('\u0000')).slice(0, 16);
    return { commit, branch, dirty: true, dirtyHash };
}

/** The tree's id: its commit, plus `+<dirtyHash>` when dirty. Null ⇒ not identifiable (no git, or a dirty tree git could not digest). */
export function fingerprintSha(fp: Pick<WorkspaceFingerprint, 'commit' | 'dirty' | 'dirtyHash'>): string | null {
    if (!fp.commit || fp.dirty === null) return null;
    if (!fp.dirty) return fp.commit;
    return fp.dirtyHash ? `${fp.commit}+${fp.dirtyHash}` : null;
}
