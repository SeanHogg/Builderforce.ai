import { describe, expect, it, vi } from 'vitest';
import { createRepoReadMemo } from './repoReadMemo';

describe('createRepoReadMemo', () => {
  const ctx = { ref: 'b' } as never;

  it('reads a path once, however many consumers ask (even concurrently)', async () => {
    const read = vi.fn(async (_ctx: unknown, path: string) => ({ ok: true as const, path, content: 'x', truncated: false }));
    const reader = createRepoReadMemo(ctx, read as never);
    const [a, b] = await Promise.all([reader('a.ts'), reader('a.ts')]);
    await reader('a.ts');
    expect(a).toBe(b);
    expect(read).toHaveBeenCalledTimes(1);
    await reader('b.ts');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a new memo reads afresh', async () => {
    const read = vi.fn(async (_ctx: unknown, path: string) => ({ ok: true as const, path, content: 'x', truncated: false }));
    await createRepoReadMemo(ctx, read as never)('a.ts');
    await createRepoReadMemo(ctx, read as never)('a.ts');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
