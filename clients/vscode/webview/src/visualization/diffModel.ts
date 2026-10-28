/**
 * The diff half of the Visualization tab's change-graph domain: a run's `git diff` text
 * parsed into before/after rows, per file. The graph itself — nodes, `NodeRef` ids and
 * the import edges the diff reveals — is `changeGraph.ts`, built from these.
 *
 * The panel carries two surfaces — the Creation Canvas, and a visual "code change
 * tree" that takes over the moment an agent run starts writing files. This module is
 * that tree's DATA: one node per changed file carrying its before/after diff, plus
 * the edges the diff text itself reveals (a file that newly imports another changed
 * file). Nothing here reads a file, shells out to git, or knows React exists: the
 * caller hands over the pending changes, the `git diff` text and the run's tool
 * trace, and gets back a graph it can render without having to ask anything again.
 *
 * Host-free on purpose (no `vscode` import, no DOM) for the same reason
 * {@link file://../../../src/gitChangeModel.ts} is — this is the half of the view
 * worth unit-testing without an extension host, and it is pure data by construction.
 */

import { normalizePath, unquotePath } from '../../../src/gitChangeModel';

/** One line of a unified diff. */
export type DiffRowKind = 'context' | 'add' | 'del';

export interface DiffRow {
  kind: DiffRowKind;
  /** Line number in the OLD file, undefined for an added line. */
  oldLine?: number;
  /** Line number in the NEW file, undefined for a deleted line. */
  newLine?: number;
  /** The line's text, with the leading ' ', '+' or '-' stripped. */
  text: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rows: DiffRow[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** False when the file is untracked — the whole file is new, no `before` to diff. */
  tracked: boolean;
}

/** Git's "no such side" sentinel on a `---`/`+++` line. */
const DEV_NULL = '/dev/null';

/**
 * `@@ -oldStart[,oldLines] +newStart[,newLines] @@` — git omits the `,1` on a
 * one-line hunk, so both counts are optional captures that default to 1.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** POSIX-normalize a path WITHOUT folding case — the form we display and store. */
export function toPosix(path: string): string {
  return unquotePath(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

/** The identity a path is compared under: separators normalized, case-insensitive,
 *  trailing separator dropped — the same rule {@link normalizePath} applies to
 *  pending changes, so a diff path and a status path agree without extra work. */
export function keyOf(path: string): string {
  return normalizePath(toPosix(path));
}

/**
 * Split `diff --git a/x b/x` into its two paths. Git quotes a path containing a
 * space (`"a/x y.ts" "b/x y.ts"`), so the quoted form is matched whole rather than
 * split on ` b/` — which would cut inside the name. Returns null for a header that
 * is not two paths; the caller then skips the file instead of inventing a path.
 */
function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice('diff --git '.length).trim();
  if (!rest) return null;
  const strip = (raw: string): string => {
    const value = unquotePath(raw.trim()).replace(/\\/g, '/');
    return /^[ab]\//.test(value) ? value.slice(2) : value;
  };
  const quoted = /^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quoted) return { oldPath: strip(`"${quoted[1]}"`), newPath: strip(`"${quoted[2]}"`) };
  const split = rest.lastIndexOf(' b/');
  if (split < 0) return null;
  const oldPath = strip(rest.slice(0, split));
  const newPath = strip(rest.slice(split + 1));
  if (!newPath) return null;
  return { oldPath, newPath };
}

/**
 * The path on a `---`/`+++` line, or null when there is none — `/dev/null` (an
 * added or deleted side has no path at all) and an empty column both land here. A
 * tab separates the path from a timestamp in plain `diff -u` output, so only the
 * first column is read; git's C-quoting is undone for the quoted form.
 */
function parseFileHeaderPath(line: string, prefix: '--- ' | '+++ '): string | null {
  if (!line.startsWith(prefix)) return null;
  const raw = line.slice(prefix.length).split('\t')[0]?.trim() ?? '';
  if (!raw || raw === DEV_NULL) return null;
  const value = unquotePath(raw).replace(/\\/g, '/');
  return /^[ab]\//.test(value) ? value.slice(2) : value;
}

/**
 * Does this line carry a diff ROW? A body line always starts with ' ', '+' or '-';
 * git emits an EMPTY line for a blank context line once trailing whitespace is
 * stripped, so that counts as context too. Anything else inside a hunk is a header
 * we did not expect, and is dropped rather than rendered as text.
 */
function isRowLine(line: string): boolean {
  if (line === '') return true;
  return line.startsWith(' ') || line.startsWith('+') || line.startsWith('-');
}

/** Turn one body line into a row, carrying the old/new line numbers it lands on. */
function readRow(line: string, oldLine: number, newLine: number): DiffRow {
  if (line === '') return { kind: 'context', oldLine, newLine, text: '' };
  const text = line.slice(1);
  if (line.startsWith('+')) return { kind: 'add', newLine, text };
  if (line.startsWith('-')) return { kind: 'del', oldLine, text };
  return { kind: 'context', oldLine, newLine, text };
}

/**
 * Parse `git diff --no-color` output — one file, or several files concatenated —
 * into per-file diffs.
 *
 * Tolerant by construction: this text is whatever a run produced through a shell,
 * and a header it cannot read costs that ONE file its diff rather than the whole
 * panel its content. So an unparseable header is skipped, `Binary files … differ`
 * and a binary patch yield zero hunks instead of an error, `---`/`+++` are only read
 * OUTSIDE a hunk (a deleted line whose text starts `--` must not be mistaken for a
 * header), and paths come back repo-relative — no root prefix, no `a/`/`b/`. A rename
 * is reported under its NEW name, taken from `rename to` or the `+++` line.
 *
 * `untrackedPaths` are the files git cannot diff because they are not in the index at
 * all. Each is returned with an empty hunk list and `tracked:false`, appended when
 * the diff text does not mention it — the view needs a node for a brand-new file even
 * though there is no before/after to show for it.
 */
export function parseUnifiedDiff(diffText: string, untrackedPaths?: string[]): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  // A binary patch carries payload lines that look nothing like a diff row; once the
  // marker is seen, everything up to the next `diff --git` is ignored.
  let binary = false;

  // A trailing newline is a TERMINATOR, not a blank final row — and since a blank
  // context line inside a hunk is indistinguishable from an empty line once
  // trailing whitespace has been stripped, that distinction has to be made here.
  const rawLines = diffText.split('\n');
  if (diffText.endsWith('\n')) rawLines.pop();

  for (const raw of rawLines) {
    const line = raw.replace(/\r$/, '');
    // Informational: it means the file's last line changed, and it is not a row.
    if (line.startsWith('\\')) continue;

    if (line.startsWith('diff --git ')) {
      hunk = null;
      binary = false;
      const paths = parseDiffGitHeader(line);
      file = paths
        ? { path: paths.newPath || paths.oldPath, hunks: [], added: 0, removed: 0, tracked: true }
        : null;
      if (file) files.push(file);
      continue;
    }

    if (!file) {
      // `git diff --no-prefix`, plain `diff -u` and hand-built fixtures emit no
      // `diff --git` line: the ---/+++ pair is the only header they have.
      const solo = parseFileHeaderPath(line, '--- ') ?? parseFileHeaderPath(line, '+++ ');
      if (!solo) continue;
      file = { path: solo, hunks: [], added: 0, removed: 0, tracked: true };
      files.push(file);
      continue;
    }

    if (binary) continue;
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.hunks = [];
      file.added = 0;
      file.removed = 0;
      hunk = null;
      binary = true;
      continue;
    }

    // `rename to <path>` names the file as it will exist — the same answer the `+++`
    // line gives, taken from here so a rename with no hunks still lands correctly.
    const renamedTo = line.startsWith('rename to ') ? line.slice('rename to '.length) : '';
    if (renamedTo) {
      const path = parseFileHeaderPath(`+++ ${renamedTo}`, '+++ ');
      if (path) file.path = path;
      continue;
    }

    if (!hunk) {
      const headerPath = parseFileHeaderPath(line, '--- ') ?? parseFileHeaderPath(line, '+++ ');
      if (headerPath !== null) {
        // The `+++` side is the NEW name, which is what a rename is labelled with;
        // `--- /dev/null` parses as null and leaves the header path standing.
        if (line.startsWith('+++ ')) file.path = headerPath;
        continue;
      }
    }

    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      if (!match) {
        // An unreadable hunk header is skipped whole: its body lines are dropped with
        // it rather than being attributed to the previous hunk.
        hunk = null;
        continue;
      }
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      hunk = {
        header: line.trimEnd(),
        oldStart: oldLine,
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: newLine,
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        rows: [],
      };
      file.hunks.push(hunk);
      continue;
    }

    // Outside a hunk, `index`, `new file mode`, `similarity index`, `old mode` and
    // friends carry no rows.
    if (!hunk || !isRowLine(line)) continue;
    const row = readRow(line, oldLine, newLine);
    hunk.rows.push(row);
    // A line exists on one side only: counting both would drift after the first row.
    if (row.kind !== 'add') oldLine += 1;
    if (row.kind !== 'del') newLine += 1;
    if (row.kind === 'add') file.added += 1;
    if (row.kind === 'del') file.removed += 1;
  }

  if (untrackedPaths && untrackedPaths.length > 0) {
    const byKey = new Map<string, FileDiff>();
    for (const entry of files) byKey.set(keyOf(entry.path), entry);
    for (const candidate of untrackedPaths) {
      const path = toPosix(candidate);
      const key = keyOf(path);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        // Keep the path git printed (always repo-relative, never quoted) and empty
        // the hunks: an untracked file has no before/after at all.
        existing.tracked = false;
        existing.hunks = [];
        existing.added = 0;
        existing.removed = 0;
        continue;
      }
      const entry: FileDiff = { path, hunks: [], added: 0, removed: 0, tracked: false };
      files.push(entry);
      byKey.set(key, entry);
    }
  }
  return files;
}
