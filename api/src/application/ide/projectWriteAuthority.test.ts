import { describe, expect, it, vi } from 'vitest';
import { mayWriteProjectFiles } from './projectWriteAuthority';
import { TenantRole } from '../../domain/shared/types';

/** A drizzle-shaped fake: the canvas-link read resolves to `rows`; `select` is spied. */
function fakeDb(rows: unknown[]) {
  const select = vi.fn(() => {
    const b: any = { from: () => b, innerJoin: () => b, where: () => b, limit: () => Promise.resolve(rows) };
    return b;
  });
  return { db: { select } as never, select };
}

describe('mayWriteProjectFiles', () => {
  it('lets developer and above write without consulting any canvas', async () => {
    for (const role of [TenantRole.DEVELOPER, TenantRole.MANAGER, TenantRole.OWNER]) {
      const { db, select } = fakeDb([]);
      expect(await mayWriteProjectFiles(db, 1, 'u1', role, 42)).toBe(true);
      expect(select).not.toHaveBeenCalled();
    }
  });

  it('refuses a viewer or contributor with no editable canvas linked to the project', async () => {
    for (const role of [TenantRole.VIEWER, TenantRole.CONTRIBUTOR]) {
      const { db } = fakeDb([]);
      expect(await mayWriteProjectFiles(db, 1, 'u1', role, 42)).toBe(false);
    }
  });

  it('lets a contributor write the project behind a canvas it edits', async () => {
    const { db } = fakeDb([{ sessionId: 'sess-1' }]);
    expect(await mayWriteProjectFiles(db, 1, 'u1', TenantRole.CONTRIBUTOR, 42)).toBe(true);
  });

  it('fails closed on an unknown role or a caller with no user id', async () => {
    const { db, select } = fakeDb([{ sessionId: 'sess-1' }]);
    expect(await mayWriteProjectFiles(db, 1, 'u1', 'member', 42)).toBe(false);
    expect(await mayWriteProjectFiles(db, 1, null, TenantRole.CONTRIBUTOR, 42)).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});
