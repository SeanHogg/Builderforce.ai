/**
 * node-knowledge/gitIndexHints.ts — the plan's git fast path (PRD 41 B2 step 3), Node hosts only. In a git work tree:
 *
 *   - `git ls-files -v -s -z` names the index blob of every tracked file under the root (paths relative to the root, the cwd),
 *     keeping only entries git really compares (tag `H`: not assume-unchanged, not skip-worktree);
 *   - `git --no-optional-locks status --porcelain=v2 -z --untracked-files=no -- .` names every tracked file whose work tree
 *     differs from the index (paths relative to the repository root, so the root's `--show-prefix` is stripped). It never
 *     takes the index lock.
 *
 * A tracked file that status does not name is clean against the index: its blob id is a HINT the stat prefilter may use to
 * reuse a stored sha256 without a read (`knowledge/statManifest.ts`). It is never an identity: facts are keyed by the content
 * hash. Not a work tree, no git, a timeout, any failure: undefined, and the walk takes the stat path. {@link gitBlobId} lets
 * the walk record a hint only for bytes whose blob id IS the index blob.
 */

import { createHash } from 'node:crypto';
import { runGit } from '../node-git-history.js';
import { msToNs, type GitHints } from '../knowledge/statManifest.js';

/** git is a shortcut: past this the walk does not wait for it. */
export const GIT_HINTS_TIMEOUT_MS = 10_000;

/** Arguments of the ls-files run: `-v` tags each entry, so assume-unchanged and skip-worktree entries can be left out. */
export const GIT_LS_FILES_ARGS: readonly string[] = ['ls-files', '-v', '-s', '-z'];
/**
 * Arguments of the status run. `--no-optional-locks`: a background status never takes `.git/index.lock` to refresh the index,
 * so it cannot make the person's own `git` command fail with "index.lock exists".
 */
export const GIT_STATUS_ARGS: readonly string[] = ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--untracked-files=no', '--', '.'];

/**
 * Index entries of `git ls-files -v -s -z` git really checks (tag `H`), regular files only (stage 0, mode 100644/100755):
 * root-relative path → blob id. An assume-unchanged entry (lowercase tag) or a skip-worktree one (`S`) is one git does NOT
 * compare with the work tree, so status calling it clean says nothing about its bytes; symlinks and gitlinks are not files the
 * walk hashes.
 */
export function parseLsFilesStaged(out: string): Map<string, string> {
    const blobs = new Map<string, string>();
    for (const entry of out.split('\0')) {
        const tab = entry.indexOf('\t');
        if (tab < 0) continue;
        const [tag, mode, blob, stage] = entry.slice(0, tab).split(' ');
        if (tag !== 'H' || stage !== '0' || (mode !== '100644' && mode !== '100755') || !blob) continue;
        blobs.set(entry.slice(tab + 1), blob);
    }
    return blobs;
}

/**
 * The repository-relative paths `git status --porcelain=v2 -z` reports with a work tree that differs from the index (Y is not
 * `.`), plus every unmerged path. A path staged but unchanged since (`M.`) is clean against the index: its blob is the bytes.
 */
export function parseDirtyAgainstIndex(out: string): Set<string> {
    const dirty = new Set<string>();
    const entries = out.split('\0');
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const kind = entry[0];
        // Fields before the path: 1 → 8, 2 (rename/copy) → 9 and then the original path as the next entry, u → 10.
        const fields = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : -1;
        if (fields < 0) continue;
        const parts = entry.split(' ');
        if (parts.length <= fields) continue;
        const path = parts.slice(fields).join(' '); // a path may hold spaces
        if (kind === 'u' || parts[1]![1] !== '.') dirty.add(path);
        if (kind === '2') i++; // the original path
    }
    return dirty;
}

/** The clean tracked files under `rootPath` with their index blob ids, or undefined when git cannot say. */
export async function gitIndexHints(rootPath: string, opts: { timeoutMs?: number; now?: () => number } = {}): Promise<GitHints | undefined> {
    const timeoutMs = opts.timeoutMs ?? GIT_HINTS_TIMEOUT_MS;
    const takenAtNs = msToNs((opts.now ?? Date.now)());
    const [where, staged, status] = await Promise.all([
        runGit(rootPath, ['rev-parse', '--is-inside-work-tree', '--show-prefix'], { timeoutMs }),
        runGit(rootPath, [...GIT_LS_FILES_ARGS], { timeoutMs }),
        runGit(rootPath, [...GIT_STATUS_ARGS], { timeoutMs }),
    ]);
    if (where.stdout === undefined || staged.stdout === undefined || status.stdout === undefined) return undefined;
    const [inside, prefix = ''] = where.stdout.split(/\r?\n/);
    if (inside !== 'true') return undefined;
    const blobs = parseLsFilesStaged(staged.stdout);
    for (const path of parseDirtyAgainstIndex(status.stdout)) {
        // A dirty path that is not under the root means the paths do not line up as assumed: trust none of them.
        if (!path.startsWith(prefix)) return undefined;
        blobs.delete(path.slice(prefix.length));
    }
    return { blobs, takenAtNs };
}

/** The git blob id of bytes: `sha1("blob <len>\0" + bytes)`, the id `git hash-object` gives a file with no filters. */
export function gitBlobId(bytes: Uint8Array): string {
    return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}
