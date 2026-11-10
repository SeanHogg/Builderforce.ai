import { describe, expect, it } from 'vitest';
import { decodeCoChange, type AnalyzerPort } from '@seanhogg/builderforce-memory/knowledge';
import { rootLevelExtracted, codeFileNode, ROOT_SIGNALS_REF } from './codeNodes.js';
import { readRootSignals, rootSignalsToExtracted, withRootSignals } from './codeRootSignals.js';
import type { HistoryCommit, HistoryPort } from './historyPort.js';
import { memoryKnowledgeFs } from './memoryKnowledgeFs.test-util.js';

const ROOT = 'r';
const coverage = JSON.stringify({
  '/repo/src/a.ts': { statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }, s: { 0: 1, 1: 0 } },
  '/repo/dist/gen.js': { statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 } },
});
const files = () => ({
  files: {
    fs: memoryKnowledgeFs({ '/repo/CODEOWNERS': '* @team\n', '/repo/coverage/coverage-final.json': coverage }),
    rootPath: '/repo',
  },
});
/** A history in which each path was touched by `count` commits of its own, today. */
const history = (counts: Record<string, number>): HistoryPort => ({
  commits: async () => Object.entries(counts).flatMap(([path, n]) =>
    Array.from({ length: n }, () => ({ at: new Date().toISOString(), paths: [path], fileCount: 1 }))),
});
const NO_SKIPS: never[] = [];
const badgesOf = (out: Awaited<ReturnType<AnalyzerPort['analyse']>>) =>
  out.flatMap((e) => e.nodes.map((n) => [n.ref, n.badges]));

describe('readRootSignals', () => {
  it('reads coverage, churn and owners once, and drops files the review does not know', async () => {
    const signals = await readRootSignals({ ...files(), history: history({ 'src/a.ts': 3, 'gone.ts': 9 }) }, ['src/a.ts', 'src/b.ts']);
    expect([...signals.coverage]).toEqual([['src/a.ts', 0.5]]);
    expect([...signals.churn]).toEqual([['src/a.ts', 3]]);
    expect([...signals.owners].sort()).toEqual([['src/a.ts', '@team'], ['src/b.ts', '@team']]);
  });

  it('a failing source is the absence of its badge, never a throw', async () => {
    const failing: HistoryPort = { commits: async () => { throw new Error('git exploded'); } };
    const signals = await readRootSignals({ ...files(), history: failing }, ['src/a.ts']);
    expect(signals.churn.size).toBe(0);
    expect(signals.coverage.size).toBe(1);
  });

  it('reads CODEOWNERS from .github/ before the root', async () => {
    const fs = memoryKnowledgeFs({ '/repo/.github/CODEOWNERS': '* @gh\n', '/repo/CODEOWNERS': '* @root\n' });
    const signals = await readRootSignals({ files: { fs, rootPath: '/repo' } }, ['a.ts']);
    expect(signals.owners.get('a.ts')).toBe('@gh');
  });

  it('keeps only entry points that are code files the review saw', async () => {
    const signals = await readRootSignals({ entryPaths: async () => new Set(['src/a.ts', 'dist/a.js', 'README.md']) }, ['src/a.ts', 'README.md']);
    expect([...signals.entries]).toEqual(['src/a.ts']);
  });

  it('has nothing without sources', async () => {
    const signals = await readRootSignals({}, ['a.ts']);
    expect([signals.coverage.size, signals.churn.size, signals.owners.size, signals.entries.size]).toEqual([0, 0, 0, 0]);
  });
});

describe('rootSignalsToExtracted', () => {
  it('emits ONE root-level Extracted with a node per file that has a signal, sorted, skipping zero churn', () => {
    const out = rootSignalsToExtracted({
      coverage: new Map([['b.ts', 1]]), churn: new Map([['b.ts', 2], ['a.ts', 0]]), owners: new Map([['a.ts', '@x']]),
      entries: new Set(['c.ts']), skipped: NO_SKIPS,
    }, ROOT);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRef).toBe(ROOT_SIGNALS_REF);
    expect(out[0]!.sourceHash.startsWith('~')).toBe(true);
    expect(badgesOf(out)).toEqual([
      ['src:r::a.ts', { owner: '@x' }],
      ['src:r::b.ts', { coverage: 1, churn: 2 }],
      ['src:r::c.ts', { entry: 1 }],
    ]);
  });

  it('emits nothing when no file has a signal', () => {
    expect(rootSignalsToExtracted({ coverage: new Map(), churn: new Map(), owners: new Map(), entries: new Set(), skipped: NO_SKIPS }, ROOT)).toEqual([]);
  });
});

describe('co-change (PRD 38 P4)', () => {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  /** a.ts and b.ts always change together; c.ts changes alone; 200-day-old commits are outside churn but inside co-change. */
  const commits = (): HistoryCommit[] => [
    ...[1, 2, 3, 200, 201].map((n) => ({ at: day(n), paths: ['a.ts', 'b.ts'], fileCount: 2 })),
    ...[4, 5, 6, 7, 8, 9].map((n) => ({ at: day(n), paths: ['c.ts'], fileCount: 1 })),
  ];
  const port = (list: HistoryCommit[]): HistoryPort => ({ commits: async () => list });
  const badgesByPath = async (list: HistoryCommit[] | undefined) => {
    const signals = await readRootSignals(list ? { history: port(list) } : {}, ['a.ts', 'b.ts', 'c.ts']);
    return new Map(rootSignalsToExtracted(signals, ROOT).flatMap((e) => e.nodes.map((n) => [n.ref.slice(`src:${ROOT}::`.length), n.badges ?? {}] as const)));
  };

  it('stamps each file\'s partners as file-node refs, from the same history churn reads', async () => {
    const out = await badgesByPath(commits());
    expect(decodeCoChange(out.get('a.ts')?.coChange).map((p) => [p.ref, p.together, p.ofSelf])).toEqual([['src:r::b.ts', 5, 5]]);
    expect(decodeCoChange(out.get('b.ts')?.coChange).map((p) => p.ref)).toEqual(['src:r::a.ts']);
    expect(out.get('c.ts')).toEqual({ churn: 6 });
    // Churn counts only the last 90 days of the one history read.
    expect(out.get('a.ts')?.churn).toBe(3);
  });

  it('has no coChange badge without history', async () => {
    expect([...(await badgesByPath(undefined)).values()].some((b) => 'coChange' in b)).toBe(false);
  });

  it('excludes bulk commits by their whole-repo fileCount', async () => {
    const bulk = commits().map((c) => (c.paths.length === 2 ? { ...c, fileCount: 51 } : c));
    const out = await badgesByPath(bulk);
    expect(out.get('a.ts')?.coChange).toBeUndefined();
    expect(out.get('a.ts')?.churn).toBe(3);
  });

  it('regression: never writes an empty coChange badge', async () => {
    for (const list of [[], commits().slice(0, 2), commits().map((c) => ({ ...c, fileCount: 99 }))]) {
      for (const badges of (await badgesByPath(list)).values()) {
        if ('coChange' in badges) expect(decodeCoChange(badges.coChange).length).toBeGreaterThan(0);
      }
    }
    const lone = rootSignalsToExtracted({ coverage: new Map(), churn: new Map(), owners: new Map(), entries: new Set(), skipped: NO_SKIPS, history: [] }, ROOT);
    expect(lone).toEqual([]);
  });
});

describe('withRootSignals', () => {
  it('returns the analyzers untouched when there is no source', () => {
    const inner: AnalyzerPort = { analyse: async () => [] };
    expect(withRootSignals(inner, {}, async () => [])).toBe(inner);
    expect(withRootSignals(undefined, {}, async () => [])).toBeUndefined();
  });

  it('reads signals for the review\'s code files only (not docs), as one Extracted after the analyzers\'', async () => {
    const inner: AnalyzerPort = {
      analyse: async () => [rootLevelExtracted('x', codeFileNode(ROOT, 'src/a.ts'), [])],
    };
    const port = withRootSignals(inner, { ...files(), history: history({ 'src/b.ts': 4 }) }, async () => ['src/a.ts', 'src/b.ts', 'README.md'])!;
    const out = await port.analyse(ROOT);
    expect(out).toHaveLength(2);
    expect(badgesOf(out.slice(1))).toEqual([
      ['src:r::src/a.ts', { coverage: 0.5, owner: '@team' }],
      ['src:r::src/b.ts', { churn: 4, owner: '@team' }],
    ]);
  });

  it('does not widen to the analyzers\' files when the review named its own (an ignored file gets no signals)', async () => {
    const inner: AnalyzerPort = {
      analyse: async () => [rootLevelExtracted('x', codeFileNode(ROOT, 'src/ignored.ts'), [])],
    };
    const port = withRootSignals(inner, { ...files(), history: history({ 'src/ignored.ts': 9 }) }, async () => ['src/a.ts'])!;
    const signalNodes = (await port.analyse(ROOT)).slice(1).flatMap((e) => e.nodes.map((n) => n.ref));
    expect(signalNodes).toEqual(['src:r::src/a.ts']);
  });

  it('reports what the coverage reader left out', async () => {
    const stale = memoryKnowledgeFs({
      '/repo/coverage/coverage-final.json': { text: coverage, mtime: 1 },
      '/repo/src/a.ts': { text: 'x', mtime: 5 },
    });
    const seen: unknown[] = [];
    const port = withRootSignals(undefined, { files: { fs: stale, rootPath: '/repo' }, onSkipped: (s) => seen.push(...s) }, async () => ['src/a.ts'])!;
    await port.analyse(ROOT);
    expect(seen).toEqual([{ path: 'src/a.ts', reason: 'stale' }]);
  });
});
