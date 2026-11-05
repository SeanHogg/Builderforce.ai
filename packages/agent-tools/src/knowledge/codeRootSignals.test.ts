import { describe, expect, it } from 'vitest';
import type { AnalyzerPort } from '@seanhogg/builderforce-memory/knowledge';
import { rootLevelExtracted, codeFileNode, ROOT_SIGNALS_REF } from './codeNodes.js';
import { readRootSignals, rootSignalsToExtracted, withRootSignals } from './codeRootSignals.js';
import type { HistoryPort } from './historyPort.js';
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
const history = (counts: Record<string, number>): HistoryPort => ({
  commitsTouching: async () => new Map(Object.entries(counts)),
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
    const failing: HistoryPort = { commitsTouching: async () => { throw new Error('git exploded'); } };
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
