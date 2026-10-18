import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { isSuppressed, suppressedEmails } from './suppression';

describe('suppressedEmails', () => {
  it('merges marketing_suppressions and data_suppression_list hits in ONE statement', async () => {
    const db = fakeDb([[
      { k: 'e', v: 'unsub@x.com' },       // marketing_suppressions
      { k: 'e', v: 'erased@x.com' },      // data_suppression_list (email)
    ]]);
    const blocked = await suppressedEmails(db as unknown as Db, 7, ['Unsub@x.com', 'erased@x.com', 'ok@x.com']);
    expect([...blocked].sort()).toEqual(['erased@x.com', 'unsub@x.com']);
    expect(db.calls).toHaveLength(1);
  });

  it('honours a suppressed DOMAIN from the governance register', async () => {
    const db = fakeDb([[{ k: 'd', v: 'blocked.com' }]]);
    const blocked = await suppressedEmails(db as unknown as Db, 7, ['a@blocked.com', 'b@fine.com']);
    expect([...blocked]).toEqual(['a@blocked.com']);
  });

  it('short-circuits an empty list without touching the database', async () => {
    const db = fakeDb();
    expect((await suppressedEmails(db as unknown as Db, 7, [])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it('isSuppressed reflects the shared check', async () => {
    await expect(isSuppressed(fakeDb([[{ k: 'e', v: 'a@x.com' }]]) as unknown as Db, 7, 'A@x.com')).resolves.toBe(true);
    await expect(isSuppressed(fakeDb([[]]) as unknown as Db, 7, 'a@x.com')).resolves.toBe(false);
  });
});
