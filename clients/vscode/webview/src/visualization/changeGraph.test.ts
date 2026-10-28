import { describe, expect, it } from 'vitest';

import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { repoIdOfRemote, rootIdFor } from '@builderforce/agent-tools/knowledge';
import { buildChangeGraph, type ChangeEdge, type ChangeNode } from './changeGraph';
import { parseUnifiedDiff } from './diffModel';
import { MODIFIED, ROOT, changeSet, diff, ref } from './diffFixtures.test-util';

/**
 * The parsing and the graph ARE the feature: every BEFORE/AFTER pair the
 * Visualization tab shows is derived from these two pure functions, and a
 * mis-numbered row or a dropped file is something the user cannot reconcile with
 * the Source Control view sitting right next to it. So the tests assert exact line
 * numbers, exact row kinds and exact counts — not merely "it did not throw".
 */

describe('buildChangeGraph', () => {
  /** Node paths only (the id is the NodeRef: see `ref`). */
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

  it('keeps a path two repos share as two nodes, one per repository', () => {
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
    // Two files, two repositories: never one merged node (PRD 38 §4.10).
    expect(paths(graph)).toEqual(['src/a.ts', 'src/a.ts']);
    expect(graph.nodes.map((n) => [n.id, n.staged])).toEqual([[ref('src/a.ts', 'app'), true], [ref('src/a.ts'), false]]);
  });

  it('gives the same path in two repositories two NodeRef ids, each with its own diff and tools', () => {
    const second = {
      root: 'C:/other',
      name: 'other',
      changes: [{ path: 'C:/other/package.json', relativePath: 'package.json', repoRoot: 'C:/other', status: 'modified' as const, staged: false }],
    };
    const graph = buildChangeGraph(
      { total: 2, repos: [changeSet(['package.json', 'added', true]).repos[0]!, second] },
      parseUnifiedDiff(''),
      [{ tool: 'edit_file', path: 'C:/other/package.json' }],
    );
    expect(graph.nodes.map((n) => n.id)).toEqual([ref('package.json', 'other'), ref('package.json')]);
    expect(graph.fileCount).toBe(2);
    const other = graph.nodes.find((n) => n.rootId === 'other');
    expect(other).toMatchObject({ status: 'modified', staged: false, tools: ['edit_file'] });
    expect(graph.nodes.find((n) => n.rootId === 'repo')).toMatchObject({ status: 'added', staged: true, tools: [] });
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
    expect(graph.edges).toEqual<ChangeEdge[]>([{ from: ref('src/app/run.ts'), to: ref('src/lib/parser.ts'), weight: 1 }]);
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
    expect(graph.edges).toEqual([{ from: ref('src/app/run.ts'), to: ref('src/lib/parser.ts'), weight: 3 }]);
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
    expect(graph.edges).toEqual([{ from: ref('src/app/run.ts'), to: ref('src/lib/parser.ts'), weight: 1 }]);
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
    expect(graph.edges).toEqual([{ from: ref('src/app/run.ts'), to: ref('src/lib/parser/index.ts'), weight: 1 }]);
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
      { from: ref('src/b/three.ts'), to: ref('src/a/one.ts'), weight: 1 },
      { from: ref('src/b/three.ts'), to: ref('src/a/two.ts'), weight: 1 },
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
      { from: ref('src/a.ts'), to: ref('src/b.ts'), weight: 1 },
      { from: ref('src/b.ts'), to: ref('src/a.ts'), weight: 1 },
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
describe('change-graph refs are knowledge refs (PRD 38 §4.10)', () => {
  it('names a changed file by the knowledge root id the host sent, so the Live lens finds its node', () => {
    const rootId = rootIdFor({ host: 'vscode', repoId: repoIdOfRemote('git@github.com:acme/app.git'), folderId: 'f-unused' });
    const repo = {
      root: ROOT,
      name: 'repo',
      rootId,
      changes: [{ path: `${ROOT}/src/a.ts`, relativePath: 'src/a.ts', repoRoot: ROOT, status: 'modified' as const, staged: false }],
    };
    const graph = buildChangeGraph({ total: 1, repos: [repo] }, parseUnifiedDiff(''), []);
    expect(graph.nodes[0]!.id).toBe(srcRef(rootId, 'src/a.ts'));
    expect(graph.nodes[0]!.rootId).toBe(rootId);
  });
});
