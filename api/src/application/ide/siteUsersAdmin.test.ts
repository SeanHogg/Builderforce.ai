import { describe, expect, it } from 'vitest';
import { deleteSiteUser, listSiteUsers, setSiteUserStatus } from './siteUsersAdmin';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const user = { id: 5, email: 'sam@example.com', displayName: null, status: 'suspended', lastSeenAt: null, createdAt: new Date('2026-09-01') };

describe('setSiteUserStatus', () => {
  it('suspending also ends the user\'s sessions', async () => {
    const db = fakeDb([[user], []]);
    expect(await setSiteUserStatus(asDb(db), 7, 2, 5, 'suspended')).toEqual(user);
    expect(db.calls.map((c) => c.kind)).toEqual(['update', 'delete']);
    expect(db.calls[0]!.payload).toMatchObject({ status: 'suspended' });
  });

  it('reinstating leaves sessions alone', async () => {
    const db = fakeDb([[{ ...user, status: 'active' }]]);
    await setSiteUserStatus(asDb(db), 7, 2, 5, 'active');
    expect(db.calls.map((c) => c.kind)).toEqual(['update']);
  });

  it('is null for a user who is not on this site', async () => {
    const db = fakeDb([[]]);
    expect(await setSiteUserStatus(asDb(db), 7, 2, 5, 'suspended')).toBeNull();
    expect(db.calls.map((c) => c.kind)).toEqual(['update']);
  });
});

describe('listSiteUsers / deleteSiteUser', () => {
  it('pages newest first, bounded', async () => {
    const db = fakeDb([[user]]);
    expect(await listSiteUsers(asDb(db), 7, 2, 10_000)).toEqual([user]);
    expect(db.calls[0]!.chain).toEqual(expect.arrayContaining(['orderBy', 'limit']));
  });

  it('reports whether a user was removed', async () => {
    expect(await deleteSiteUser(asDb(fakeDb([[{ id: 5 }]])), 7, 2, 5)).toBe(true);
    expect(await deleteSiteUser(asDb(fakeDb([[]])), 7, 2, 5)).toBe(false);
  });
});
