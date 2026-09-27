import { describe, expect, it, vi } from 'vitest';
import { chatChangedFiles } from './chatChangedFiles';
import type { Db } from '../../infrastructure/database/connection';

function dbReturning(rows: Array<{ files: unknown }>) {
  const where = vi.fn().mockResolvedValue(rows);
  return { select: () => ({ from: () => ({ where }) }) } as unknown as Db;
}

describe('chatChangedFiles', () => {
  it('unions the files across the chat deltas, once each', async () => {
    const db = dbReturning([{ files: ['src/a.ts', 'src/b.ts'] }, { files: ['src/b.ts', 'README.md'] }]);
    expect(await chatChangedFiles(db, 7, 42)).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
  });

  it('ignores deltas with no file list and non-string entries', async () => {
    const db = dbReturning([{ files: null }, { files: { not: 'a list' } }, { files: ['x.ts', 3, ''] }]);
    expect(await chatChangedFiles(db, 7, 42)).toEqual(['x.ts']);
  });
});
