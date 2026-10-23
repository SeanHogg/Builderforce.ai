/**
 * `/api/objects/:id/{members,shares}` — the generic kernel relation surface, and the
 * one kind of object whose relations it must not hand out.
 *
 * Since migration 1264 a board's kernel memberships ARE its board-role gate, and a
 * board's share links are invitations INTO it (an `edit` link is redeemed as a board
 * editor). The generic surface only proves the object is in the caller's tenant, so
 * the REGISTRY PORT (`objectRelationGate.ts`) refuses generic writes to a board's
 * members and shares, and admits a generic read only through the board's own grant.
 * These run the real port over a `Db` double, so the gate is exercised where it lives
 * rather than re-implemented in a mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 7);
    c.set('segmentId', 'seg-1');
    c.set('userId', 'user-1');
    await next();
  },
}));

const { createObjectRoutes } = await import('./objectRoutes');
const { createObjectRegistry } = await import('../../application/kernel/ObjectRegistry');

const BOARD = { id: 'obj-board', tenantId: 7, kind: 'creation_session', refId: 'sess-1', domain: 'canvas', title: 'B', parentId: null, archivedAt: null, updatedAt: new Date() };
const DEAL = { ...BOARD, id: 'obj-deal', kind: 'deal', refId: '42', domain: 'revenue' };

/** No KV bound: the registry's read-through cache runs on L1, cleared per test. */
const ENV = {} as Env;
const boardGate = vi.fn();

function appOver(db: FakeDb) {
  const registry = createObjectRegistry(db as unknown as Db, ENV, { creation_session: boardGate });
  return createObjectRoutes(registry);
}
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  boardGate.mockReset();
});

describe('members of a board', () => {
  it('refuses a generic member write — any teammate could otherwise seat themselves owner', async () => {
    const db = fakeDb([[BOARD]]);
    const res = await appOver(db).request('/obj-board/members', post({ memberRef: 'user-1', role: 'owner' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'DOMAIN_GATED_RELATION' });
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(false);
  });

  it('refuses a generic member removal', async () => {
    const db = fakeDb([[BOARD]]);
    const res = await appOver(db).request('/obj-board/members/user/user-9', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(db.calls.some((call) => call.kind === 'update')).toBe(false);
  });

  it('refuses the roster to somebody the board grant does not admit', async () => {
    boardGate.mockResolvedValue(false);
    const outsider = fakeDb([[BOARD]]);
    const refused = await appOver(outsider).request('/obj-board/members');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'DOMAIN_GATED_RELATION' });
    expect(boardGate).toHaveBeenCalledWith({ tenantId: 7, refId: 'sess-1', userId: 'user-1' });
  });

  it('lists the roster for a board member', async () => {
    boardGate.mockResolvedValue(true);
    const member = fakeDb([[BOARD], [{ memberRef: 'user-1', role: 'owner' }]]);
    const listed = await appOver(member).request('/obj-board/members');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([{ memberRef: 'user-1', role: 'owner' }]);
  });
});

describe('shares of a board', () => {
  it('refuses to mint a share — an edit link would be redeemed as a board editor', async () => {
    const db = fakeDb([[BOARD]]);
    const res = await appOver(db).request('/obj-board/shares', post({ scope: 'edit' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'DOMAIN_GATED_RELATION' });
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(false);
  });

  it("refuses to revoke the owner's links through the generic writer", async () => {
    const db = fakeDb([[BOARD]]);
    const res = await appOver(db).request('/obj-board/shares/share-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(db.calls.some((call) => call.kind === 'update')).toBe(false);
  });

  it('lists shares only through the board grant', async () => {
    boardGate.mockResolvedValue(false);
    const res = await appOver(fakeDb([[BOARD]])).request('/obj-board/shares');
    expect(res.status).toBe(403);
  });
});

describe('an ordinary object', () => {
  it('still takes generic member writes', async () => {
    const db = fakeDb([[DEAL], [{ id: 1 }]]);
    const res = await appOver(db).request('/obj-deal/members', post({ memberRef: 'user-2' }));
    expect(res.status).toBe(201);
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(true);
    expect(boardGate).not.toHaveBeenCalled();
  });

  it('still mints shares', async () => {
    const db = fakeDb([[DEAL], [{ id: 'share-1' }]]);
    const res = await appOver(db).request('/obj-deal/shares', post({ scope: 'view' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'share-1' });
  });

  it('404s an object outside the tenant before deciding anything else', async () => {
    const res = await appOver(fakeDb([[]])).request('/obj-x/members', post({ memberRef: 'user-2' }));
    expect(res.status).toBe(404);
  });
});
