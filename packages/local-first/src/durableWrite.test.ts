import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeDurably } from './durableWrite.js';

const TARGET = 'local-first-v1.json';
const BYTES = Uint8Array.of(1, 2, 3, 4);

describe('writeDurably', () => {
  it('records the target and bytes and returns written only after writeAtomic resolves', async () => {
    const seen: { target?: string; bytes?: Uint8Array } = {};
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;

    const pending = writeDurably(TARGET, BYTES, async (target, bytes) => {
      seen.target = target;
      seen.bytes = bytes;
      await gate;
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(seen.target).toBe(TARGET);
    expect(seen.bytes).toBe(BYTES);

    release();
    await expect(pending).resolves.toEqual({ written: true });
    expect(settled).toBe(true);
  });

  it('returns write_failed when writeAtomic rejects and does not throw', async () => {
    const seen: { target?: string; bytes?: Uint8Array } = {};
    const result = await writeDurably(TARGET, BYTES, async (target, bytes) => {
      seen.target = target;
      seen.bytes = bytes;
      return Promise.reject(new Error('rename failed'));
    });

    expect(result).toEqual({ written: false, code: 'write_failed' });
    expect(seen.target).toBe(TARGET);
    expect(seen.bytes).toBe(BYTES);
  });

  it('does not write a partial buffer itself when the atomic writer is omitted', async () => {
    const before = Array.from(BYTES);
    const result = await writeDurably(TARGET, BYTES);
    expect(result).toEqual({ written: false, code: 'write_failed' });
    expect(Array.from(BYTES)).toEqual(before);
  });

  it('does not open a file or write a buffer in this module', () => {
    const source = readFileSync(new URL('./durableWrite.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(source).not.toMatch(/\bwriteFile(Sync)?\s*\(/);
    expect(source).not.toMatch(/\brename(Sync)?\s*\(/);
    expect(source).toMatch(/commitWriteAndEnqueue/);
  });
});
