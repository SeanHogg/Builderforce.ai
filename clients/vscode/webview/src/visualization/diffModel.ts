/**
 * The change-graph DOMAIN for the Visualization tab: what a run's file edits become
 * once they have to be READ, not just counted.
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

import {
  normalizePath,
  relativeTo,
  unquotePath,
  type PendingChangeSet,
  type PendingChangeStatus,
} from '../../../src/gitChangeModel';

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

/** One node of the change graph: a file the run touched. */
export interface ChangeNode {
  /** Repo-relative POSIX path — the node id. */
  path: string;
  status: PendingChangeStatus;
  staged: boolean;
  /** The tools that touched this file, in the order the run used them. */
  tools: string[];
  /** ISO timestamp of the FIRST tool call that touched it. */
  firstTouchedAt?: string;
  diff: FileDiff;
  /** Project-relative path without extension, split on `/` — the directory labels
   *  the tree groups by. Empty for a file at the repo root. */
  dir: string;
  /** Basename without extension — the leaf label. */
  name: string;
}

/** A reference between two CHANGED files discovered in the diff text. */
export interface ChangeEdge {
  from: string;
  to: string;
  /** How many reference sites were counted. */
  weight: number;
}

export interface ChangeGraph {
  nodes: ChangeNode[];
  edges: ChangeEdge[];
  /** Distinct files, total added, total removed. */
  fileCount: number;
  added: number;
  removed: number;
  /** 0..100, for the header meter. */
  size: number;
}

/** Git's "no such side" sentinel on a `---`/`+++` line. */
const DEV_NULL = '/dev/null';

/**
 * `@@ -oldStart[,oldLines] +newStart[,newLines] @@` — git omits the `,1` on a
 * one-line hunk, so both counts are optional captures that default to 1.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * An import/require target on a changed line: `from './x'`, `require("./x")`,
 * `import('./x')`, a side-effect `import './x'`, `export … from './x'`, `#include "x.h"`.
 * The specifier is captured and the rest of the line is not — a diff line can be
 * long and the reference is the only part of it the graph cares about.
 */
const IMPORT_SPECIFIER = /\b(?:from|import|require|include)\b\s*\(?\s*['"]([^'"\n]+)['"]/g;

/** How many trailing path segments of an import specifier are compared. A specifier
 *  is matched on its last 2-3 segments (last 1 when it has nothing else), never on a
 *  bare name alone — that is what keeps `import './parser'` from claiming every
 *  `parser.ts` in the run. */
const IMPORT_KEY_SPAN = 3;

/** POSIX-normalize a path WITHOUT folding case — the form we display and store. */
function toPosix(path: string): string {
  return unquotePath(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

/** The identity a path is compared under: separators normalized, case-insensitive,
 *  trailing separator dropped — the same rule {@link normalizePath} applies to
 *  pending changes, so a diff path and a status path agree without extra work. */
function keyOf(path: string): string {
  return normalizePath(toPosix(path));
}

/**
 * Drop a trailing extension, but not from a dotfile (`.gitignore`) and not from a
 * name with no dot. `a.test.ts` → `a.test` — only the LAST extension goes, so a test
 * file stays distinguishable from its non-test sibling.
 */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

/** The directory label and leaf label a node is drawn with. */
function splitLabels(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  const base = slash < 0 ? path : path.slice(slash + 1);
  return { dir: slash < 0 ? '' : path.slice(0, slash), name: stripExtension(base) };
}

/** `src/lib/parser` → `['src','lib','parser']`, extension already stripped. */
function segmentsOf(path: string): string[] {
  const clean = toPosix(path).replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.map((part, index) => (index === parts.length - 1 ? stripExtension(part) : part));
}

/**
 * Every name a changed file can be IMPORTED under: its trailing path segments
 * without the extension, plus its directory when the file is an `index`
 * (`lib/parser/index.ts` is imported as `lib/parser`). Longest first, so the most
 * specific match is tried before the shorter ones.
 */
function importKeysForPath(path: string): string[] {
  const segments = segmentsOf(path);
  const keys: string[] = [];
  for (let span = Math.min(IMPORT_KEY_SPAN, segments.length); span >= 1; span -= 1) {
    keys.push(segments.slice(segments.length - span).join('/'));
  }
  const leaf = segments[segments.length - 1] ?? '';
  if (leaf === 'index' && segments.length > 1) {
    const dir = segments.slice(0, -1);
    for (let span = Math.min(IMPORT_KEY_SPAN, dir.length); span >= 1; span -= 1) {
      keys.push(dir.slice(dir.length - span).join('/'));
    }
  }
  return keys;
}

/**
 * Every name an import SPECIFIER can be matched under, longest first. The graph
 * matches names rather than resolving directories: `../lib/parser` from
 * `src/app/run.ts` and `./parser` from `src/lib/parser.ts` name the same file, and
 * resolving that properly needs a real module resolver, which this model
 * deliberately is not. `.`/`..` segments are dropped rather than counted, so the
 * specifier is compared on the file it names.
 */
function importKeysForSpecifier(specifier: string): string[] {
  const cleaned = toPosix(specifier.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  const segments = cleaned
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part, index, all) => (index === all.length - 1 ? stripExtension(part) : part));
  if (segments.length === 0) return [];
  // A single-segment specifier (`'./parser'`) has nothing more specific to offer, so
  // it is matched on that one name — the only place a bare name is enough.
  const span = segments.length === 1 ? 1 : Math.min(IMPORT_KEY_SPAN, segments.length);
  return [segments.slice(segments.length - span).join('/')];
}

/** Every import specifier mentioned on one diff row, in the order it appears. */
function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  IMPORT_SPECIFIER.lastIndex = 0;
  for (let match = IMPORT_SPECIFIER.exec(text); match; match = IMPORT_SPECIFIER.exec(text)) {
    const specifier = match[1];
    if (specifier) found.push(specifier);
  }
  return found;
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

/**
 * Build the graph the Visualization tab renders, from the three things it has: the
 * workspace's pending changes (the authority on WHICH files git can see and their
 * status), the parsed diffs (what each file's before/after looks like), and the
 * run's ordered tool trace (which tool wrote what, and when).
 *
 * One node per DISTINCT path, deduped case-insensitively on a separator-normalized
 * key — a file staged and then edited again is one row in the view, not two — and
 * sorted by path so the tree does not reshuffle between refreshes.
 *
 * Two things are deliberately NOT modelled here, because only the caller can answer
 * them: a tool call for a path with NO pending change is dropped (the graph draws
 * only files git can see — the sibling UI is expected to surface that gap, e.g. a
 * written-then-reverted or git-ignored file), and an import that points at a file
 * that is not part of this run draws no edge, for the same reason.
 */
export function buildChangeGraph(
  changes: PendingChangeSet,
  diffs: FileDiff[],
  toolCalls: Array<{ tool: string; path: string; ts?: string }>,
): ChangeGraph {
  const diffByKey = new Map<string, FileDiff>();
  for (const diff of diffs) {
    const key = keyOf(diff.path);
    const existing = diffByKey.get(key);
    // Two repos' diff text concatenated can describe one file twice; the copy with
    // content is the one worth drawing.
    if (!existing || (existing.hunks.length === 0 && diff.hunks.length > 0)) {
      diffByKey.set(key, diff);
    }
  }

  const roots = changes.repos.map((repo) => repo.root);
  const byKey = new Map<string, ChangeNode>();
  /** Every path a node answers to, so a tool call recorded either repo-relative or
   *  absolute lands on the same node. */
  const byAlias = new Map<string, ChangeNode>();

  for (const repo of changes.repos) {
    for (const change of repo.changes) {
      const relative = toPosix(change.relativePath || relativeTo(repo.root, change.path));
      const key = keyOf(relative);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        // First occurrence wins for `status` (the same rule `dedupeChanges` uses);
        // `staged` is the OR, because a file can be in the index AND edited again.
        existing.staged = existing.staged || change.staged;
        continue;
      }
      const parsed = diffByKey.get(key);
      const node: ChangeNode = {
        path: relative,
        status: change.status,
        staged: change.staged,
        tools: [],
        diff: parsed
          ? parsed.path === relative
            ? parsed
            : { ...parsed, path: relative }
          : {
              // No diff text for this file: the node still exists, with nothing to
              // render but its status. An untracked file is by definition untracked.
              path: relative,
              hunks: [],
              added: 0,
              removed: 0,
              tracked: change.status !== 'untracked',
            },
        ...splitLabels(relative),
      };
      byKey.set(key, node);
      byAlias.set(keyOf(relative), node);
      byAlias.set(keyOf(change.path), node);
      byAlias.set(keyOf(relativeTo(repo.root, change.path)), node);
    }
  }

  const nodes = [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path));

  for (const call of toolCalls) {
    const node = lookupNode(call.path, byAlias, roots);
    // A write git cannot see (ignored, reverted, outside every repo) is NOT a node —
    // the sibling UI decides how to tell the user about it.
    if (!node) continue;
    if (!node.tools.includes(call.tool)) node.tools.push(call.tool);
    // ISO timestamps order lexicographically, so the earliest is the smallest.
    if (call.ts && (!node.firstTouchedAt || call.ts < node.firstTouchedAt)) {
      node.firstTouchedAt = call.ts;
    }
  }

  const edges = buildEdges(nodes);
  const added = nodes.reduce((sum, node) => sum + node.diff.added, 0);
  const removed = nodes.reduce((sum, node) => sum + node.diff.removed, 0);
  const fileCount = nodes.length;
  return {
    nodes,
    edges,
    fileCount,
    added,
    removed,
    // The meter saturates: past ~10 files the number stops meaning "how big is
    // this" and starts meaning "the panel is full".
    size: fileCount === 0 ? 0 : Math.min(100, Math.round(fileCount * 10 + added / 20 + removed / 20)),
  };
}

/** The node a recorded tool path names, whether the tool recorded it absolute or
 *  repo-relative (tools that write a path the user typed can produce either). */
function lookupNode(
  path: string,
  byAlias: Map<string, ChangeNode>,
  roots: readonly string[],
): ChangeNode | undefined {
  const candidates = [keyOf(path)];
  for (const root of roots) candidates.push(keyOf(relativeTo(root, path)));
  for (const candidate of candidates) {
    const node = byAlias.get(candidate);
    if (node) return node;
  }
  return undefined;
}

/**
 * The references the diff text states, between files this run changed.
 *
 * Added AND deleted rows are both scanned: a removed import is still a statement
 * about how these two files relate, and it is often the clearest one. A specifier is
 * matched on its trailing path segments against the changed files, longest first —
 * `import { x } from '../lib/parser'` reaches `src/lib/parser.ts`, while
 * `import './parser'` in another directory does not, because one segment is only
 * enough for a specifier that HAS one segment. Each hit counts once toward the
 * edge's weight; self-edges are never emitted.
 */
function buildEdges(nodes: ChangeNode[]): ChangeEdge[] {
  const index = new Map<string, ChangeNode[]>();
  for (const node of nodes) {
    for (const key of importKeysForPath(node.path)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(node);
      else index.set(key, [node]);
    }
  }

  const weights = new Map<string, ChangeEdge>();
  for (const node of nodes) {
    for (const hunk of node.diff.hunks) {
      for (const row of hunk.rows) {
        // A context line is a line BOTH versions have; only what this run wrote or
        // removed says anything new about how the files relate.
        if (row.kind === 'context') continue;
        for (const specifier of importSpecifiers(row.text)) {
          for (const key of importKeysForSpecifier(specifier)) {
            const targets = index.get(key);
            if (!targets) continue;
            for (const target of targets) {
              if (target.path === node.path) continue;
              const id = `${node.path}\u0000${target.path}`;
              const edge = weights.get(id);
              if (edge) edge.weight += 1;
              else weights.set(id, { from: node.path, to: target.path, weight: 1 });
            }
            // The longest matching name already found its target; a shorter key for
            // the same specifier would count the same reference twice.
            break;
          }
        }
      }
    }
  }

  return [...weights.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}