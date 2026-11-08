import { describe, expect, it } from 'vitest';
import type { DirectorySource, IndexHit, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pinpointImage, scanCorpus, type PinpointDeps } from './pinpoint';

const ROOT = 'web:vfs:1';
const ref = (p: string): string => `src:${ROOT}::${p}`;
const node = (p: string) => ({ ref: ref(p), kind: 'file', label: p, pack: 'code', importance: 0, origin: 'extracted' as const });
const GRAPH = {
  scope: { rootId: ROOT, packs: ['code'], digest: 'd' },
  nodes: [node('src/Review.tsx'), node('src/Panel.tsx')],
  edges: [{ from: ref('src/Panel.tsx'), to: ref('src/Review.tsx'), kind: 'references', weight: 1, origin: 'extracted' as const }],
  findings: [],
  stats: { sources: 2, nodes: 2, edges: 1, stale: 0, truncated: false },
} as unknown as KnowledgeGraph;

const REPLY = JSON.stringify({ description: 'Review stuck on Judging', texts: ['Judging', 'Not here'] });
const PNG = (): Blob => new Blob([new Uint8Array([1])], { type: 'image/png' });

function directory(files: Record<string, string>): DirectorySource {
  return {
    rootId: ROOT, title: 't',
    async *list() { for (const [path, text] of Object.entries(files)) yield { path, hash: 'h', size: text.length }; },
    read: async (path: string) => ({ id: path, tenantId: 't', content: { kind: 'text' as const, text: files[path]! } }),
  } as unknown as DirectorySource;
}

const hit = (id: string, tier: IndexHit['tier']): IndexHit => ({ id, score: 1, tier });

function deps(over: Partial<PinpointDeps>): PinpointDeps {
  return {
    client: { search: async () => [] },
    host: { describe: async () => REPLY },
    directory: async () => null,
    graph: async () => GRAPH,
    ...over,
  };
}

describe('scanCorpus', () => {
  it('finds a literal with its line, bounded per file', () => {
    const corpus = new Map([['a.ts', 'x\n<b>Judging</b>\nJudging again']]);
    expect(scanCorpus(corpus, 'Judging')).toEqual([
      { path: 'a.ts', line: 2, text: '<b>Judging</b>', verified: true },
      { path: 'a.ts', line: 3, text: 'Judging again', verified: true },
    ]);
  });
});

describe('pinpointImage', () => {
  it('matches exact literals in the open directory and hops one import', async () => {
    const out = await pinpointImage(deps({
      directory: async () => directory({ 'src/Review.tsx': 'label: Judging', 'src/Panel.tsx': 'import Review' }),
    }), PNG(), ROOT);
    expect(out.description).toBe('Review stuck on Judging');
    expect(out.matches).toEqual([
      { ref: ref('src/Review.tsx'), why: '"Judging" (line 1)', provenance: 'exact' },
      { ref: ref('src/Panel.tsx'), why: 'imports Review.tsx', provenance: 'import' },
    ]);
  });

  it('never scans a pdf/office file as raw text (the page source would hand back the bytes as UTF-8)', async () => {
    let read: string[] = [];
    const dir = directory({ 'src/Review.tsx': 'label: Judging', 'spec.docx': 'PK Judging', 'spec.pdf': '%PDF Judging' });
    const spied: DirectorySource = { ...dir, read: async (path: string) => { read = [...read, path]; return dir.read(path); } };
    const out = await pinpointImage(deps({ directory: async () => spied }), PNG(), ROOT);
    expect(read).toEqual(['src/Review.tsx']);
    expect(out.matches.filter((m) => m.provenance === 'exact').map((m) => m.ref)).toEqual([ref('src/Review.tsx')]);
  });

  it('without an open directory it uses the server search only through a catalog key', async () => {
    const out = await pinpointImage(deps({
      host: { describe: async () => REPLY, catalogKeys: async (t) => (t === 'Judging' ? ['review.judging'] : []) },
      client: { search: async (_root, q) => (q === 'review.judging' ? [hit(ref('src/Review.tsx'), 'lexical')] : [hit(ref('src/Panel.tsx'), 'lexical')]) },
    }), PNG(), ROOT);
    expect(out.matches.map((m) => [m.ref, m.provenance])).toEqual([[ref('src/Review.tsx'), 'catalog'], [ref('src/Panel.tsx'), 'import']]);
  });

  it('does not trust a dense (semantic) server hit for a key', async () => {
    const out = await pinpointImage(deps({
      host: { describe: async () => REPLY, catalogKeys: async () => ['review.judging'] },
      client: { search: async () => [hit(ref('src/Review.tsx'), 'dense')] },
    }), PNG(), ROOT);
    expect(out.matches).toEqual([]);
  });

  it('refuses a file that is not an image, or is too large, before encoding it', async () => {
    await expect(pinpointImage(deps({}), new Blob(['x'], { type: 'text/plain' }), ROOT)).rejects.toThrow(/PNG/);
    const big = { type: 'image/png', size: 9 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(pinpointImage(deps({}), big, ROOT)).rejects.toThrow(/8 MB/);
  });
});
