/**
 * The source list is derived from the detector registry, so these pin the two ways it
 * can go wrong: a detector's `reads` entry the reader never fetches, and a failed read
 * that aborts detection instead of reading as "file absent".
 */

import { describe, expect, it } from 'vitest';
import type { ListFilesResult, ReadFileResult, RepoReadContext } from '../repos/readRepoContents';
import { blueprintSourcePaths, MAX_FILES_PER_GLOB, readBlueprintSources, type BlueprintSourceIo } from './blueprintSources';
import { DETECTORS } from './detectors';
import { detectDotnet } from './detectors/dotnetDetector';

const CTX: RepoReadContext = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't', ref: 'abc' };

interface StubOptions {
  /** Paths whose read fails with a provider error. */
  failing?: string[];
  /** Whether the whole-tree listing (no subPath) fails — a provider without listing. */
  treeListingFails?: boolean;
}

function stubIo(repo: Record<string, string>, opts: StubOptions = {}): BlueprintSourceIo & { readCalls: string[]; listCalls: Array<string | undefined> } {
  const readCalls: string[] = [];
  const listCalls: Array<string | undefined> = [];
  return {
    readCalls,
    listCalls,
    readRepoFile: async (_ctx, path): Promise<ReadFileResult> => {
      readCalls.push(path);
      if (opts.failing?.includes(path)) return { ok: false, reason: 'provider error' };
      const content = repo[path];
      return content === undefined
        ? { ok: false, reason: `file not found on abc: ${path}` }
        : { ok: true, path, content, truncated: false };
    },
    listRepoFiles: async (_ctx, subPath): Promise<ListFilesResult> => {
      listCalls.push(subPath);
      if (!subPath && opts.treeListingFails) return { ok: false, reason: 'list not implemented' };
      return {
        ok: true,
        paths: Object.keys(repo).filter((p) => !subPath || p.startsWith(`${subPath}/`)),
        truncated: false,
      };
    },
  };
}

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
});

describe('readBlueprintSources', () => {
  it('reads exactly the source files the repo holds, workflows included', async () => {
    const files = await readBlueprintSources(CTX, stubIo({
      'package.json': '{}',
      '.github/workflows/ci.yml': 'on: push',
      '.github/workflows/deploy.yaml': 'on: push',
      '.github/workflows/README.md': 'not a workflow',
      'src/index.ts': 'export {}',
    }));
    expect([...files.keys()].sort()).toEqual(['.github/workflows/ci.yml', '.github/workflows/deploy.yaml', 'package.json']);
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

  it('reads only the files the tree listing shows', async () => {
    const io = stubIo({ 'package.json': '{}', '.github/workflows/ci.yml': 'on: push', 'src/index.ts': 'export {}' });
    const files = await readBlueprintSources(CTX, io);
    expect(io.readCalls.sort()).toEqual(['.github/workflows/ci.yml', 'package.json']);
    expect([...files.keys()].sort()).toEqual(['.github/workflows/ci.yml', 'package.json']);
  });

  it('falls back to reading every source path when the tree listing fails', async () => {
    const io = stubIo({ 'package.json': '{}', '.github/workflows/ci.yml': 'on: push' }, { treeListingFails: true });
    const files = await readBlueprintSources(CTX, io);
    expect(io.readCalls.length).toBe(blueprintSourcePaths().exact.length + 1);
    expect([...files.keys()].sort()).toEqual(['.github/workflows/ci.yml', 'package.json']);
  });

  it('falls back through wildcard folders, listing each folder once for all its globs', async () => {
    const io = stubIo({
      '.github/workflows/ci.yml': 'on: push',
      'api/src/Api/Api.csproj': '<Project />',
      'api/Tools/Gen.csproj': '<Project />',
      'api/Api.sln': 'x',
      'backend/Cargo.toml': '[package]',
    }, { treeListingFails: true });
    const files = await readBlueprintSources(CTX, io);
    expect([...files.keys()].sort()).toEqual(['.github/workflows/ci.yml', 'api/Api.sln', 'api/Tools/Gen.csproj', 'api/src/Api/Api.csproj', 'backend/Cargo.toml']);
    const listed = io.listCalls.filter((dir) => dir !== undefined);
    expect(listed.length).toBe(new Set(listed).size);
    expect(listed).toEqual(expect.arrayContaining(['api', '.github/workflows']));
  });

  it(`reads at most ${MAX_FILES_PER_GLOB} files per glob`, async () => {
    const repo = Object.fromEntries(Array.from({ length: MAX_FILES_PER_GLOB + 5 }, (_, i) => [`p${i}/P${i}.csproj`, '<Project />']));
    const files = await readBlueprintSources(CTX, stubIo(repo));
    expect(files.size).toBe(MAX_FILES_PER_GLOB);
  });

  it('regression: a solution naming a project past the glob cap still gets it read and detected', async () => {
    const count = MAX_FILES_PER_GLOB + 5;
    const repo: Record<string, string> = Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}/P${i}.csproj`, '<Project Sdk="Microsoft.NET.Sdk"></Project>']));
    repo[`p${count - 1}/P${count - 1}.csproj`] = '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>';
    repo['Shop.sln'] = `Project("{X}") = "Web", "p${count - 1}\\P${count - 1}.csproj", "{1}"\nEndProject\n`;
    const files = await readBlueprintSources(CTX, stubIo(repo));
    expect(files.has(`p${count - 1}/P${count - 1}.csproj`)).toBe(true);
    expect(detectDotnet(files).services?.[0]).toMatchObject({ id: `P${count - 1}`, devCommand: `dotnet run --project p${count - 1}/P${count - 1}.csproj --urls http://0.0.0.0:8080` });
  });

  it('the second pass reads only named files the tree holds', async () => {
    const io = stubIo({ 'Shop.sln': 'Project("{X}") = "Gone", "gone\\Gone.csproj", "{1}"\nEndProject\n' });
    await readBlueprintSources(CTX, io);
    expect(io.readCalls).not.toContain('gone/Gone.csproj');
  });
});
