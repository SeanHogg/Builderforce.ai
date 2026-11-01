import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { campaignMemberKeys, isDoNotContact, isMemberBlocked, suppressedEmails, suppressionKey } from './suppression';

describe('isDoNotContact', () => {
  it('checks the PARSED, lower-cased address of a mailbox value', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(isDoNotContact(db as unknown as Db, 7, 'Jane Doe <Erased@X.com>')).resolves.toBe(true);
    expect(JSON.stringify(db.calls)).toContain('erased@x.com');
    expect(JSON.stringify(db.calls)).not.toContain('Jane');
  });

  it('is false for a clean address, and FAILS CLOSED (true, without a statement) for a value it cannot read as an address', async () => {
    await expect(isDoNotContact(fakeDb([[]]) as unknown as Db, 7, 'ok@x.com')).resolves.toBe(false);
    const idle = fakeDb();
    await expect(isDoNotContact(idle as unknown as Db, 7, '@handle')).resolves.toBe(true);
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

/**
 * `isDoNotContact` decides whether something may be sent at all, so what it cannot read it refuses:
 * waving through an unparseable entry is a way round the register.
 */
describe('isDoNotContact — fails closed', () => {
  const idle = () => fakeDb();

  it.each([
    ['a display name and a bare address with no angle brackets', 'Jane erased@x.com'],
    ['two bare addresses', 'a@x.com erased@y.com'],
    ['an unterminated angle group holding two addresses', 'Jane <a@x.com, erased@y.com'],
    ['a handle that is no address', '@somebody'],
    ['an unterminated comment that swallows the comma before a second recipient', 'ok@x.com (, erased@y.com'],
    ['text after the angle group', '<ok@x.com> erased@y.com'],
  ])('is true, with no statement, for %s', async (_name, to) => {
    const db = idle();
    await expect(isDoNotContact(db as unknown as Db, 7, to)).resolves.toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it('is true, with no statement, for more than one angle group: the parser takes the last, a mail server need not', async () => {
    const db = idle();
    await expect(isDoNotContact(db as unknown as Db, 7, '<erased@y.com> <a@x.com>')).resolves.toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it('refuses the whole send when ONE entry of a list cannot be read', async () => {
    const db = idle();
    await expect(isDoNotContact(db as unknown as Db, 7, 'ok@y.com, Jane erased@x.com')).resolves.toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it('still reads a leading comment as the address it precedes, and blocks it when listed', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(isDoNotContact(db as unknown as Db, 7, '(c) erased@x.com')).resolves.toBe(true);
    expect(JSON.stringify(db.calls)).toContain('erased@x.com');
  });

  it('is false, and silent, for an empty value, and false for readable addresses that are not listed', async () => {
    const empty = idle();
    await expect(isDoNotContact(empty as unknown as Db, 7, '')).resolves.toBe(false);
    expect(empty.calls).toHaveLength(0);
    await expect(isDoNotContact(fakeDb([[]]) as unknown as Db, 7, 'ok@y.com, Jane <fine@z.com>')).resolves.toBe(false);
  });

  it('suppressedEmails keeps its contract: an entry with no key is never blocked and never queried (the sequence runner passes handles)', async () => {
    const db = fakeDb([[{ k: 'e', v: 'b@y.com' }]]);
    const blocked = await suppressedEmails(db as unknown as Db, 7, ['Jane erased@x.com', '@somebody', '<a@x.com> <b@y.com>']);
    // The multi-group value keys on its LAST group, which is what that function has always done.
    expect([...blocked]).toEqual(['b@y.com']);
    expect(db.calls).toHaveLength(1);
    const dumped = JSON.stringify(db.calls);
    expect(dumped).not.toContain('somebody');
    expect(dumped).not.toContain('Jane');
  });
});

/**
 * One mailbox, many spellings. Each of these names `erased@x.com`, and each must carry that key or
 * an erased person's address, written another way, walks past the register.
 */
describe('suppressionKey — sees through equivalent spellings', () => {
  it.each([
    ['a quoted local part', '"erased"@x.com'],
    ['a quoted local part inside an angle group', 'Jane <"Erased"@X.com>'],
    ['a comment in the local part', 'erased(c)@x.com'],
    ['a comment inside the angle group', '<erased@x.com (c)>'],
    ['a trailing comment', 'erased@x.com (c)'],
    ['a leading comment', '(c) erased@x.com'],
    ['an obsolete source route', '<@a.com:erased@x.com>'],
    ['an obsolete route with several hops', '<@a.com,@b.com:erased@x.com>'],
    ['a trailing dot on the domain', 'erased@x.com.'],
    ['a trailing dot inside the angle group', 'Jane <erased@x.com.>'],
    ['mixed case', 'ERASED@X.COM'],
  ])('%s', (_name, contact) => {
    expect(suppressionKey(contact)).toBe('erased@x.com');
  });

  it('keeps a quoted local part that genuinely needs its quotes, and never reads a comment out of a quoted string', () => {
    // A space makes it no single address; a bracket inside quotes is part of the local part, not a comment.
    expect(suppressionKey('"a b"@x.com')).toBeNull();
    expect(suppressionKey('"a(b"@x.com')).toBe('"a(b"@x.com');
  });

  it('an unterminated comment cannot hide the address in front of it, and the check refuses the entry outright', async () => {
    // The key still reads the address in front, so the register keeps matching it (suppressedEmails)...
    expect(suppressionKey('erased@x.com (never closed')).toBe('erased@x.com');
    // ...but a mail server may read what the comment swallowed as another recipient, so the send check refuses it unqueried.
    const db = fakeDb();
    await expect(isDoNotContact(db as unknown as Db, 7, 'erased@x.com (never closed')).resolves.toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it('blocks an erased address however it is spelled, through the whole check', async () => {
    for (const spelling of ['"erased"@x.com', 'erased(c)@x.com', '<erased@x.com (c)>', '<@a.com:erased@x.com>', 'erased@x.com.']) {
      const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
      await expect(isDoNotContact(db as unknown as Db, 7, spelling)).resolves.toBe(true);
    }
  });
});

describe('campaignMemberKeys / isMemberBlocked', () => {
  const member = { email: 'a@x.com', phone: '+14155551234' };

  it('checks an email campaign on the address only, and an SMS campaign on both the address and the number', () => {
    expect(campaignMemberKeys('email', member)).toEqual(['a@x.com']);
    expect(campaignMemberKeys('sms', member)).toEqual(['a@x.com', '+14155551234']);
    expect(campaignMemberKeys('sms', { email: 'a@x.com', phone: null })).toEqual(['a@x.com', '']);
  });

  it('blocks a member when ANY of its keys is blocked, comparing by suppression key', () => {
    const blocked = new Set(['+14155551234']);
    expect(isMemberBlocked(blocked, campaignMemberKeys('sms', member))).toBe(true);
    expect(isMemberBlocked(blocked, campaignMemberKeys('email', member))).toBe(false);
    expect(isMemberBlocked(new Set(['a@x.com']), ['Jane <A@X.com>'])).toBe(true);
  });
});
