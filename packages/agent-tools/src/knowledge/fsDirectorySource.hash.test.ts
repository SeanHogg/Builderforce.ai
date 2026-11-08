import { describe, expect, it, vi } from 'vitest';
import { createFsDirectorySource, MAX_LISTED_FILES, type KnowledgeFs } from './fsDirectorySource.js';
import { memoryKnowledgeFs, type MemoryFile } from './memoryKnowledgeFs.test-util.js';

async function listed(fs: KnowledgeFs, extra: Partial<Parameters<typeof createFsDirectorySource>[0]> = {}) {
  const source = createFsDirectorySource({ fs, rootPath: '/r', rootId: 'r', title: 'r', ...extra });
  const out: Array<{ path: string; hash: string; size: number }> = [];
  for await (const f of source.list()) out.push(f);
  return out;
}

describe('walk hashing', () => {
  it('keeps every file with its own hash and the sorted listing when stat latencies arrive out of order', async () => {
    const files: Record<string, MemoryFile> = {};
    for (let i = 0; i < 40; i++) files[`/r/d/f${String(i).padStart(2, '0')}.ts`] = `body-${i}`;
    const base = memoryKnowledgeFs(files);
    const fs: KnowledgeFs = {
      ...base,
      // Later files answer first.
      stat: async (path) => { await new Promise((resolve) => setTimeout(resolve, 40 - Number(/f(\d+)\.ts$/.exec(path)![1]))); return base.stat(path); },
    };
    const out = await listed(fs, { hash: (bytes) => new TextDecoder().decode(bytes) });
    expect(out.map((f) => f.path)).toEqual(Object.keys(files).map((p) => p.slice(3)));
    expect(out.map((f) => f.hash)).toEqual(out.map((f, i) => `body-${i}`));
  });

  it('stops at exactly the cap and does not start hashing past it', async () => {
    const files: Record<string, MemoryFile> = {};
    // A cap that is not a multiple of the batch size, across two folders, so the cap lands mid-batch.
    for (let i = 0; i < 30; i++) files[`/r/a/f${String(i).padStart(3, '0')}.ts`] = 'x';
    for (let i = 0; i < 30; i++) files[`/r/b/f${String(i).padStart(3, '0')}.ts`] = 'x';
    const base = memoryKnowledgeFs(files);
    const read = vi.fn(base.readFile);
    const out = await listed({ ...base, readFile: read }, { maxListed: 37 });
    expect(out).toHaveLength(37);
    expect(read).toHaveBeenCalledTimes(37);
  });

  it('defaults the cap to MAX_LISTED_FILES', () => {
    expect(MAX_LISTED_FILES).toBe(20_000);
  });

  it('never reads a file above skipHashAbove: size only, with a hash no other file can equal', async () => {
    const base = memoryKnowledgeFs({ '/r/big.bin.ts': { text: 'x', size: 5_000 }, '/r/small.ts': 'y', '/r/big2.ts': { text: 'x', size: 5_000 } });
    const read = vi.fn(base.readFile);
    const out = await listed({ ...base, readFile: read }, { skipHashAbove: 1_000 });
    expect(read).toHaveBeenCalledTimes(1);
    const big = out.filter((f) => f.size === 5_000);
    expect(big).toHaveLength(2);
    expect(new Set(big.map((f) => f.hash)).size).toBe(2);
  });
});
