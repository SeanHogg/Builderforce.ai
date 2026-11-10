/**
 * predict/labels/history.ts — git history AS DATA for the labellers (PRD 41 §D1): the shapes a host fills from its own
 * git (`git log`, `git diff -U0`, `git blame --porcelain`), and the pure parsers of that output. No I/O: the host runs
 * git; the labellers only read these values.
 */

import type { CommitAttribution } from '../contract.js';

/** Where a parent-side line came from (`git blame` at the change's parent). */
export interface BlamedLine {
    sha: string;
    /** The path the line had in the blamed commit (renames followed by blame). */
    path: string;
}

/** One file of one later commit, seen from the commit's parent. */
export interface FileChange {
    /** Root-relative POSIX path at the parent. */
    path: string;
    /** The file at the parent and at the commit; absent = unknown (no cosmetic test is then possible). */
    parentText?: string;
    childText?: string;
    /** 1-based parent lines the commit modified or deleted. */
    removedLines: readonly number[];
    /** Blame of the parent's lines; a line missing here is unblamed (skipped). */
    blame: ReadonlyMap<number, BlamedLine>;
}

/** One commit after the run, oldest first in a history. */
export interface HistoryCommit {
    sha: string;
    /** ISO commit time. */
    at: string;
    message: string;
    /** Set by the host when the commit is known to be a fix without reading its message (D1 fix registry). */
    fix?: 'bug-ticket' | 'fix-with-agent';
    /** A merge commit (more than one parent): never a fix, and its changes are not counted as deletions. */
    merge?: boolean;
    changes: readonly FileChange[];
}

/** What a labeller knows of the run: when it ended and which commits carry its content. */
export interface RunCommits {
    runId: string;
    finalizedAt: string;
    attribution: readonly CommitAttribution[];
}

/** `<sha>\u0000<path>` keys of the run's attributed commits, plus its sha set. */
export function runCommitIndex(run: RunCommits): { lines: Set<string>; shas: Set<string> } {
    const lines = new Set<string>();
    const shas = new Set<string>();
    for (const a of run.attribution) {
        lines.add(`${a.commitSha}\u0000${a.path}`);
        shas.add(a.commitSha);
    }
    return { lines, shas };
}

/** Whether a blamed line is the run's (its commit and path are attributed to the run). */
export const blamedToRun = (index: { lines: ReadonlySet<string> }, line: BlamedLine): boolean =>
    index.lines.has(`${line.sha}\u0000${line.path}`);

/** A git path as printed in a header: C-quoted (`"a/\303\251.ts"`) or plain, with its `a/`/`b/` prefix dropped. */
export function unquoteGitPath(raw: string, prefixed = true): string {
    let name = raw.trim();
    if (name.startsWith('"') && name.endsWith('"')) {
        const bytes: number[] = [];
        const body = name.slice(1, -1);
        for (let i = 0; i < body.length; i++) {
            const ch = body[i]!;
            if (ch !== '\\') { bytes.push(...new TextEncoder().encode(ch)); continue; }
            const next = body[++i]!;
            if (/[0-7]/.test(next)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; continue; }
            bytes.push(({ n: 10, t: 9, r: 13, '"': 34, '\\': 92 } as Record<string, number>)[next] ?? next.charCodeAt(0));
        }
        name = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    }
    return prefixed && (name.startsWith('a/') || name.startsWith('b/')) ? name.slice(2) : name;
}

/**
 * `git diff -U0` (or the patch part of `git log -p -U0`) → per parent path, the 1-based parent lines removed or modified.
 * A pure addition (`-a,0`) removes nothing; a created file (`--- /dev/null`) has none.
 *
 * HEADER STATE. A `--- ` line is a file header only between `diff --git` and the file's first `@@`; inside a hunk it is a
 * REMOVED line whose text starts with `-- ` (an SQL or Lua comment), never a new file.
 */
export function parseRemovedLines(diff: string): Map<string, number[]> {
    const out = new Map<string, number[]>();
    let current: number[] | undefined;
    let inHeader = false;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            inHeader = true;
            current = undefined;
            continue;
        }
        if (inHeader && line.startsWith('--- ')) {
            const name = line.slice(4).trim();
            current = name === '/dev/null' ? undefined : [];
            if (current) out.set(unquoteGitPath(name), current);
            continue;
        }
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
        if (!hunk) continue;
        inHeader = false;
        if (!current) continue;
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        for (let n = 0; n < count; n++) current.push(start + n);
    }
    return out;
}

/** A commit of `git log --first-parent -p -U0 --format=<RS>%H<US>%cI<US>%P<US>%B<RS>` and its removed lines. */
export interface PatchedCommit {
    sha: string;
    at: string;
    /** More than one parent: a merge, never a fix and never a revert by itself. */
    merge: boolean;
    message: string;
    removed: Map<string, number[]>;
}

export const LOG_RS = '\u001e';
export const LOG_US = '\u001f';

/**
 * Parses ONE `git log -p -U0 --format=<RS>%H<US>%cI<US>%P<US>%B<RS>` stream (each commit's header block is wrapped in
 * record separators; its patch follows up to the next one).
 */
export function parseLogPatch(out: string): PatchedCommit[] {
    const parts = out.split(LOG_RS);
    const commits: PatchedCommit[] = [];
    for (let i = 1; i + 1 < parts.length; i += 2) {
        const [sha, at, parents = '', message = ''] = parts[i]!.split(LOG_US);
        if (!sha || !at) continue;
        commits.push({
            sha: sha.trim(), at: at.trim(), merge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
            message: message.trim(), removed: parseRemovedLines(parts[i + 1] ?? ''),
        });
    }
    return commits;
}

/**
 * `git blame --porcelain <parent> -- <path>` → final (parent) line → its origin commit and path. Each group header is
 * `<sha> <orig-line> <final-line> [<count>]`; a `filename` line names the origin path (repeated groups of a commit
 * already seen may omit it, so the last name per sha is reused).
 */
export function parseBlamePorcelain(out: string, fallbackPath: string): Map<number, BlamedLine> {
    const result = new Map<number, BlamedLine>();
    const pathOf = new Map<string, string>();
    let pending: { sha: string; line: number } | undefined;
    for (const raw of out.split('\n')) {
        // SHA-1 (40) or SHA-256 (64) object names.
        const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/.exec(raw);
        if (header) {
            pending = { sha: header[1]!, line: Number(header[2]) };
            continue;
        }
        if (!pending) continue;
        if (raw.startsWith('filename ')) pathOf.set(pending.sha, unquoteGitPath(raw.slice('filename '.length), false));
        else if (raw.startsWith('\t')) {
            result.set(pending.line, { sha: pending.sha, path: pathOf.get(pending.sha) ?? fallbackPath });
            pending = undefined;
        }
    }
    return result;
}
