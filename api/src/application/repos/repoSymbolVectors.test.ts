import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoGraph, RepoGraphBuilder } from '@builderforce/repo-map';
import { MEMORY_EMBEDDING_1024_DIMS } from '../memory/memoryEmbedding';
import { clearRepoVectorsL1, definitionHash, loadRepoSymbolIndex, quantize } from './repoSymbolVectors';
import { fuseDefinitionHits } from './cloudRepoMap';

const doubles = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('../llm/embeddingVendors/registry', () => ({
  dispatchEmbeddingVendor: (params: unknown) => doubles.dispatch(params),
}));

/** A meaning per topic word: billing → axis 0, auth → axis 1, anything else → axis 2. */
function vectorFor(text: string): number[] {
  const v = new Array<number>(MEMORY_EMBEDDING_1024_DIMS).fill(0);
  const t = text.toLowerCase();
  v[t.includes('invoice') || t.includes('billing') ? 0 : t.includes('login') || t.includes('auth') ? 1 : 2] = 1;
  return v;
}

function graphOf(files: Record<string, string>): RepoGraph {
  const b = new RepoGraphBuilder();
  for (const [path, content] of Object.entries(files)) b.addFile(path, content);
  return RepoGraph.fromJSON(b.build());
}

const FILES = {
  'src/billing.ts': 'export function chargeInvoice(id: string) {\n  return id;\n}\n',
  'src/auth.ts': 'export function checkLogin(user: string) {\n  return user;\n}\n',
  'src/util.ts': 'export function padLeft(s: string) {\n  return s;\n}\n',
};

const creds = { CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
const repo = (sha: string) => ({ provider: 'github', host: null, owner: 'o', repo: 'r', sha });

let store: Map<string, string>;
const bucket = () => ({
  get: vi.fn(async (key: string) => (store.has(key) ? { json: async () => JSON.parse(store.get(key)!) } : null)),
  put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
}) as unknown as R2Bucket;

const embeddedTexts = (): string[] => doubles.dispatch.mock.calls.flatMap((c) => (c[0] as { input: string[] }).input);

beforeEach(() => {
  store = new Map();
  clearRepoVectorsL1();
  doubles.dispatch.mockImplementation(async (p: { input: string[] }) => ({
    data: p.input.map((text, index) => ({ index, embedding: vectorFor(text) })),
  }));
});
afterEach(() => doubles.dispatch.mockReset());

describe('loadRepoSymbolIndex', () => {
  it('is null without a Workers AI credential — search stays keyword-only', async () => {
    expect(await loadRepoSymbolIndex({ env: { UPLOADS: bucket() }, repo: repo('a'), graph: graphOf(FILES) })).toBeNull();
    expect(doubles.dispatch).not.toHaveBeenCalled();
  });

  it('ranks definitions by meaning', async () => {
    const index = await loadRepoSymbolIndex({ env: { UPLOADS: bucket(), ...creds }, repo: repo('a'), graph: graphOf(FILES) });
    expect(index?.embedded).toBe(3);
    const hits = await index!.search('where is billing for an invoice', { limit: 1 });
    expect(hits[0]?.symbol.name).toBe('chargeInvoice');
  });

  it('embeds a definition once: a cold isolate reuses the stored vectors', async () => {
    const env = { UPLOADS: bucket(), ...creds };
    await loadRepoSymbolIndex({ env, repo: repo('a'), graph: graphOf(FILES) });
    const first = embeddedTexts().length;
    clearRepoVectorsL1();
    await loadRepoSymbolIndex({ env, repo: repo('a'), graph: graphOf(FILES) });
    expect(embeddedTexts()).toHaveLength(first);
  });

  it('a new commit re-embeds only the definitions it changed', async () => {
    const env = { UPLOADS: bucket(), ...creds };
    await loadRepoSymbolIndex({ env, repo: repo('a'), graph: graphOf(FILES) });
    doubles.dispatch.mockClear();
    const changed = { ...FILES, 'src/util.ts': 'export function padRight(s: string) {\n  return s;\n}\n' };
    const index = await loadRepoSymbolIndex({ env, repo: repo('b'), graph: graphOf(changed) });
    expect(embeddedTexts()).toEqual(['src/util.ts\nexport function padRight(s: string) {']);
    expect(index?.embedded).toBe(3);
  });

  it('is null when nothing could be embedded (vendor down) — search falls back to keyword', async () => {
    doubles.dispatch.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadRepoSymbolIndex({ env: { UPLOADS: bucket(), ...creds }, repo: repo('a'), graph: graphOf(FILES) })).toBeNull();
  });
});

describe('definition vectors', () => {
  it('quantises to unit length × 127', () => {
    expect(Array.from(quantize([3, 4]))).toEqual([76, 102]);
  });

  it('hashes by text, so an unchanged definition keeps its id across commits', () => {
    expect(definitionHash('a\nb')).toBe(definitionHash('a\nb'));
    expect(definitionHash('a\nb')).not.toBe(definitionHash('a\nc'));
  });
});

describe('fuseDefinitionHits', () => {
  const kw = (path: string, symbol: string) => ({ path, line: 1, symbol, signature: `function ${symbol}` });
  const dn = (path: string, name: string, score: number) => ({ symbol: { path, line: 1, name, signature: `function ${name}` }, score });

  it('returns the keyword order unchanged when there is no dense arm', () => {
    const out = fuseDefinitionHits([kw('a.ts', 'a'), kw('b.ts', 'b')], []);
    expect(out.map((h) => [h.symbol, h.source, h.score])).toEqual([['a', 'keyword', undefined], ['b', 'keyword', undefined]]);
  });

  it('marks a definition both arms found as hybrid and ranks it first', () => {
    const out = fuseDefinitionHits([kw('a.ts', 'a'), kw('b.ts', 'b')], [dn('b.ts', 'b', 0.9), dn('c.ts', 'c', 0.8)]);
    expect(out[0]).toMatchObject({ symbol: 'b', source: 'hybrid' });
    expect(out.find((h) => h.symbol === 'c')?.source).toBe('embedding');
    expect(out.find((h) => h.symbol === 'a')?.source).toBe('keyword');
  });
});
