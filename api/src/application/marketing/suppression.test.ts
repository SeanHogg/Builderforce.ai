import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { isDoNotContact, suppressedEmails, suppressionKey } from './suppression';

describe('isDoNotContact', () => {
  it('checks the PARSED, lower-cased address of a mailbox value', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(isDoNotContact(db as unknown as Db, 7, 'Jane Doe <Erased@X.com>')).resolves.toBe(true);
    expect(JSON.stringify(db.calls)).toContain('erased@x.com');
    expect(JSON.stringify(db.calls)).not.toContain('Jane');
  });

  it('is false for a clean address and for a value that holds no address, without a statement for the latter', async () => {
    await expect(isDoNotContact(fakeDb([[]]) as unknown as Db, 7, 'ok@x.com')).resolves.toBe(false);
    const idle = fakeDb();
    await expect(isDoNotContact(idle as unknown as Db, 7, '@handle')).resolves.toBe(false);
    expect(idle.calls).toHaveLength(0);
  });

  it('catches a suppressed address anywhere in a multi-address `to`, in ONE statement', async () => {
    // A single suppressionKey() on the whole list is null and would wave this through.
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(isDoNotContact(db as unknown as Db, 7, 'ok@y.com, "Doe, Jane" <Erased@X.com>; other@z.com')).resolves.toBe(true);
    expect(db.calls).toHaveLength(1);
    const dumped = JSON.stringify(db.calls);
    expect(dumped).toContain('ok@y.com');
    expect(dumped).toContain('erased@x.com');
    expect(dumped).toContain('other@z.com');
  });
});

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

  it('checks the PARSED address: a display-name mailbox value matches the list', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    const blocked = await suppressedEmails(db as unknown as Db, 7, ['Jane Doe <Erased@X.com>']);
    expect([...blocked]).toEqual(['erased@x.com']);
    expect(JSON.stringify(db.calls)).toContain('erased@x.com');
    expect(JSON.stringify(db.calls)).not.toContain('Jane');
  });

  it('checks an E.164 number against the register and never queries a social handle', async () => {
    const db = fakeDb([[{ k: 'e', v: '+14155551234' }]]);
    const blocked = await suppressedEmails(db as unknown as Db, 7, ['+14155551234', '@somebody', 'crm-id-9']);
    expect([...blocked]).toEqual(['+14155551234']);
    expect(JSON.stringify(db.calls)).toContain('phone_e164');
    expect(JSON.stringify(db.calls)).not.toContain('somebody');
    // Nothing queryable at all → no statement.
    const idle = fakeDb();
    expect((await suppressedEmails(idle as unknown as Db, 7, ['@somebody'])).size).toBe(0);
    expect(idle.calls).toHaveLength(0);
  });

  it('compares identifier_type case-insensitively', async () => {
    const db = fakeDb([[]]);
    await suppressedEmails(db as unknown as Db, 7, ['a@x.com']);
    const dumped = JSON.stringify(db.calls);
    expect(dumped).toContain('LOWER(identifier_type)');
  });
});

describe('suppressionKey', () => {
  it('is the lower-cased bare address, or the number, or null', () => {
    expect(suppressionKey(' Jane <A@X.com> ')).toBe('a@x.com');
    expect(suppressionKey('a@x.com')).toBe('a@x.com');
    expect(suppressionKey('+14155551234')).toBe('+14155551234');
    expect(suppressionKey('@handle')).toBeNull();
    expect(suppressionKey('')).toBeNull();
  });

  it('keys a spoofed display name on the REAL address, not the decoy inside the quotes', () => {
    expect(suppressionKey('"<victim@x.com>" <Attacker@y.com>')).toBe('attacker@y.com');
  });

  it('keys on the real address when a quoted decoy FOLLOWS it, so a suppressed address cannot slip past', () => {
    expect(suppressionKey('Eve <A@x.com> "<victim@y.com>"')).toBe('a@x.com');
  });

  it('keys an address followed by an RFC comment, so a do-not-contact entry still matches', () => {
    expect(suppressionKey('<a@x.com> (comment)')).toBe('a@x.com');
    expect(suppressionKey('Jane <Erased@x.com> (Sales)')).toBe('erased@x.com');
  });
});
