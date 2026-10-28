import { describe, expect, it } from 'vitest';
import { analysisToExtracted, repoGraphToExtracted } from './codeExtracted.js';
import { fixtureSnapshot } from './codeFixtures.test-util.js';

const ROOT = 'r';
const ref = (path: string) => `src:${ROOT}::${path}`;

/** A tiny `SerializedRepoGraph` as `@builderforce/repo-map` serializes it. */
const repoGraph = {
  version: 1 as const,
  graph: {
    paths: ['src/routes/orders.ts', 'src/db/client.ts', 'src/domain/order.ts'],
    out: [[[1, 2], [2, 0.5]], [[2, 1]], []] as Array<Array<[number, number]>>,
    symbolIn: [] as Array<[number, string, number]>,
  },
  symbols: [],
  stats: { files: 3, bytes: 300, truncated: false },
};

describe('repoGraphToExtracted', () => {
  it('gives one Extracted per file with its outgoing references weighted by shared identifiers', () => {
    const out = repoGraphToExtracted(repoGraph, ROOT);
    expect(out.map((e) => e.sourceRef)).toEqual([ref('src/db/client.ts'), ref('src/domain/order.ts'), ref('src/routes/orders.ts')]);
    const route = out.find((e) => e.sourceRef === ref('src/routes/orders.ts'))!;
    expect(route.edges).toEqual([
      { from: ref('src/routes/orders.ts'), to: ref('src/db/client.ts'), kind: 'references', weight: 2, origin: 'extracted' },
      { from: ref('src/routes/orders.ts'), to: ref('src/domain/order.ts'), kind: 'references', weight: 0.5, origin: 'extracted' },
    ]);
    expect(route.nodes).toEqual([{
      ref: ref('src/routes/orders.ts'), kind: 'file', label: 'orders.ts', pack: 'code',
      area: ref('src/routes'), importance: 0, origin: 'extracted',
    }]);
    expect(route.sourceHash).toMatch(/^~repo-map:[0-9a-f]+$/);
    expect(out.find((e) => e.sourceRef === ref('src/domain/order.ts'))!.edges).toEqual([]);
  });

  it('is deterministic: equal graphs give equal output and hashes', () => {
    expect(JSON.stringify(repoGraphToExtracted(repoGraph, ROOT))).toBe(JSON.stringify(repoGraphToExtracted(structuredClone(repoGraph), ROOT)));
  });
});

describe('analysisToExtracted', () => {
  const out = analysisToExtracted(fixtureSnapshot(), ROOT);
  const of = (path: string) => out.find((e) => e.sourceRef === ref(path))!;
  const cloneId = fixtureSnapshot().issues.find((i) => i.kind === 'duplicate')!.id;

  it('flags dependency-cruiser circular edges as cycles, at weight 0', () => {
    expect(of('src/a.ts').edges).toContainEqual({ from: ref('src/a.ts'), to: ref('src/b.ts'), kind: 'references', weight: 0, origin: 'extracted', cycle: true });
    expect(of('src/b.ts').edges).toContainEqual({ from: ref('src/b.ts'), to: ref('src/a.ts'), kind: 'references', weight: 0, origin: 'extracted', cycle: true });
    expect(of('src/c.ts').edges).toEqual([{ from: ref('src/c.ts'), to: ref('src/b.ts'), kind: 'references', weight: 0, origin: 'extracted' }]);
  });

  it('turns a jscpd clone group into a duplicate edge weighted by lines, with the clone-group badge', () => {
    expect(of('src/a.ts').edges).toContainEqual({ from: ref('src/a.ts'), to: ref('src/b.ts'), kind: 'duplicate', weight: 6, origin: 'extracted' });
    expect(of('src/a.ts').nodes[0]!.badges).toEqual({ cloneGroup: cloneId });
    expect(of('src/b.ts').nodes[0]!.badges).toMatchObject({ cloneGroup: cloneId });
  });

  it('badges knip unused files, exports and dependencies', () => {
    expect(of('src/dead.ts').nodes[0]!.badges).toEqual({ unused: 'file' });
    expect(of('src/b.ts').nodes[0]!.badges).toEqual({ cloneGroup: cloneId, unusedDependencies: 1, unusedExports: 2 });
    expect(of('src/c.ts').nodes[0]!.badges).toBeUndefined();
  });

  it('produces one Extracted per file, sorted, with a content-derived root-level hash', () => {
    expect(out.map((e) => e.sourceRef)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/dead.ts'].map(ref));
    expect(out.every((e) => e.sourceHash.startsWith('~code-analysis:'))).toBe(true);
    const again = analysisToExtracted({ ...fixtureSnapshot(), id: 'another-run' }, ROOT);
    expect(JSON.stringify(again)).toBe(JSON.stringify(out));
  });
});
