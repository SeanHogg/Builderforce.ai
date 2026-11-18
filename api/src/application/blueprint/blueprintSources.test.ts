/**
 * The source list is derived from the detector registry, so these pin the ways it can
 * go wrong: a detector's `reads` entry the reader never fetches, a failed read that
 * aborts detection instead of reading as "file absent", a repo that costs more provider
 * calls than a webhook can spend, and a named path that leaves the repo.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import type { ListFilesResult, ReadFileResult, RepoReadContext } from '../repos/readRepoContents';
import { BLUEPRINT_BROWSE_PAGES, blueprintSourcePaths, FOLLOW_READ_RESERVE, MAX_PROVIDER_CALLS, readBlueprintSources, type BlueprintSourceIo } from './blueprintSources';
import type { FetchLike } from '../repos/sources/RepoSource';
import { DETECTORS } from './detectors';
import { detectDotnet } from './detectors/dotnetDetector';
import { repoRelativePath } from './pathGlob';

const CTX: RepoReadContext = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't', ref: 'abc' };

interface StubOptions {
  /** Paths whose read fails with a provider error. */
  failing?: string[];
  /** Whether the tree listing fails — a provider without listing. */
  treeListingFails?: boolean;
  /** Whether the tree listing is truncated (a repo past the provider's listing limit). */
  treeTruncated?: boolean;
}

function stubIo(repo: Record<string, string>, opts: StubOptions = {}): BlueprintSourceIo & { readCalls: string[]; listCalls: number } {
  const io = {
    readCalls: [] as string[],
    listCalls: 0,
    readRepoFile: async (_ctx: RepoReadContext, path: string): Promise<ReadFileResult> => {
      io.readCalls.push(path);
      if (opts.failing?.includes(path)) return { ok: false, reason: 'provider error' };
      const content = repo[path];
      return content === undefined
        ? { ok: false, reason: `file not found on abc: ${path}` }
        : { ok: true, path, content, truncated: false };
    },
    listRepoTree: async (): Promise<ListFilesResult> => {
      io.listCalls += 1;
      if (opts.treeListingFails) return { ok: false, reason: 'list not implemented' };
      return { ok: true, paths: Object.keys(repo), truncated: opts.treeTruncated === true };
    },
  };
  return io;
}

const sln = (paths: readonly string[]) => paths.map((path, i) => `Project("{X}") = "P${i}", "${path}", "{${i}}"\nEndProject`).join('\n');
const WEB = '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>';
const LIB = '<Project Sdk="Microsoft.NET.Sdk"></Project>';

describe('blueprintSourcePaths', () => {
  it('covers every reads entry of every registered detector', () => {
    const { exact, dirGlobs } = blueprintSourcePaths();
    for (const entry of DETECTORS.flatMap((d) => d.reads)) {
      if (!entry.includes('*')) {
        expect(exact).toContain(entry);
        continue;
      }
      const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
      const sample = entry.slice(entry.lastIndexOf('/') + 1).replace('*', 'sample');
      expect(dirGlobs.some((g) => g.dir === dir && g.test(sample))).toBe(true);
    }
  });

  it('the exact paths alone fit the read budget, with the follow reserve left', () => {
    expect(blueprintSourcePaths().exact.length).toBeLessThan(MAX_PROVIDER_CALLS - FOLLOW_READ_RESERVE);
  });
});

describe('readBlueprintSources', () => {
  it('reads exactly the source files the repo holds, workflows included, from ONE tree listing', async () => {
    const io = stubIo({
      'package.json': '{}',
      '.github/workflows/ci.yml': 'on: push',
      '.github/workflows/deploy.yaml': 'on: push',
      '.github/workflows/README.md': 'not a workflow',
      'src/index.ts': 'export {}',
    });
    const files = await readBlueprintSources(CTX, io);
    expect([...files.keys()].sort()).toEqual(['.github/workflows/ci.yml', '.github/workflows/deploy.yaml', 'package.json']);
    expect(io.readCalls.sort()).toEqual(['.github/workflows/ci.yml', '.github/workflows/deploy.yaml', 'package.json']);
    expect(io.listCalls).toBe(1);
  });

  it('matches globs at the root and through wildcard folders (.NET projects one and two levels down)', async () => {
    const files = await readBlueprintSources(CTX, stubIo({
      'Shop.sln': 'x',
      'src/Api/Api.csproj': '<Project />',
      'tools/Gen.csproj': '<Project />',
      'a/b/c/Deep.csproj': '<Project />',
      'api/Api.csproj': '<Project />',
    }));
    expect([...files.keys()].sort()).toEqual(['Shop.sln', 'api/Api.csproj', 'src/Api/Api.csproj', 'tools/Gen.csproj']);
  });

  it('skips a failed read rather than throwing', async () => {
    const files = await readBlueprintSources(CTX, stubIo({ 'package.json': '{}', 'wrangler.toml': 'name = "x"' }, { failing: ['wrangler.toml'] }));
    expect([...files.keys()]).toEqual(['package.json']);
  });

  it('matches the tree case-insensitively, reading its spelling under the asked-for key', async () => {
    const io = stubIo({ 'Package.JSON': '{}', 'App.sln': sln(['WEB\\Web.csproj']), 'web/Web.csproj': WEB });
    const files = await readBlueprintSources(CTX, io);
    expect(io.readCalls).toEqual(expect.arrayContaining(['Package.JSON', 'web/Web.csproj']));
    expect(files.get('package.json')).toBe('{}');
    expect(detectDotnet(files).services?.[0]).toMatchObject({ id: 'Web', devCommand: 'dotnet run --project WEB/Web.csproj --urls http://0.0.0.0:8080' });
  });

  it('an exact-case path wins over its case twin (Dockerfile beside dockerfile)', async () => {
    const io = stubIo({ dockerfile: 'lower', Dockerfile: 'FROM node' });
    const files = await readBlueprintSources(CTX, io);
    expect(files.get('Dockerfile')).toBe('FROM node');
    expect(io.readCalls).toContain('Dockerfile');
    expect(io.readCalls).not.toContain('dockerfile');
  });

  it('case-twin projects matched by a glob are two files, each read once', async () => {
    const io = stubIo({ 'Api/Api.csproj': WEB, 'api/Api.csproj': LIB });
    const files = await readBlueprintSources(CTX, io);
    expect(io.readCalls.filter((p) => p.endsWith('.csproj')).sort()).toEqual(['Api/Api.csproj', 'api/Api.csproj']);
    expect(files.get('Api/Api.csproj')).toBe(WEB);
    expect(files.get('api/Api.csproj')).toBe(LIB);
  });

  it('when the tree listing fails, reads every exact path blind (no globs, no second listing)', async () => {
    const io = stubIo({ 'package.json': '{}', '.github/workflows/ci.yml': 'on: push' }, { treeListingFails: true });
    const files = await readBlueprintSources(CTX, io);
    expect(io.readCalls.length).toBe(blueprintSourcePaths().exact.length);
    expect(io.listCalls).toBe(1);
    expect([...files.keys()]).toEqual(['package.json']);
  });

  it(`worst case: one listing plus reads, at most ${MAX_PROVIDER_CALLS} in all, however many files match or are named`, async () => {
    const repo: Record<string, string> = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`p${i}/P${i}.csproj`, LIB]));
    repo['Shop.sln'] = sln(Array.from({ length: 2000 }, (_, i) => `n${i}\\P${i}.csproj`));
    for (const opts of [{}, { treeTruncated: true }] as const) {
      const io = stubIo(repo, opts);
      await readBlueprintSources(CTX, io);
      expect(io.listCalls + io.readCalls.length).toBeLessThanOrEqual(MAX_PROVIDER_CALLS);
    }
  });

  it(`worst case on Bitbucket Server, real io: every call counted (tree pages, /raw, /browse pages) — at most ${MAX_PROVIDER_CALLS}`, async () => {
    const tree = [...Array.from({ length: 2500 }, (_, i) => `p${i}/P${i}.csproj`), 'Shop.sln'];
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      if (url.includes('/files?')) {
        const start = Number(new URL(url).searchParams.get('start') ?? 0);
        // An endless tree: every page says there is another.
        return Response.json({ values: tree.slice(start, start + 1000), isLastPage: false, nextPageStart: start + 1000 });
      }
      // /raw answers an HTML 404 (a proxy), so every read falls back to /browse, whose pages never end.
      if (url.includes('/raw/')) return new Response('<html>404</html>', { status: 404 });
      const start = Number(new URL(url).searchParams.get('start') ?? 0);
      const text = url.includes('Shop.sln') ? sln(Array.from({ length: 2000 }, (_, i) => `n${i}\\P${i}.csproj`)) : LIB;
      return Response.json({ lines: [{ text }], isLastPage: false, nextPageStart: start + 1000 });
    };
    const ctx: RepoReadContext = { provider: 'bitbucket', host: 'git.acme.internal', owner: 'PRJ', repo: 'r', token: 't', ref: 'main', fetch };
    await readBlueprintSources(ctx);
    expect(calls.length).toBeLessThanOrEqual(MAX_PROVIDER_CALLS);
    const browsePerFile = new Map<string, number>();
    for (const url of calls.filter((u) => u.includes('/browse/'))) {
      const file = url.split('?')[0]!;
      browsePerFile.set(file, (browsePerFile.get(file) ?? 0) + 1);
    }
    expect(Math.max(0, ...browsePerFile.values())).toBeLessThanOrEqual(BLUEPRINT_BROWSE_PAGES);
  });

  it.each([
    ['a full tree', {}],
    ['a truncated tree', { treeTruncated: true }],
  ] as const)('regression, %s: a solution naming a project past the glob share still gets it read and detected', async (_name, opts) => {
    const count = MAX_PROVIDER_CALLS + 40;
    const repo: Record<string, string> = Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}/P${i}.csproj`, LIB]));
    const last = `p${count - 1}/P${count - 1}.csproj`;
    repo[last] = WEB;
    repo['Shop.sln'] = sln([last.replace('/', '\\')]);
    const files = await readBlueprintSources(CTX, stubIo(repo, opts));
    expect(files.has(last)).toBe(true);
    expect(detectDotnet(files).services?.[0]).toMatchObject({ id: `P${count - 1}`, devCommand: `dotnet run --project ${last} --urls http://0.0.0.0:8080` });
  });

  it('truncated tree: the follow reads are the first named ones in solution order, never one already tried', async () => {
    const names = Array.from({ length: 300 }, (_, i) => `n${i}/P${i}.csproj`);
    const io = stubIo({ 'Shop.sln': sln(['broken\\Broken.csproj', ...names.map((n) => n.replace('/', '\\'))]), 'broken/Broken.csproj': LIB }, {
      treeTruncated: true, failing: ['broken/Broken.csproj'],
    });
    await readBlueprintSources(CTX, io);
    expect(io.readCalls.filter((p) => p === 'broken/Broken.csproj')).toHaveLength(1);
    const followed = io.readCalls.filter((p) => /^n\d+\//.test(p));
    // The one listing counts too: the follow reads fill what the listing and the first pass left.
    expect(followed.length).toBe(MAX_PROVIDER_CALLS - io.listCalls - (io.readCalls.length - followed.length));
    expect(followed).toEqual(names.slice(0, followed.length));
  });

  it('never reads a solution path that is absolute or leaves the repo (the target deeper than any glob)', async () => {
    const io = stubIo({
      'Shop.sln': sln(['..\\..\\secret\\X.csproj', '/etc/Y.csproj', 'a\\\\b\\Z.csproj', 'C:\\w\\W.csproj', 'deep\\a\\b\\x\\..\\web\\Web.csproj']),
      'deep/a/b/web/Web.csproj': WEB,
    });
    await readBlueprintSources(CTX, io);
    expect(io.readCalls.filter((p) => p.endsWith('.csproj'))).toEqual(['deep/a/b/web/Web.csproj']);
  });

  describe('every followReads result passes the central sanitiser', () => {
    const raw: BlueprintDetector = {
      id: 'raw-follow',
      name: 'Raw follow reads (test)',
      reads: [],
      followReads: () => ['../x', '/etc/x', 'a//b', 'a\\b', 'a/%2e%2e/x', 'a/.../x', 'a/ . /x', 'a/\u0001x', 'src/../web/W.csproj'],
      detect: () => ({}),
    };
    afterEach(() => {
      const at = DETECTORS.indexOf(raw);
      if (at !== -1) DETECTORS.splice(at, 1);
    });

    it('reads only the path that resolves inside the repo', async () => {
      DETECTORS.push(raw);
      const io = stubIo({ 'web/W.csproj': 'x' }, { treeTruncated: true });
      const files = await readBlueprintSources(CTX, io);
      // A truncated tree: the exact paths are read blind; everything else read is a follow read.
      const exact = new Set(blueprintSourcePaths().exact);
      expect(io.readCalls.filter((p) => !exact.has(p))).toEqual(['web/W.csproj']);
      expect(files.get('web/W.csproj')).toBe('x');
    });
  });

  it('repoRelativePath: resolves .. inside the repo; drops absolute, empty, dot-and-space, escaping, \\, % and control-character paths', () => {
    expect(repoRelativePath('src/../web/Web.csproj')).toBe('web/Web.csproj');
    expect(repoRelativePath('api/x.csproj')).toBe('api/x.csproj');
    for (const bad of ['', '/etc/x', '../x', 'a/../../x', 'a//b', './a', 'a/./b', 'C:/x', '..', 'a/.../x', 'a/ . /x', 'a\\b', 'a/%2e%2e/x', 'a/\u0001x', 'a/\u007fx']) {
      expect(repoRelativePath(bad)).toBeNull();
    }
  });

  it('the second pass reads only named files the full tree holds', async () => {
    const io = stubIo({ 'Shop.sln': sln(['gone\\Gone.csproj']) });
    await readBlueprintSources(CTX, io);
    expect(io.readCalls).not.toContain('gone/Gone.csproj');
  });
});
