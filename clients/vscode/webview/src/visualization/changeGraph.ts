/**
 * The change GRAPH for the Visualization tab: what a run's file edits become once they
 * have to be READ, not just counted — one node per changed file (its knowledge-graph
 * `NodeRef` id, its before/after diff from `diffModel.ts`, the tools that touched it)
 * plus the edges the diff text itself reveals (a file that newly imports another changed
 * file). Nothing here reads a file, shells out to git, or knows React exists.
 *
 * Host-free on purpose (no `vscode` import, no DOM), like `diffModel.ts`: pure data,
 * unit-tested without an extension host.
 */

import { srcRef, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import {
  normalizePath,
  relativeTo,
  type PendingChangeRepo,
  type PendingChangeSet,
  type PendingChangeStatus,
} from '../../../src/gitChangeModel';
import { keyOf, toPosix, type FileDiff } from './diffModel';

/** One node of the change graph: a file the run touched. */
export interface ChangeNode {
  /**
   * The node id — the knowledge graph's `NodeRef` for the file, `src:${rootId}::${path}`,
   * so the same path in two repositories is two nodes (PRD 38 §4.10).
   */
  id: NodeRef;
  /** The repository the file belongs to (see {@link changeRootIds}). */
  rootId: string;
  /** Repo-relative POSIX path. */
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

/** A reference between two CHANGED files discovered in the diff text, by node id. */
export interface ChangeEdge {
  from: NodeRef;
  to: NodeRef;
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
 * The root id of each repository, in order — the `rootId` of its files' `NodeRef`s: the
 * knowledge-graph root id the host computed (`PendingChangeRepo.rootId`, `rootIdFor`), so
 * a changed file's ref IS its knowledge node's ref and the Live lens can light it. A repo
 * the host sent without one falls back to its folder name. Two repositories that would
 * share an id (two worktrees of one remote, two same-named folders) are told apart by
 * their normalized root path, so their files can never collapse into one node.
 */
export function changeRootIds(repos: readonly Pick<PendingChangeRepo, 'root' | 'name' | 'rootId'>[]): string[] {
  const ids = repos.map((repo) => repo.rootId || repo.name || repo.root.replace(/\\/g, '/').split('/').filter(Boolean).pop() || repo.root);
  return ids.map((id, i) => (ids.indexOf(id) === ids.lastIndexOf(id) ? id : normalizePath(repos[i]!.root)));
}

/**
 * Build the graph the Visualization tab renders, from the three things it has: the
 * workspace's pending changes (the authority on WHICH files git can see and their
 * status), the parsed diffs (what each file's before/after looks like), and the
 * run's ordered tool trace (which tool wrote what, and when).
 *
 * One node per DISTINCT file: per repository, deduped case-insensitively on a
 * separator-normalized key — a file staged and then edited again is one row in the view,
 * not two — while the same path in two repositories (a monorepo's nested package, two
 * workspace folders) is two nodes, told apart by their `NodeRef` id. Sorted by path,
 * then id, so the tree does not reshuffle between refreshes.
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
  const rootIds = changeRootIds(changes.repos);
  const byKey = new Map<string, ChangeNode>();
  /** Every path a node answers to, so a tool call recorded either repo-relative or
   *  absolute lands on the same node. An absolute path names one repository; a bare
   *  relative path two repositories share answers with the first. */
  const byAlias = new Map<string, ChangeNode>();
  const alias = (path: string, node: ChangeNode): void => {
    const key = keyOf(path);
    if (!byAlias.has(key)) byAlias.set(key, node);
  };

  changes.repos.forEach((repo, r) => {
    const rootId = rootIds[r]!;
    for (const change of repo.changes) {
      const relative = toPosix(change.relativePath || relativeTo(repo.root, change.path));
      const pathKey = keyOf(relative);
      if (!pathKey) continue;
      const key = `${rootId}\u0000${pathKey}`;
      const existing = byKey.get(key);
      if (existing) {
        // First occurrence wins for `status` (the same rule `dedupeChanges` uses);
        // `staged` is the OR, because a file can be in the index AND edited again.
        existing.staged = existing.staged || change.staged;
        continue;
      }
      const parsed = diffByKey.get(pathKey);
      const node: ChangeNode = {
        id: srcRef(rootId, relative),
        rootId,
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
      alias(change.path, node);
      alias(relative, node);
      alias(relativeTo(repo.root, change.path), node);
    }
  });

  const nodes = [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
              if (target.id === node.id) continue;
              const id = `${node.id}\u0000${target.id}`;
              const edge = weights.get(id);
              if (edge) edge.weight += 1;
              else weights.set(id, { from: node.id, to: target.id, weight: 1 });
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