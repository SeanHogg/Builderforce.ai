import { describe, expect, it } from 'vitest';

import type { PendingChangeSet, PendingChangeStatus } from '../../../src/gitChangeModel';
import {
  buildChangeGraph,
  parseUnifiedDiff,
  type ChangeEdge,
  type ChangeNode,
} from './diffModel';

/**
 * The parsing and the graph ARE the feature: every BEFORE/AFTER pair the
 * Visualization tab shows is derived from these two pure functions, and a
 * mis-numbered row or a dropped file is something the user cannot reconcile with
 * the Source Control view sitting right next to it. So the tests assert exact line
 * numbers, exact row kinds and exact counts — not merely "it did not throw".
 */

const ROOT = 'C:/repo';

/** A pending-change set for one repo, built the way the host builds it. */
function changeSet(...changes: Array<[string, PendingChangeStatus, boolean]>): PendingChangeSet {
  const repo = {
    root: ROOT,
    name: 'repo',
    changes: changes.map(([file, status, staged]) => ({
      path: `${ROOT}/${file}`,
      relativePath: file,
      repoRoot: ROOT,
      status,
      staged,
    })),
  };
  return { total: repo.changes.length, repos: [repo] };
}

/** Join diff lines with newlines the way git does — including the trailing one. */
const diff = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** A one-file modification, the shape every other fixture edits. */
const MODIFIED = diff(
  'diff --git a/src/app/run.ts b/src/app/run.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/app/run.ts',
  '+++ b/src/app/run.ts',
  '@@ -10,4 +10,5 @@ export function run() {',
  ' const started = Date.now();',
  '-  const done = false;',
  '+  const done = await settle();',
  '+  const elapsed = Date.now() - started;',
  ' return done;',
);

describe('parseUnifiedDiff', () => {
  it('reads a modified hunk with correct line numbers and row kinds', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file).toMatchObject({ path: 'src/app/run.ts', tracked: true, added: 2, removed: 1 });
    expect(file?.hunks).toHaveLength(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.header).toBe('@@ -10,4 +10,5 @@ export function run() {');
    expect([hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]).toEqual([10, 4, 10, 5]);
    // Only the leading marker is stripped: the line's own indentation survives, which
    // is what makes an indented row read as code rather than as a column of text.
    expect(hunk.rows).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10, text: 'const started = Date.now();' },
      { kind: 'del', oldLine: 11, text: '  const done = false;' },
      { kind: 'add', newLine: 11, text: '  const done = await settle();' },
      { kind: 'add', newLine: 12, text: '  const elapsed = Date.now() - started;' },
      { kind: 'context', oldLine: 12, newLine: 13, text: 'return done;' },
    ]);
    // A deleted line has no line number on the NEW side, and vice versa.
    expect(hunk.rows[1]?.newLine).toBeUndefined();
    expect(hunk.rows[2]?.oldLine).toBeUndefined();
  });

  it('defaults the omitted ,1 counts of a one-line hunk to 1', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -3 +7 @@',
        '-const before = 1;',
        '+const after = 2;',
      ),
    );
    expect(file?.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 7, newLines: 1 });
  });

  it('reads a pure addition — no old side, every row new', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        'index 0000000..1234567',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+export const a = 1;',
        '+export const b = 2;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new.ts', added: 2, removed: 0, tracked: true });
    expect(file?.hunks[0]?.rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['add', undefined, 1],
      ['add', undefined, 2],
    ]);
  });

  it('reads a pure deletion — no new side, every row old', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old.ts b/src/old.ts',
        'deleted file mode 100644',
        'index 1234567..0000000',
        '--- a/src/old.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-export const gone = true;',
        '-export const alsoGone = true;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/old.ts', added: 0, removed: 2, tracked: true });
    expect(file?.hunks[0]?.rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['del', 1, undefined],
      ['del', 2, undefined],
    ]);
  });

  it('strips the a/ and b/ prefixes and the no-newline marker', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/docs/readme.md b/docs/readme.md',
        '--- a/docs/readme.md',
        '+++ b/docs/readme.md',
        '@@ -1,2 +1,2 @@',
        ' hello',
        '-goodbye',
        '+farewell',
        '\\ No newline at end of file',
      ),
    );
    expect(file?.path).toBe('docs/readme.md');
    expect(file?.hunks[0]?.rows).toHaveLength(3);
  });

  it('reports an untracked file as untracked, with no hunks', () => {
    const [file] = parseUnifiedDiff('', ['src/brand-new.ts']);
    expect(file).toEqual({ path: 'src/brand-new.ts', hunks: [], added: 0, removed: 0, tracked: false });
  });

  it('lists a brand-new file alongside the tracked ones', () => {
    const files = parseUnifiedDiff(MODIFIED, ['src/brand-new.ts']);
    expect(files.map((f) => f.path)).toEqual(['src/app/run.ts', 'src/brand-new.ts']);
    expect(files[1]?.tracked).toBe(false);
    // The modified file keeps its diff — listing it as untracked does not clear it.
    expect(files[0]?.tracked).toBe(true);
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('reports a rename under its new name', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old/name.ts b/src/new/name.ts',
        'similarity index 92%',
        'rename from src/old/name.ts',
        'rename to src/new/name.ts',
        '--- a/src/old/name.ts',
        '+++ b/src/new/name.ts',
        '@@ -1,1 +1,1 @@',
        '-const before = 1;',
        '+const after = 2;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new/name.ts', added: 1, removed: 1, tracked: true });
  });

  it('reads a rename that has no hunks at all', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old/name.ts b/src/new/name.ts',
        'similarity index 100%',
        'rename from src/old/name.ts',
        'rename to src/new/name.ts',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new/name.ts', hunks: [], tracked: true });
  });

  it('splits a multi-file diff into one entry per file', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -5,2 +5,2 @@',
        ' keep',
        '-old',
        '+new',
        'diff --git a/src/c.ts b/src/c.ts',
        '--- a/src/c.ts',
        '+++ b/src/c.ts',
        '@@ -9 +9 @@',
        '-gone',
        '+back',
      ),
    );
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['src/a.ts', 1, 1],
      ['src/b.ts', 1, 1],
      ['src/c.ts', 1, 1],
    ]);
    expect(files[1]?.hunks[0]?.rows).toHaveLength(3);
    expect(files[1]?.hunks[0]?.newStart).toBe(5);
  });

  it('yields zero hunks for a binary file rather than failing', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/assets/logo.png b/assets/logo.png',
        'index 1234567..89abcde 100644',
        'Binary files a/assets/logo.png and b/assets/logo.png differ',
      ),
    );
    expect(file).toEqual({ path: 'assets/logo.png', hunks: [], added: 0, removed: 0, tracked: true });
  });

  it('keeps going after a truncated header instead of throwing', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git ',
        'this is not a diff at all',
        '@@ nonsense @@',
        '---',
        '+++',
        'diff --git a/src/ok.ts b/src/ok.ts',
        '--- a/src/ok.ts',
        '+++ b/src/ok.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(files[0]?.added).toBe(1);
  });

  it('does not throw on empty, whitespace or binary-patch input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n\n')).toEqual([]);
    // A patch with no readable header names no file, so it names no diff either.
    expect(parseUnifiedDiff(diff('GIT binary patch', 'literal 12', 'zcmZ?wbhEHb'))).toEqual([]);
  });

  it('reads a plain diff with no diff --git header and no prefixes', () => {
    const [file] = parseUnifiedDiff(diff('--- src/plain.ts', '+++ src/plain.ts', '@@ -1 +1 @@', '-a', '+b'));
    expect(file).toMatchObject({ path: 'src/plain.ts', added: 1, removed: 1 });
  });

  it('reads a header path git quoted because it contains a space', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git "a/src/my file.ts" "b/src/my file.ts"',
        '--- "a/src/my file.ts"',
        '+++ "b/src/my file.ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(file?.path).toBe('src/my file.ts');
  });

  it('does not mistake a deleted line whose text starts --- for a header', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/doc.ts b/src/doc.ts',
        '--- a/src/doc.ts',
        '+++ b/src/doc.ts',
        '@@ -1,3 +1,3 @@',
        ' intro',
        '--- a section ---',
        '-++ not an added line',
        ' tail',
      ),
    );
    expect(file?.path).toBe('src/doc.ts');
    expect(file?.hunks[0]?.rows.map((r) => r.kind)).toEqual(['context', 'del', 'del', 'context']);
    expect(file?.hunks[0]?.rows[2]?.text).toBe('++ not an added line');
  });

  it('treats a stripped blank line inside a hunk as context, not as a terminator', () => {
    const [file] = parseUnifiedDiff(
      diff('diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1,3 +1,4 @@', ' a', '', '+b', ' c'),
    );
    expect(file?.hunks[0]?.rows).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'context', oldLine: 2, newLine: 2, text: '' },
      { kind: 'add', newLine: 3, text: 'b' },
      { kind: 'context', oldLine: 3, newLine: 4, text: 'c' },
    ]);
  });
});

describe('buildChangeGraph', () => {
  /** Node paths only — the id the view and the tests agree on. */
  const paths = (graph: { nodes: ChangeNode[] }): string[] => graph.nodes.map((n) => n.path);

  it('emits one node per distinct file, sorted by path', () => {
    const graph = buildChangeGraph(
      changeSet(['src/b.ts', 'modified', false], ['src/a.ts', 'modified', true]),
      parseUnifiedDiff(''),
      [],
    );
    expect(paths(graph)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(graph.fileCount).toBe(2);
    expect(graph.nodes[0]).toMatchObject({ status: 'modified', staged: true, tools: [] });
    expect(graph.nodes[1]).toMatchObject({ status: 'modified', staged: false });
  });

  it('dedupes a file that appears in two repos, and ORs its staged flag', () => {
    const nested = {
      root: `${ROOT}/packages/app`,
      name: 'app',
      changes: [
        {
          path: `${ROOT}/packages/app/src/a.ts`,
          relativePath: 'src/a.ts',
          repoRoot: `${ROOT}/packages/app`,
          status: 'modified' as const,
          staged: true,
        },
      ],
    };
    const graph = buildChangeGraph(
      { total: 2, repos: [changeSet(['src/a.ts', 'modified', false]).repos[0]!, nested] },
      parseUnifiedDiff(''),
      [],
    );
    // First occurrence wins for status; `staged` is the OR across occurrences.
    expect(paths(graph)).toEqual(['src/a.ts']);
    expect(graph.nodes[0]?.staged).toBe(true);
  });

  it('dedupes case- and separator-insensitively', () => {
    const repo = {
      root: ROOT,
      name: 'repo',
      changes: [
        { path: `${ROOT}/src/A.ts`, relativePath: 'src/A.ts', repoRoot: ROOT, status: 'modified' as const, staged: false },
        { path: 'C:\\repo\\src\\a.ts', relativePath: 'src\\a.ts', repoRoot: ROOT, status: 'modified' as const, staged: false },
      ],
    };
    const graph = buildChangeGraph({ total: 2, repos: [repo] }, parseUnifiedDiff(''), []);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.path).toBe('src/A.ts');
  });

  it('splits a path into the directory and leaf labels the tree groups by', () => {
    const graph = buildChangeGraph(
      changeSet(['src/lib/deep/parser.test.ts', 'modified', false], ['README.md', 'modified', false]),
      parseUnifiedDiff(''),
      [],
    );
    // Sorted the way `dedupeChanges` sorts pending changes: `localeCompare`, so a
    // root-level README comes before `src/…` rather than after every capitalised name.
    expect(graph.nodes.map((n) => [n.dir, n.name])).toEqual([
      ['', 'README'],
      ['src/lib/deep', 'parser.test'],
    ]);
  });

  it('attaches the diff to its node and totals added and removed', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false]),
      parseUnifiedDiff(MODIFIED),
      [],
    );
    expect(graph).toMatchObject({ fileCount: 1, added: 2, removed: 1 });
    expect(graph.nodes[0]?.diff.path).toBe('src/app/run.ts');
    expect(graph.nodes[0]?.diff.hunks[0]?.rows).toHaveLength(5);
  });

  it('gives a pending change with no diff text an empty, tracked diff', () => {
    const graph = buildChangeGraph(changeSet(['src/no-diff.ts', 'modified', false]), parseUnifiedDiff(''), []);
    expect(graph.nodes[0]?.diff).toEqual({ path: 'src/no-diff.ts', hunks: [], added: 0, removed: 0, tracked: true });
    expect(graph).toMatchObject({ added: 0, removed: 0, size: 10 });
  });

  it('marks a node the host could not diff as untracked', () => {
    const graph = buildChangeGraph(changeSet(['src/new.ts', 'untracked', false]), [], []);
    expect(graph.nodes[0]?.diff.tracked).toBe(false);
  });

  it('attributes each tool call to the node it wrote, in order', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false], ['src/b.ts', 'modified', false]),
      parseUnifiedDiff(''),
      [
        { tool: 'write_file', path: 'src/a.ts', ts: '2026-10-18T19:00:00.000Z' },
        { tool: 'edit_file', path: 'src/b.ts', ts: '2026-10-18T19:05:00.000Z' },
        { tool: 'apply_patch', path: 'src/a.ts', ts: '2026-10-18T19:01:00.000Z' },
      ],
    );
    const a = graph.nodes.find((n) => n.path === 'src/a.ts');
    const b = graph.nodes.find((n) => n.path === 'src/b.ts');
    expect(a?.tools).toEqual(['write_file', 'apply_patch']);
    expect(a?.firstTouchedAt).toBe('2026-10-18T19:00:00.000Z');
    expect(b?.tools).toEqual(['edit_file']);
    expect(b?.firstTouchedAt).toBe('2026-10-18T19:05:00.000Z');
  });

  it('does not repeat a tool the run used twice on one file', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false]),
      parseUnifiedDiff(''),
      [
        { tool: 'edit_file', path: 'src/a.ts' },
        { tool: 'edit_file', path: 'src/a.ts' },
      ],
    );
    expect(graph.nodes[0]?.tools).toEqual(['edit_file']);
  });

  it('matches an absolute tool path to the same node as a repo-relative one', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false]),
      parseUnifiedDiff(''),
      [
        { tool: 'write_file', path: 'C:\\repo\\src\\a.ts' },
        { tool: 'read_file', path: 'C:/repo/src/a.ts', ts: '2026-10-18T19:00:00.000Z' },
      ],
    );
    expect(graph.nodes[0]?.tools).toEqual(['write_file', 'read_file']);
  });

  it('ignores a tool call for a path git cannot see, without inventing a node', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false]),
      parseUnifiedDiff(''),
      [
        { tool: 'write_file', path: 'src/ignored.txt' },
        { tool: 'write_file', path: 'other/repo/out.ts' },
      ],
    );
    expect(paths(graph)).toEqual(['src/a.ts']);
    expect(graph.nodes[0]?.tools).toEqual([]);
  });

  it('leaves firstTouchedAt undefined when the run recorded no timestamp', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false]),
      parseUnifiedDiff(''),
      [{ tool: 'write_file', path: 'src/a.ts' }],
    );
    expect(graph.nodes[0]?.firstTouchedAt).toBeUndefined();
  });

  it('links an added import to the other changed file it names', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false], ['src/lib/parser.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -0,0 +1,2 @@',
          "+import { parse } from '../lib/parser';",
          "+import { helper } from './helper';",
          'diff --git a/src/lib/parser.ts b/src/lib/parser.ts',
          '--- a/src/lib/parser.ts',
          '+++ b/src/lib/parser.ts',
          '@@ -1,1 +1,1 @@',
          '-export const parse = null;',
          '+export const parse = (s: string) => s;',
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual<ChangeEdge[]>([{ from: 'src/app/run.ts', to: 'src/lib/parser.ts', weight: 1 }]);
  });

  it('matches a specifier on its trailing segments, extension optional', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false], ['src/lib/parser.ts', 'added', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -0,0 +1,3 @@',
          "+import { parse } from '../lib/parser';",
          "+import { parse } from '../../lib/parser.ts';",
          "+const parser = require('../lib/parser.js');",
        ),
      ),
      [],
    );
    // Three reference sites, one edge.
    expect(graph.edges).toEqual([{ from: 'src/app/run.ts', to: 'src/lib/parser.ts', weight: 3 }]);
  });

  it('counts a removed import as a reference too', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false], ['src/lib/parser.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -1,2 +1,1 @@',
          "-import { parse } from '../lib/parser';",
          '-const parsed = parse(input);',
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([{ from: 'src/app/run.ts', to: 'src/lib/parser.ts', weight: 1 }]);
  });

  it('ignores an import that does not resolve to another changed file', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -0,0 +1,2 @@',
          "+import React from 'react';",
          "+import { parse } from '../lib/parser';",
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([]);
  });

  it('ignores a reference to a file that exists but was not changed by this run', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -0,0 +1 @@',
          "+import { parse } from '../lib/parser';",
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([]);
  });

  it('never draws a self-edge, even when a file imports itself by name', () => {
    const graph = buildChangeGraph(
      changeSet(['src/lib/parser.ts', 'modified', false], ['src/lib/parser.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/lib/parser.ts b/src/lib/parser.ts',
          '--- a/src/lib/parser.ts',
          '+++ b/src/lib/parser.ts',
          '@@ -1,1 +1,2 @@',
          "+export { parse } from './parser';",
          '+export const parse = (s: string) => s;',
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([]);
  });

  it('resolves a directory import to its index file', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false], ['src/lib/parser/index.ts', 'added', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -0,0 +1 @@',
          "+import { parse } from '../lib/parser';",
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([{ from: 'src/app/run.ts', to: 'src/lib/parser/index.ts', weight: 1 }]);
  });

  it('sorts edges by from, then to', () => {
    const graph = buildChangeGraph(
      changeSet(
        ['src/a/one.ts', 'modified', false],
        ['src/a/two.ts', 'modified', false],
        ['src/b/three.ts', 'modified', false],
      ),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/b/three.ts b/src/b/three.ts',
          '--- a/src/b/three.ts',
          '+++ b/src/b/three.ts',
          '@@ -0,0 +1,2 @@',
          "+import { one } from '../a/one';",
          "+import { two } from '../a/two';",
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual<ChangeEdge[]>([
      { from: 'src/b/three.ts', to: 'src/a/one.ts', weight: 1 },
      { from: 'src/b/three.ts', to: 'src/a/two.ts', weight: 1 },
    ]);
  });

  it('does not draw an edge out of a context line the run did not write', () => {
    const graph = buildChangeGraph(
      changeSet(['src/app/run.ts', 'modified', false], ['src/lib/parser.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/app/run.ts b/src/app/run.ts',
          '--- a/src/app/run.ts',
          '+++ b/src/app/run.ts',
          '@@ -1,2 +1,2 @@',
          " import { parse } from '../lib/parser';",
          '-const parsed = parse(input);',
          '+const parsed = parse(input.trim());',
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual([]);
  });

  it('links two changed files in both directions as separate directed edges', () => {
    const graph = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false], ['src/b.ts', 'modified', false]),
      parseUnifiedDiff(
        diff(
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -0,0 +1 @@',
          "+import { b } from './b';",
          'diff --git a/src/b.ts b/src/b.ts',
          '--- a/src/b.ts',
          '+++ b/src/b.ts',
          '@@ -0,0 +1 @@',
          "+import { a } from './a';",
        ),
      ),
      [],
    );
    expect(graph.edges).toEqual<ChangeEdge[]>([
      { from: 'src/a.ts', to: 'src/b.ts', weight: 1 },
      { from: 'src/b.ts', to: 'src/a.ts', weight: 1 },
    ]);
  });

  it('sizes 0 for an empty graph and 10 for a single one-line change', () => {
    expect(buildChangeGraph(changeSet(), parseUnifiedDiff(''), []).size).toBe(0);
    const one = buildChangeGraph(
      changeSet(['src/a.ts', 'modified', false]),
      parseUnifiedDiff(
        diff('diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-a', '+b'),
      ),
      [],
    );
    expect(one.size).toBe(10);
  });

  it('adds the added and removed counts as a fraction of the meter', () => {
    const big = parseUnifiedDiff(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1,20 @@',
        '-a',
        ...Array.from({ length: 20 }, (_, i) => `+line ${i}`),
      ),
    );
    const graph = buildChangeGraph(changeSet(['src/a.ts', 'modified', false]), big, []);
    // 1 file = 10, plus 20 added / 20 = 1, plus 1 removed / 20 rounds to 0.
    expect(graph.size).toBe(11);
  });

  it('clamps the meter at 100', () => {
    const many = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
    const repo = {
      root: ROOT,
      name: 'repo',
      changes: many.map((file) => ({
        path: `${ROOT}/${file}`,
        relativePath: file,
        repoRoot: ROOT,
        status: 'modified' as const,
        staged: false,
      })),
    };
    const graph = buildChangeGraph({ total: repo.changes.length, repos: [repo] }, parseUnifiedDiff(''), []);
    expect(graph.fileCount).toBe(30);
    expect(graph.size).toBe(100);
  });
});