import { describe, expect, it } from 'vitest';
import { buildGraph, type Extracted, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { hashText } from '@seanhogg/builderforce-memory/ingest';
import { analysisToExtracted, repoGraphToExtracted } from './codeExtracted.js';
import { codeAnalyzers } from './codeAnalyzers.js';
import { CODE_LAYERS, codeParser, createCodePack, isCodePath, loadCodePartitions } from './codePack.js';
import { fixtureSnapshot } from './codeFixtures.test-util.js';

const ROOT = 'r';
const ref = (path: string) => `src:${ROOT}::${path}`;
const ctx = { rootId: ROOT, knownKeys: new Map(), resolvePath: () => undefined };
const doc = (path: string, text: string) => ({ id: path, tenantId: 't', content: { kind: 'text' as const, text, mediaType: 'text/plain' } });

/** A layered fixture: the route reaches into infrastructure; the domain climbs to application. */
const FILES: Record<string, string> = {
  'src/routes/orders.ts': "import { query } from '../infrastructure/db.js';\nexport function listOrders() { return query('orders'); }\n",
  'src/infrastructure/db.ts': 'export function query(sql: string) { return sql; }\n',
  'src/domain/order.ts': "import { placeOrder } from '../application/place.js';\nexport interface Order { id: string }\nexport const usePlace = placeOrder;\n",
  'src/application/place.ts': "import type { Order } from '../domain/order.js';\nexport function placeOrder(o: Order) { return o; }\n",
  'src/a.ts': 'export function a() { return 1; }\n',
  'src/b.ts': 'export function b() { return 2; }\n',
  'src/c.ts': 'export function c() { return 3; }\n',
  'src/dead.ts': 'export const dead = 1;\n',
};

/** The repo map's file graph over the layered files (orders→db, domain→application, application→domain). */
const REPO_GRAPH = {
  graph: {
    paths: ['src/routes/orders.ts', 'src/infrastructure/db.ts', 'src/domain/order.ts', 'src/application/place.ts'],
    out: [[[1, 1]], [], [[3, 1]], [[2, 1]]] as Array<Array<[number, number]>>,
  },
};

function parsed(): Extracted[] {
  const parser = codeParser();
  return Object.entries(FILES).map(([path, text]) => parser.extract!(doc(path, text), parser.parse(doc(path, text)), ctx));
}

async function codeGraph(order: 'forward' | 'reverse' = 'forward'): Promise<KnowledgeGraph> {
  const pack = createCodePack({ analyzers: codeAnalyzers({ run: async () => ({ analysis: fixtureSnapshot(), repoGraph: REPO_GRAPH }) }) });
  const extracted = [...parsed(), ...(await pack.analyzers!.analyse(ROOT))];
  return buildGraph({
    rootId: ROOT, packs: [pack], facts: [], relations: [],
    extracted: order === 'forward' ? extracted : [...extracted].reverse().map((e) => ({ ...e, edges: [...e.edges].reverse() })),
  }, { maxNodes: 2000 });
}

describe('code parser', () => {
  it('accepts source code only', () => {
    expect(['a.ts', 'b.py', 'c.go', 'd.rs', 'e.java', 'f.rb'].every(isCodePath)).toBe(true);
    expect(['a.md', 'b.sql', 'c.json', 'd.min.js', 'e.png'].some(isCodePath)).toBe(false);
    expect(codeParser().accepts(doc('src/x.tsx', 'x'))).toBe(true);
    expect(codeParser().accepts(doc('README.md', 'x'))).toBe(false);
  });

  it('extracts a file node with area and badges, and exported symbols as keys (no symbol nodes)', () => {
    const text = FILES['src/routes/orders.ts']!;
    const out = codeParser().extract!(doc('src/routes/orders.ts', text), [], ctx);
    expect(out.nodes).toEqual([{
      ref: ref('src/routes/orders.ts'), kind: 'file', label: 'orders.ts', pack: 'code', area: ref('src/routes'),
      importance: 0, origin: 'extracted', sourceHash: hashText(text), badges: { language: 'js', symbols: 1, exports: 1 },
    }]);
    expect(out.edges).toEqual([]);
    expect(out.keys.map((k) => k.key)).toEqual(['src/routes/orders.ts', 'orders.ts', 'orders', 'listOrders', 'listorders']);
  });

  it('takes definitions from a host symbol source when given one', () => {
    const out = codeParser(() => [{ name: 'Fancy', kind: 'class', line: 1, exported: true }]).extract!(doc('x.ts', ''), [], ctx);
    expect(out.keys.map((k) => k.key)).toContain('Fancy');
  });
});

describe('loadCodePartitions', () => {
  it('defaults to CODE_LAYERS and validates an override given as text or value', () => {
    expect(loadCodePartitions()).toEqual(CODE_LAYERS);
    expect(loadCodePartitions('  ')).toEqual(CODE_LAYERS);
    const custom = { partitions: [{ id: 'ui', order: 0, match: ['ui/**'] }, { id: 'core', order: 1, match: ['core/**'] }], allow: { ui: ['core'] } };
    expect(loadCodePartitions(JSON.stringify(custom))).toEqual(custom);
    expect(loadCodePartitions(custom)).toEqual(custom);
    expect(() => loadCodePartitions('{nope')).toThrow(TypeError);
    expect(() => loadCodePartitions({ partitions: 'x' })).toThrow(TypeError);
  });
});

describe('code pack in buildGraph', () => {
  it('gives a route importing infrastructure a `skips` verdict and a partition-violation finding', async () => {
    const g = await codeGraph();
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === ref(from) && e.to === ref(to) && e.kind === 'references')!;
    expect(edge('src/routes/orders.ts', 'src/infrastructure/db.ts').verdict).toBe('skips');
    expect(edge('src/domain/order.ts', 'src/application/place.ts').verdict).toBe('upward');
    expect(edge('src/application/place.ts', 'src/domain/order.ts').verdict).toBe('allowed');
    const violations = g.findings.filter((f) => f.kind === 'partition-violation');
    expect(violations.map((f) => [f.nodes, f.severity, f.params['verdict'], f.requestKey])).toEqual([
      [[ref('src/application/place.ts'), ref('src/domain/order.ts')], 'error', 'upward', 'knowledgeGraph.fix.partitionViolation'],
      [[ref('src/infrastructure/db.ts'), ref('src/routes/orders.ts')], 'warn', 'skips', 'knowledgeGraph.fix.partitionViolation'],
    ]);
    expect(violations[1]!.params).toMatchObject({ from: 'presentation', to: 'infrastructure' });
  });

  it('end to end: violations, cycle, clone group, unused and unlayered share, deterministically', async () => {
    const g = await codeGraph();
    const kinds = g.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      'clone-group', 'cycle', 'partition-violation', 'partition-violation', 'unpartitioned',
      'unused-dependency', 'unused-export', 'unused-file',
    ]);
    const find = (kind: string) => g.findings.find((f) => f.kind === kind)!;
    const cloneId = fixtureSnapshot().issues.find((i) => i.kind === 'duplicate')!.id;
    expect(find('cycle').nodes).toEqual([ref('src/a.ts'), ref('src/b.ts')]);
    expect(find('clone-group')).toMatchObject({ nodes: [ref('src/a.ts'), ref('src/b.ts')], params: { group: cloneId, members: 2 }, requestKey: 'knowledgeGraph.fix.cloneGroup' });
    expect(find('unused-file')).toMatchObject({ nodes: [ref('src/dead.ts')], params: { count: 1, files: 1 }, requestKey: 'knowledgeGraph.fix.unusedFile' });
    expect(find('unused-export')).toMatchObject({ nodes: [ref('src/b.ts')], params: { count: 2, files: 1 }, requestKey: 'knowledgeGraph.fix.unusedExport' });
    expect(find('unpartitioned').params).toMatchObject({ count: 4, total: 8, share: 50 });

    // The parser's node keeps its content hash; root-level output only adds edges and badges.
    const route = g.nodes.find((n) => n.ref === ref('src/routes/orders.ts'))!;
    expect(route).toMatchObject({ partition: 'presentation', sourceHash: hashText(FILES['src/routes/orders.ts']!) });
    const b = g.nodes.find((n) => n.ref === ref('src/b.ts'))!;
    expect(b.badges).toMatchObject({ language: 'js', unusedExports: 2, cloneGroup: cloneId });
    // dependency-cruiser's circular import is a cycle-flagged `references` edge.
    expect(g.edges.find((e) => e.from === ref('src/a.ts') && e.to === ref('src/b.ts') && e.kind === 'references')).toMatchObject({ cycle: true });

    expect(JSON.stringify(await codeGraph('reverse'))).toBe(JSON.stringify(g));
  });

  it('matches analyzer output: one clone-group finding per jscpd group and one cycle per circular component', async () => {
    const snapshot = fixtureSnapshot();
    const g = buildGraph({
      rootId: ROOT, packs: [createCodePack()], facts: [], relations: [],
      extracted: [...analysisToExtracted(snapshot, ROOT), ...repoGraphToExtracted(REPO_GRAPH, ROOT)],
    });
    expect(g.findings.filter((f) => f.kind === 'clone-group')).toHaveLength(snapshot.issues.filter((i) => i.kind === 'duplicate').length);
    expect(g.findings.filter((f) => f.kind === 'cycle')).toHaveLength(1);
  });
});
