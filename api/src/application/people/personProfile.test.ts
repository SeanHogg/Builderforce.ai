import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readPersonProfile } from './personProfile';

const member = {
  id: 'u1', displayName: ' Ada ', username: 'ada', email: 'ada@x.io', avatarUrl: 'https://a/b.png',
  psychometric: JSON.stringify({ mbti: 'INTJ', vector: { curiosity: 80 } }), role: 'developer',
};

describe('readPersonProfile', () => {
  it('returns the profile of a same-tenant member, with parsed psychometric and work counts', async () => {
    const db = fakeDb([[member], [{ open: '2', recent: '3', done: '5' }]]);
    const p = await readPersonProfile(db as unknown as Db, 7, 'u1');
    expect(p).toEqual({
      userId: 'u1',
      displayName: 'Ada',
      avatarUrl: 'https://a/b.png',
      roles: ['developer'],
      psychometric: { mbti: 'INTJ', vector: { curiosity: 80 } },
      work: { openAssigned: 2, recentAssigned: 3, completed: 5 },
    });
  });

  it('returns null for a user outside the tenant, without reading their work', async () => {
    const db = fakeDb([[]]);
    expect(await readPersonProfile(db as unknown as Db, 7, 'stranger')).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it('yields null psychometric when none is stored or the JSON is malformed', async () => {
    const none = fakeDb([[{ ...member, psychometric: null }], [{ open: 0, recent: 0, done: 0 }]]);
    expect((await readPersonProfile(none as unknown as Db, 7, 'u1'))!.psychometric).toBeNull();
    const bad = fakeDb([[{ ...member, psychometric: '{nope' }], [{ open: 0, recent: 0, done: 0 }]]);
    expect((await readPersonProfile(bad as unknown as Db, 7, 'u1'))!.psychometric).toBeNull();
  });
});

describe('readPersonProfile open count', () => {
  it('counts only workable statuses, so archived and cancelled tickets are not "open"', async () => {
    const db = fakeDb([[member], [{ open: 1, recent: 1, done: 0 }]]);
    await readPersonProfile(db as unknown as Db, 7, 'u1');
    const workCall = db.calls[1];
    expect(workCall).toBeDefined();
    if (!workCall) return;
    const fields = workCall.args[0] as { open: import('drizzle-orm').SQL };
    const { sql: text, params } = new PgDialect().sqlToQuery(fields.open);
    expect(text).toContain('"status" in');
    expect(params).toEqual(expect.arrayContaining(['backlog', 'todo', 'ready', 'in_progress', 'in_review', 'blocked']));
    expect(params).not.toContain('done');
    expect(params).not.toContain('cancelled');
    expect(params).not.toContain('archived');
  });
});
