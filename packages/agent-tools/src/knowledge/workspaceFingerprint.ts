/**
 * knowledge/workspaceFingerprint.ts — WHICH tree an analysis describes (PRD 38 §4.5).
 *
 * The code pack's analyzers are expensive and deterministic over a tree, so their output is
 * keyed by the tree: the HEAD commit plus — when the working tree is dirty — the id of a
 * tree object holding what the working tree contains (tracked edits, binary edits and
 * untracked files all content-addressed), so two dirty snapshots of one commit never
 * collide. The host's own `.builderforce/` state (analysis output, snapshots, indexes) is
 * not a change; the review's two inputs in it are.
 *
 * How it is read: every command is `git --no-optional-locks` (a status must not take the
 * index lock a running editor wants); the dirty tree is written from a COPY of the index
 * (`GIT_INDEX_FILE`), run from the repository's top level, so no file name is ever put into
 * a command line and the real index is untouched; the answer is held for a moment per
 * shell (`FINGERPRINT_TTL_MS`) so the several readers of one action cost one set of git calls.
 *
 * ONE definition: the `analyze_codebase` tool stamps it on the snapshot it produces, the
 * per-sha cache (`workspaceAnalysis.ts`) keys on it, and the upload id (`analysisSha`)
 * derives from it. Pure over the surface's shell.
 */

import { hashText } from '@seanhogg/builderforce-memory/ingest';
import type { CapabilityProvider } from '../capabilities.js';
import { shellRunWithStop } from '../git-repo-scope.js';
import { isBuilderforceState } from './fsDirectorySource.js';
import { createShaCache, type ShaCache } from './shaCache.js';

/** git on every call: a read must never contend for the index lock. */
export const GIT = 'git --no-optional-locks';
/** How long a fingerprint answers the next asker (an action's several readers share one). */
export const FINGERPRINT_TTL_MS = 2_000;
/** The review inputs inside `.builderforce/` that ARE part of the tree (see `isBuilderforceState`). */
const REVIEW_INPUT_FILES = ['.builderforce/ignore', '.builderforce/partitions.json'] as const;

export interface WorkspaceFingerprint {
    commit: string | null;
    branch: string | null;
    /** null ⇒ git could not say. */
    dirty: boolean | null;
    /** Present only when {@link dirty}: a digest of the uncommitted state. */
    dirtyHash?: string;
    /** Where the shell's folder sits inside the repository (`git rev-parse --show-prefix`); '' at the top level. */
    prefix?: string;
}

export interface GitCtx { caps: Pick<CapabilityProvider, 'shell'>; signal?: AbortSignal }

/** The command's stdout (trailing whitespace dropped; `porcelain` output keeps its leading column), or null when it failed. THE git runner of the analysis path. */
export async function gitText(ctx: GitCtx, command: string): Promise<string | null> {
    try {
        const r = await shellRunWithStop(ctx as Parameters<typeof shellRunWithStop>[0], command) as { exitCode?: number; stdout?: string };
        return r.exitCode === 0 ? (r.stdout ?? '').trimEnd() : null;
    } catch {
        return null;
    }
}

const pathOfStatusLine = (line: string): string => line.slice(3).replace(/^"|"$/g, '');
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

/**
 * The id of a tree holding the working tree's content — written from a copy of the index so
 * the repository's own index (and its lock) is never touched. Runs from the top level; the
 * only literals in the script are the review inputs' names. null when git cannot write it.
 */
const WORKING_TREE_SCRIPT = [
    'set -e',
    `cd "$(${GIT} rev-parse --show-toplevel)"`,
    'idx="$(mktemp -u)"',
    'trap \'rm -f "$idx"\' EXIT',
    `cp "$(${GIT} rev-parse --git-path index)" "$idx" 2>/dev/null || true`,
    'export GIT_INDEX_FILE="$idx"',
    `${GIT} add -A -- . ':(exclude,glob)**/.builderforce/**'`,
    ...REVIEW_INPUT_FILES.map((f) => `if [ -f "${f}" ]; then ${GIT} add -f -- "${f}"; fi`),
    `${GIT} write-tree`,
].join('\n');

async function workingTreeId(ctx: GitCtx): Promise<string | null> {
    const out = await gitText(ctx, WORKING_TREE_SCRIPT);
    const id = out?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
    return id && OBJECT_ID.test(id) ? id : null;
}

async function readFingerprint(ctx: GitCtx): Promise<WorkspaceFingerprint> {
    // One call: the top level, the folder's place in the repository, and HEAD.
    const head = await gitText(ctx, `${GIT} rev-parse --show-toplevel --show-prefix HEAD`);
    const lines = head?.split(/\r?\n/) ?? [];
    const commit = lines.at(-1)?.trim();
    if (!commit || !OBJECT_ID.test(commit)) return { commit: null, branch: null, dirty: null };
    const prefix = lines.length >= 3 ? (lines[1] ?? '').trim().replace(/\/+$/, '') : '';
    const branch = (await gitText(ctx, `${GIT} branch --show-current`))?.trim() ?? null;
    const status = await gitText(ctx, `${GIT} status --porcelain --untracked-files=all`);
    if (status === null) return { commit, branch, dirty: null, prefix };
    const changes = status.split('\n').filter((line) => line.trim() && !isBuilderforceState(pathOfStatusLine(line)));
    if (changes.length === 0) return { commit, branch, dirty: false, prefix };
    const tree = await workingTreeId(ctx);
    return { commit, branch, dirty: true, prefix, ...(tree ? { dirtyHash: hashText(tree).slice(0, 16) } : {}) };
}

/** One short-lived memo per shell: a shell is bound to one folder, so it IS the workspace identity. */
let memos = new WeakMap<object, ShaCache<WorkspaceFingerprint>>();

/** Forget remembered fingerprints (tests; a host that knows the tree just changed). */
export function forgetWorkspaceFingerprints(): void {
    memos = new WeakMap();
}

export async function workspaceFingerprint(ctx: GitCtx): Promise<WorkspaceFingerprint> {
    const shell = ctx.caps.shell;
    if (!shell) return { commit: null, branch: null, dirty: null };
    let memo = memos.get(shell);
    if (!memo) memos.set(shell, (memo = createShaCache<WorkspaceFingerprint>({ ttlMs: FINGERPRINT_TTL_MS, max: 1 })));
    // The read rides the SHARED run's signal: it stops only when every asker has stopped.
    return memo.getOrRun('fingerprint', (shared) => readFingerprint({ caps: ctx.caps, ...(shared ? { signal: shared } : {}) }), ctx.signal);
}

/**
 * The tree's id: its commit, plus `.<dirtyHash>` when dirty (the `.` is in the API's
 * `KNOWLEDGE_HASH_PATTERN`, `+` is not). Null ⇒ not identifiable (no git, or a dirty tree
 * git could not digest).
 */
export function fingerprintSha(fp: Pick<WorkspaceFingerprint, 'commit' | 'dirty' | 'dirtyHash'>): string | null {
    if (!fp.commit || fp.dirty === null) return null;
    if (!fp.dirty) return fp.commit;
    return fp.dirtyHash ? `${fp.commit}.${fp.dirtyHash}` : null;
}
