import { describe, it, expect, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import {
  COLLAB_SCOPES,
  admitToCollabRoom,
  collabRoomInstance,
  parseCollabRoom,
} from './collabScopes';

vi.mock('../knowledge/documentAccess', () => ({
  canEditAccess: (access: string) => access === 'manager' || access === 'editor',
  documentAccessById: vi.fn(),
}));
vi.mock('../project/projectOwnership', () => ({ projectInTenant: vi.fn() }));

const { documentAccessById } = await import('../knowledge/documentAccess');
const { projectInTenant } = await import('../project/projectOwnership');

const db = {} as Db;
const actor = { tenantId: 7, userId: 'u1', role: TenantRole.DEVELOPER };

describe('parseCollabRoom', () => {
  it('splits on the FIRST colon so an opaque id may contain one', () => {
    expect(parseCollabRoom('knowledge:a:b')).toEqual({ scope: 'knowledge', id: 'a:b' });
  });

  it.each(['', 'knowledge', ':abc', 'knowledge:'])('rejects %o as a room name', (name) => {
    expect(parseCollabRoom(name)).toBeNull();
  });
});

describe('collabRoomInstance', () => {
  /**
   * The reason the prefix exists: `idFromName` is a GLOBAL namespace, so without a
   * tenant in the name a document id that appears in two workspaces — a copy, a
   * restored backup, a shared fixture — would be ONE shared document.
   */
  it('separates two tenants holding the same document id', () => {
    expect(collabRoomInstance(1, 'knowledge', 'doc-1'))
      .not.toBe(collabRoomInstance(2, 'knowledge', 'doc-1'));
  });
});

describe('admitToCollabRoom', () => {
  it('refuses a scope that is not declared, rather than naming an arbitrary DO', async () => {
    // This is the standalone worker's whole vulnerability in one assertion: it named
    // `idFromName(<whatever the caller sent>)` with no registry and no token.
    expect(await admitToCollabRoom(db, 'anything:1', actor)).toEqual({ ok: false, reason: 'unknown-scope' });
  });

  it('admits an editor to a knowledge document, under the tenant-prefixed instance name', async () => {
    vi.mocked(documentAccessById).mockResolvedValue('editor');
    expect(await admitToCollabRoom(db, 'knowledge:doc-1', actor))
      .toEqual({ ok: true, room: 'collab:t7:knowledge:doc-1' });
  });

  it('refuses a VIEWER — there is no read-only membership of a CRDT room', async () => {
    vi.mocked(documentAccessById).mockResolvedValue('viewer');
    expect(await admitToCollabRoom(db, 'knowledge:doc-1', actor)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('reports a document outside the tenant as not-found, not forbidden', async () => {
    vi.mocked(documentAccessById).mockResolvedValue(null);
    expect(await admitToCollabRoom(db, 'knowledge:doc-1', actor)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('admits a project in this tenant and refuses one that is not', async () => {
    vi.mocked(projectInTenant).mockResolvedValue(true);
    expect(await admitToCollabRoom(db, 'project:12', actor)).toEqual({ ok: true, room: 'collab:t7:project:12' });
    vi.mocked(projectInTenant).mockResolvedValue(false);
    expect(await admitToCollabRoom(db, 'project:12', actor)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses a non-numeric project id without reaching the database', async () => {
    vi.mocked(projectInTenant).mockClear();
    expect(await admitToCollabRoom(db, 'project:../admin', actor)).toEqual({ ok: false, reason: 'not-found' });
    expect(projectInTenant).not.toHaveBeenCalled();
  });

  it('declares exactly the scopes the client may ask for', () => {
    expect(COLLAB_SCOPES.sort()).toEqual(['knowledge', 'project']);
  });
});
