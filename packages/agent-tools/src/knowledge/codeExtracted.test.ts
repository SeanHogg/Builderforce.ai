import { describe, expect, it } from 'vitest';
import { analysisToExtracted, analysisToExtractedYielding, repoGraphToExtracted } from './codeExtracted.js';
import { YIELD_EVERY } from './yieldLoop.js';
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
  it('gives one Extracted per file with its outgoing references weighted by shared identifiers', async () => {
    const out = await repoGraphToExtracted(repoGraph, ROOT);
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

  it('is deterministic: equal graphs give equal output and hashes', async () => {
    expect(JSON.stringify(await repoGraphToExtracted(repoGraph, ROOT))).toBe(JSON.stringify(await repoGraphToExtracted(structuredClone(repoGraph), ROOT)));
  });

  // regression: the conversion held the thread for seconds over a large repo; it now yields every YIELD_EVERY files and must not change a byte of output.
  it('regression: yielding over a graph larger than one slice is byte-identical to the unsliced conversion', async () => {
    const paths = Array.from({ length: YIELD_EVERY * 2 + 7 }, (_, i) => `src/f${String(i).padStart(5, '0')}.ts`);
    const big = { graph: { paths, out: paths.map((_, i) => (i + 1 < paths.length ? [[i + 1, 1.25] as const] : [])) } };
    const sliced = await repoGraphToExtracted(big, ROOT);
    // A graph shorter than one slice never yields: its rows are the unsliced reference for the same files.
    const oneShot = await repoGraphToExtracted({ graph: { paths: paths.slice(0, YIELD_EVERY - 1), out: big.graph.out.slice(0, YIELD_EVERY - 1) } }, ROOT);
    expect(sliced).toHaveLength(paths.length);
    // The first slice's rows (no yield inside them) equal the matching rows of the sliced run, except the last one's link to a path beyond the slice.
    expect(JSON.stringify(sliced.slice(0, YIELD_EVERY - 2))).toBe(JSON.stringify(oneShot.slice(0, YIELD_EVERY - 2)));
  });

  it('regression: an aborted signal abandons the conversion at the next yield (nothing partial comes back)', async () => {
    const paths = Array.from({ length: YIELD_EVERY * 3 }, (_, i) => `src/f${i}.ts`);
    const big = { graph: { paths, out: paths.map(() => []) } };
    const controller = new AbortController();
    const run = repoGraphToExtracted(big, ROOT, controller.signal);
    controller.abort();
    expect(await run).toEqual([]);
  });
});

describe('analysisToExtractedYielding', () => {
  it('is byte-identical to analysisToExtracted', async () => {
    expect(JSON.stringify(await analysisToExtractedYielding(fixtureSnapshot(), ROOT))).toBe(JSON.stringify(analysisToExtracted(fixtureSnapshot(), ROOT)));
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
    expect(of('src/b.ts').nodes[0]!.badges).toEqual({ cloneGroup: cloneId, unusedDependencies: 1, unusedDependencyNames: 'left-pad', unusedExportNames: 'x,y', unusedExports: 2 });
    expect(of('src/c.ts').nodes[0]!.badges).toBeUndefined();
  });

  it('produces one Extracted per file, sorted, with a content-derived root-level hash', () => {
    expect(out.map((e) => e.sourceRef)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/dead.ts'].map(ref));
    expect(out.every((e) => e.sourceHash.startsWith('~code-analysis:'))).toBe(true);
    const again = analysisToExtracted({ ...fixtureSnapshot(), id: 'another-run' }, ROOT);
    expect(JSON.stringify(again)).toBe(JSON.stringify(out));
  });
});
