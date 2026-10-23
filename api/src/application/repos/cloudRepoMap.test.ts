import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRepoGraphFromTarball, createCloudRepoSemantic, loadCloudRepoGraph } from './cloudRepoMap';
import { clearRepoGraphL1, repoMapObjectKey } from './repoMapStore';
import { readTarEntries } from './tarStream';

const enc = new TextEncoder();

/** One ustar header block. */
function header(name: string, size: number, flag: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  put(name, 0);
  put('0000644\0', 100);
  put(`${size.toString(8).padStart(11, '0')}\0`, 124);
  put('        ', 148);
  put(flag, 156);
  put('ustar\0', 257);
  put('00', 263);
  return h;
}

function pad(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  out.set(bytes);
  return out;
}

/** A GitHub-shaped tarball: a pax global header, then every entry under `root/`. */
function tarball(files: Record<string, string | Uint8Array>, root = 'o-r-abc1234'): Uint8Array {
  const parts: Uint8Array[] = [];
  const comment = enc.encode('52 comment=0123456789012345678901234567890123456789\n');
  parts.push(header('pax_global_header', comment.length, 'g'), pad(comment));
  parts.push(header(`${root}/`, 0, '5'));
  for (const [path, content] of Object.entries(files)) {
    const body = typeof content === 'string' ? enc.encode(content) : content;
    parts.push(header(`${root}/${path}`, body.length, '0'), pad(body));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Stream `bytes` in small chunks, so the reader's block reassembly is exercised. */
function streamOf(bytes: Uint8Array, chunk = 97): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

const FILES = {
  'src/core/engine.ts': 'export class Engine {\n  start() {\n    return 1;\n  }\n}\n',
  'src/svc/a.ts': "import { Engine } from '../core/engine';\nexport function serviceA() { return new Engine(); }\n",
  'src/svc/b.ts': "import { Engine } from '../core/engine';\nexport function serviceB() { return new Engine(); }\n",
  'node_modules/dep/index.js': 'export function Engine() {}\n',
  'assets/logo.ts': new Uint8Array([1, 0, 2, 3]),
  'README.md': '# Engine\n',
};

describe('readTarEntries', () => {
  it('yields ustar entries across chunk boundaries and skips unread bodies', async () => {
    const seen: string[] = [];
    for await (const e of readTarEntries(streamOf(tarball({ 'a.txt': 'hello', 'b.txt': 'world' })))) {
      if (e.type !== 'file') continue;
      seen.push(e.path);
      if (e.path.endsWith('b.txt')) expect(new TextDecoder().decode(await e.read())).toBe('world');
    }
    expect(seen).toEqual(['o-r-abc1234/a.txt', 'o-r-abc1234/b.txt']);
  });
});

describe('buildRepoGraphFromTarball', () => {
  it('reads source files only, skipping vendored, binary and prose files', async () => {
    const graph = await buildRepoGraphFromTarball(streamOf(gzipSync(tarball(FILES))));
    expect(graph.graph.paths.sort()).toEqual(['src/core/engine.ts', 'src/svc/a.ts', 'src/svc/b.ts']);
    expect(graph.stats.truncated).toBe(false);
  });

  it('stops at the file cap and says so', async () => {
    const graph = await buildRepoGraphFromTarball(streamOf(gzipSync(tarball(FILES))), { maxFileBytes: 1_000, maxFiles: 1, maxTotalBytes: 1_000_000 });
    expect(graph.stats).toMatchObject({ files: 1, truncated: true });
  });
});

describe('loadCloudRepoGraph / createCloudRepoSemantic', () => {
  const SHA = 'a'.repeat(40);
  let store: Map<string, string>;
  const env = () => ({
    UPLOADS: {
      get: vi.fn(async (key: string) => (store.has(key) ? { json: async () => JSON.parse(store.get(key)!) } : null)),
      put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    } as unknown as R2Bucket,
  });
  let tarballCalls = 0;

  beforeEach(() => {
    store = new Map();
    tarballCalls = 0;
    clearRepoGraphL1();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/commits/')) return new Response(SHA, { status: 200 });
      if (String(url).includes('/tarball/')) {
        tarballCalls += 1;
        return new Response(gzipSync(tarball(FILES)), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const repo = (name: string) => ({ provider: 'github', host: null, owner: 'o', repo: name, token: 't', ref: 'main' });

  it('builds once, stores the graph in R2 by commit, and serves later loads from R2', async () => {
    const e = env();
    const first = await loadCloudRepoGraph({ env: e, tenantId: 1, repo: repo('r1') });
    expect(first.ok).toBe(true);
    expect(store.has(repoMapObjectKey({ provider: 'github', host: null, owner: 'o', repo: 'r1', sha: SHA }))).toBe(true);
    clearRepoGraphL1();
    const second = await loadCloudRepoGraph({ env: e, tenantId: 2, repo: repo('r1') });
    expect(second.ok).toBe(true);
    expect(tarballCalls).toBe(1);
  });

  it('renders the map in bf-index format and keyword-searches definitions', async () => {
    const semantic = createCloudRepoSemantic({ env: env(), tenantId: 1, repo: repo('r2') });
    const map = await semantic.repoMap({ maxTokens: 1000 });
    expect(map.ok).toBe(true);
    expect(map.map!.startsWith('src/core/engine.ts\n  1: export class Engine {\n')).toBe(true);
    expect(map.map).toContain(`(map of ${SHA.slice(0, 7)} on the base branch`);
    const hits = await semantic.search('serviceB', { limit: 2 });
    expect(hits.results?.[0]).toMatchObject({ path: 'src/svc/b.ts', startLine: 2, source: 'keyword' });
    expect(tarballCalls).toBe(1);
  });

  it('reports a provider it cannot read as a typed failure, never a throw', async () => {
    const semantic = createCloudRepoSemantic({ env: env(), tenantId: 1, repo: { ...repo('r3'), provider: 'gitlab' } });
    const r = await semantic.repoMap({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('list_files');
  });
});
