import { describe, expect, it } from 'vitest';
import { deleteOwned, patchOwned, requireOwned } from './ownedRecords';
import { statusOf } from '../../domain/shared/errors';
import type { Db } from '../../infrastructure/database/connection';

/** A drizzle-shaped stub whose every terminal resolves to `rows`. */
function stubDb(rows: unknown[]): Db {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'from', 'where', 'update', 'set', 'delete']) chain[k] = () => chain;
  chain.returning = () => Promise.resolve(rows);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
  return chain as unknown as Db;
}

describe('ownedRecords', () => {
  it('404s with the record label when nothing is owned', async () => {
    const err = await requireOwned(stubDb([]), 'devTeam', 1, 2).catch((e) => e);
    expect(err.message).toBe('Team not found');
    expect(statusOf(err)).toBe(404);
    await expect(patchOwned(stubDb([]), 'contributor', 1, 2, {})).rejects.toThrow('Contributor not found');
    await expect(deleteOwned(stubDb([]), 'contributor', 1, 2)).rejects.toThrow('Contributor not found');
  });

  it('returns the updated row when owned', async () => {
    await expect(patchOwned(stubDb([{ id: 2 }]), 'contributor', 1, 2, { name: 'x' })).resolves.toEqual({ id: 2 });
    await expect(requireOwned(stubDb([{ id: 2 }]), 'contributor', 1, 2)).resolves.toBeUndefined();
  });
});
