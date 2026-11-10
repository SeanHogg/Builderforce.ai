/**
 * node-knowledge/gitIndexHints.ts — the plan's git fast path (PRD 41 B2 step 3), Node hosts only. In a git work tree:
 *
 *   - `git ls-files -s -z` names the index blob of every tracked file under the root (paths relative to the root, the cwd);
 *   - `git status --porcelain=v2 -z --untracked-files=no -- .` names every tracked file whose work tree differs from the index
 *     (paths relative to the repository root, so the root's `--show-prefix` is stripped).
 *
 * A tracked file that status does not name is clean against the index: its blob id is a HINT the stat prefilter may use to
 * reuse a stored sha256 without a read (`knowledge/statManifest.ts`). It is never an identity: facts are keyed by the content
 * hash. Not a work tree, no git, a timeout, any failure: undefined, and the walk takes the stat path.
 */

import { runGit } from '../node-git-history.js';
import { msToNs, type GitHints } from '../knowledge/statManifest.js';

/** git is a shortcut: past this the walk does not wait for it. */
export const GIT_HINTS_TIMEOUT_MS = 10_000;

/** Index entries of regular files (stage 0, mode 100644/100755): root-relative path → blob id. Symlinks and gitlinks are not files the walk hashes. */
export function parseLsFilesStaged(out: string): Map<string, string> {
    const blobs = new Map<string, string>();
    for (const entry of out.split('\0')) {
        const tab = entry.indexOf('\t');
        if (tab < 0) continue;
        const [mode, blob, stage] = entry.slice(0, tab).split(' ');
        if (stage !== '0' || (mode !== '100644' && mode !== '100755') || !blob) continue;
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
        runGit(rootPath, ['ls-files', '-s', '-z'], { timeoutMs }),
        runGit(rootPath, ['status', '--porcelain=v2', '-z', '--untracked-files=no', '--', '.'], { timeoutMs }),
    ]);
    if (where.stdout === undefined || staged.stdout === undefined || status.stdout === undefined) return undefined;
    const [inside, prefix = ''] = where.stdout.split(/\r?\n/);
    if (inside !== 'true') return undefined;
    const blobs = parseLsFilesStaged(staged.stdout);
    for (const path of parseDirtyAgainstIndex(status.stdout)) {
        if (path.startsWith(prefix)) blobs.delete(path.slice(prefix.length));
    }
    return { blobs, takenAtNs };
}
