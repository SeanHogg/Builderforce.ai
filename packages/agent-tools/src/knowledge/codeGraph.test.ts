import { describe, expect, it } from 'vitest';
import type { Extracted, KEdge, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { buildCodeGraph } from './codeGraph.js';
import { codeFileNode, rootLevelExtracted } from './codeNodes.js';
import { createCodePack } from './codePack.js';
import { rootSignalsToExtracted } from './codeRootSignals.js';
import { knowledgePacks } from './knowledgePacks.js';

const ROOT = 'r';
const ref = (p: string): NodeRef => `src:${ROOT}::${p}`;

/** A file the per-file parser extracted (it has a real content hash). */
function parsed(path: string, badges: Record<string, number | string> = { language: 'js', symbols: 1 }): Extracted {
  const node = codeFileNode(ROOT, path, { sourceHash: `h:${path}`, badges });
  return { sourceRef: node.ref, sourceHash: `h:${path}`, nodes: [node], edges: [], keys: [] };
}

const imports = (pairs: Array<[string, string]>): Extracted[] => {
  const byFrom = new Map<string, KEdge[]>();
  for (const [from, to] of pairs) {
    byFrom.set(from, [...(byFrom.get(from) ?? []), { from: ref(from), to: ref(to), kind: 'references', weight: 1, origin: 'extracted' }]);
  }
  return [...byFrom].map(([from, edges]) => rootLevelExtracted('t', codeFileNode(ROOT, from), edges));
};

const FILES = ['src/boot.ts', 'src/core.ts', 'src/routes/orders.ts', 'src/db/client.ts', 'src/routes/{id}/x.ts', 'src/misc/index.ts', 'src/misc/util.ts'];
const IMPORTS: Array<[string, string]> = [
  ['src/boot.ts', 'src/core.ts'],
  ['src/boot.ts', 'src/routes/orders.ts'],
  ['src/routes/orders.ts', 'src/db/client.ts'],
  ['src/boot.ts', 'src/misc/index.ts'],
  ['src/misc/index.ts', 'src/misc/util.ts'],
];
const signals = (): Extracted[] => rootSignalsToExtracted({
  coverage: new Map([['src/core.ts', 0.5], ['src/ghost.ts', 1]]),
  churn: new Map([['src/boot.ts', 3], ['src/ignored.ts', 9]]),
  owners: new Map([['src/boot.ts', '@team']]),
  entries: new Set(['src/boot.ts', 'dist/boot.js']),
  skipped: [],
}, ROOT);

const extracted = (): Extracted[] => [
  ...FILES.map((p) => parsed(p, p === 'src/misc/index.ts' ? { language: 'js', symbols: 0 } : { language: 'js', symbols: 1 })),
  ...imports(IMPORTS),
  ...signals(),
];

const build = (list: Extracted[], packs = [createCodePack()]) =>
  buildCodeGraph({ rootId: ROOT, extracted: list, facts: [], relations: [], packs });
const node = (g: ReturnType<typeof build>, p: string) => g.nodes.find((n) => n.ref === ref(p));

describe('buildCodeGraph', () => {
  const g = build(extracted());

  it('places the entry point from its entry badge, and what it imports one layer below', () => {
    expect(node(g, 'src/boot.ts')).toMatchObject({ partition: 'entry', badges: { entry: 1, layerRule: 'name', owner: '@team', churn: 3 } });
    expect(node(g, 'src/core.ts')).toMatchObject({ partition: 'presentation', badges: { layerRule: 'imports', coverage: 0.5 } });
    expect(node(g, 'src/routes/orders.ts')).toMatchObject({ partition: 'presentation', badges: { layerRule: 'folder' } });
  });

  it('gives a path with glob characters its partition (placement is direct, not a pattern)', () => {
    expect(node(g, 'src/routes/{id}/x.ts')).toMatchObject({ partition: 'presentation', badges: { layerRule: 'folder' } });
  });

  it('computes verdicts and findings on the same resolved layers', () => {
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === ref(from) && e.to === ref(to) && e.kind === 'references')!;
    expect(edge('src/boot.ts', 'src/routes/orders.ts').verdict).toBe('allowed');
    expect(edge('src/routes/orders.ts', 'src/db/client.ts').verdict).toBe('skips');
    const violations = g.findings.filter((f) => f.kind === 'partition-violation');
    expect(violations.map((f) => f.params['verdict'])).toEqual(['skips']);
  });

  it('a barrel\'s imports do not place what it re-exports', () => {
    expect(node(g, 'src/misc/util.ts')?.partition).toBeUndefined();
  });

  it('drops signals of files the review never extracted (no parser node), and entries that are not source', () => {
    expect(g.nodes.some((n) => n.ref === ref('src/ghost.ts') || n.ref === ref('src/ignored.ts') || n.ref === ref('dist/boot.js'))).toBe(false);
  });

  it('gives the same partitions however the Extracted arrive, and from either pack construction', () => {
    const partitions = (graph: typeof g) => graph.nodes.map((n) => [n.ref, n.partition, n.badges?.['layerRule']]);
    const shuffled = build([...extracted()].reverse());
    const viaKnowledgePacks = buildCodeGraph({ rootId: ROOT, extracted: extracted(), facts: [], relations: [], packs: knowledgePacks() });
    expect(partitions(shuffled)).toEqual(partitions(g));
    expect(partitions(viaKnowledgePacks)).toEqual(partitions(g));
  });

  it('leaves a project\'s own registry to memory', () => {
    const custom = { partitions: [{ id: 'ui', order: 0, match: ['src/routes/**'] }] };
    const own = build(extracted(), [createCodePack({ partitions: custom })]);
    expect(node(own, 'src/routes/orders.ts')?.partition).toBe('ui');
    expect(node(own, 'src/boot.ts')?.partition).toBeUndefined();
    expect(node(own, 'src/boot.ts')?.badges?.['layerRule']).toBeUndefined();
  });
});
