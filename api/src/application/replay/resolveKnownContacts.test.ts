/**
 * THE identity resolver: a visitor becomes a contact only through the identity the
 * site itself sent (`identified_id`, else the `user` tag), matched to the
 * workspace's Sales contacts by id or email. Unmatched identities are counted,
 * never listed; anonymous visitors cost no contact lookup.
 */
import { describe, expect, it } from 'vitest';
import { resolveKnownContacts } from './resolveKnownContacts';

const SCOPE = { tenantId: 7, siteId: '11111111-2222-4333-8444-555555555555' };
const CONTACT_ID = 'cccccccc-dddd-4eee-8fff-000000000001';

/** Each `select` answers the next rows; every chain step returns the chain, and the chain is awaitable. */
function fakeDb(answers: unknown[][]) {
  let i = 0;
  const db = {
    select: () => {
      const rows = answers[i++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
  };
  return { db: db as never, selects: () => i };
}

describe('resolveKnownContacts', () => {
  it('matches identified visitors to contacts by email or id, counts the rest, lists nobody unmatched', async () => {
    const { db } = fakeDb([
      [
        { visitorId: 'v1', identifiedId: 'Ana@Example.com', tags: {} },
        { visitorId: 'v1', identifiedId: 'older@example.com', tags: {} }, // older visit: the newest identity wins
        { visitorId: 'v2', identifiedId: null, tags: { user: CONTACT_ID } },
        { visitorId: 'v3', identifiedId: 'stranger@example.com', tags: {} },
      ],
      [
        { id: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Ana', email: 'ana@example.com' },
        { id: CONTACT_ID, name: 'Bo', email: '' },
      ],
    ]);
    const out = await resolveKnownContacts(undefined, db, SCOPE, ['v1', 'v2', 'v3', 'v4']);
    expect(out.matched).toEqual([
      { contactId: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Ana', email: 'ana@example.com', visitorIds: ['v1'] },
      { contactId: CONTACT_ID, name: 'Bo', email: '', visitorIds: ['v2'] },
    ]);
    expect(out.unmatched).toBe(1);
    expect(out.anonymous).toBe(1);
    expect(JSON.stringify(out)).not.toContain('stranger@example.com');
  });

  it('does not look up contacts when nobody identified, and does nothing for no visitors', async () => {
    const anonymous = fakeDb([[{ visitorId: 'v1', identifiedId: null, tags: {} }]]);
    expect(await resolveKnownContacts(undefined, anonymous.db, SCOPE, ['v1'])).toEqual({ matched: [], unmatched: 0, anonymous: 1 });
    expect(anonymous.selects()).toBe(1);
    const none = fakeDb([]);
    expect(await resolveKnownContacts(undefined, none.db, SCOPE, [])).toEqual({ matched: [], unmatched: 0, anonymous: 0 });
    expect(none.selects()).toBe(0);
  });
});
