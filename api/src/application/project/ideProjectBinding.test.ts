import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('./projectOwnership', () => ({ loadProjectInTenant: vi.fn() }));

import { loadProjectInTenant } from './projectOwnership';
import { ensureIdeProjectForStorage, toIdeModality } from './ideProjectBinding';

const loadMock = vi.mocked(loadProjectInTenant);

/** selectRows: one result per findBinding call; insertRows: what `.returning()` resolves to. */
function fakeDb(selectRows: unknown[][], insertRows: unknown[]) {
  let call = 0;
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => selectRows[call++] ?? [],
  };
  const insertChain = {
    values: () => insertChain,
    onConflictDoNothing: () => insertChain,
    returning: async () => insertRows,
  };
  return { select: () => selectChain, insert: () => insertChain } as unknown as Db;
}

describe('toIdeModality', () => {
  it('keeps a known modality', () => {
    expect(toIdeModality('webmobile')).toBe('webmobile');
    expect(toIdeModality('evermind')).toBe('evermind');
  });
  it('falls back to designer for unknown/null/undefined', () => {
    expect(toIdeModality('bogus')).toBe('designer');
    expect(toIdeModality(null)).toBe('designer');
    expect(toIdeModality(undefined)).toBe('designer');
  });
});

describe('ensureIdeProjectForStorage', () => {
  beforeEach(() => loadMock.mockReset());

  it('returns the existing row for the same tenant without creating', async () => {
    const db = fakeDb([[{ id: 7, tenantId: 1 }]], []);
    expect(await ensureIdeProjectForStorage(db, 1, 99)).toEqual({ id: 7, created: false });
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('returns null when the row is another tenant\'s and the project is not in tenant', async () => {
    loadMock.mockResolvedValue(null as never);
    const db = fakeDb([[{ id: 7, tenantId: 2 }]], []);
    expect(await ensureIdeProjectForStorage(db, 1, 99)).toBeNull();
  });

  it('creates the row when none exists and the project is in tenant', async () => {
    loadMock.mockResolvedValue({ id: 99, name: 'P', modality: 'mobile', segmentId: null } as never);
    const db = fakeDb([[]], [{ id: 12 }]);
    expect(await ensureIdeProjectForStorage(db, 1, 99)).toEqual({ id: 12, created: true });
  });

  it('re-reads the winner on insert conflict', async () => {
    loadMock.mockResolvedValue({ id: 99, name: 'P', modality: null, segmentId: 3 } as never);
    const db = fakeDb([[], [{ id: 15, tenantId: 1 }]], []);
    expect(await ensureIdeProjectForStorage(db, 1, 99)).toEqual({ id: 15, created: false });
  });
});
