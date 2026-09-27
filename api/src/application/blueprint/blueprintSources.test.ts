/**
 * The source list is derived from the detector registry, so these pin the two ways it
 * can go wrong: a detector's `reads` entry the reader never fetches, and a failed read
 * that aborts detection instead of reading as "file absent".
 */

import { describe, expect, it } from 'vitest';
import type { ListFilesResult, ReadFileResult, RepoReadContext } from '../repos/readRepoContents';
import { blueprintSourcePaths, readBlueprintSources, type BlueprintSourceIo } from './blueprintSources';
import { DETECTORS } from './detectors';

const CTX: RepoReadContext = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't', ref: 'abc' };

interface StubOptions {
  /** Paths whose read fails with a provider error. */
  failing?: string[];
  /** Whether the whole-tree listing (no subPath) fails — a provider without listing. */
  treeListingFails?: boolean;
}

function stubIo(repo: Record<string, string>, opts: StubOptions = {}): BlueprintSourceIo & { readCalls: string[] } {
  const readCalls: string[] = [];
  return {
    readCalls,
    readRepoFile: async (_ctx, path): Promise<ReadFileResult> => {
      readCalls.push(path);
      if (opts.failing?.includes(path)) return { ok: false, reason: 'provider error' };
      const content = repo[path];
      return content === undefined
        ? { ok: false, reason: `file not found on abc: ${path}` }
        : { ok: true, path, content, truncated: false };
    },
    listRepoFiles: async (_ctx, subPath): Promise<ListFilesResult> => {
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
      const dir = entry.slice(0, entry.lastIndexOf('/'));
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
});
