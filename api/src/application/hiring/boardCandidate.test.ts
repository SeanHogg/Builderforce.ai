/**
 * Who a board applicant IS, and the rule that an erased person is never re-admitted —
 * whichever application, board id or spelling of the same person arrives next — and that
 * one person is one role however many refs they arrive under.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ALIAS_ROLE,
  admitBoardCandidate,
  boardCandidateRefs,
  fitPartyRef,
  linkedCandidateRefs,
  loadRoleIndex,
  type RoleIndex,
} from './boardCandidate';

const KEY = 'tenant-1-key';

interface Row { partyRef: string; role: string; status: string; attrs?: unknown }

/** A db whose `select … where` answers from queued row lists and whose `insert` records values. */
function fakeDb(selects: Row[][] = []) {
  const inserts: Array<Record<string, unknown>> = [];
  const queue = [...selects];
  const db = {
    select: () => ({ from: () => ({ where: async () => queue.shift() ?? [] }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => { inserts.push(values); return { onConflictDoNothing: vi.fn(async () => undefined) }; },
    }),
  };
  return { db: db as never, inserts, selectsLeft: () => queue.length };
}

const person = (applicationId: string, over: Record<string, unknown> = {}) => ({
  tenantId: 1, boardKey: 'workable', applicationId, candidateId: 'cand-1', name: 'Ada', email: 'ada@example.test', ...over,
});

describe('the candidate ref identifies the PERSON', () => {
  it('is a tenant-keyed HMAC of the email: the same across applications, different per tenant, never a bare hash', async () => {
    const a = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', candidateId: 'c1', email: ' Ada@Example.test ' }, KEY);
    const b = await boardCandidateRefs({ boardKey: 'lever-postings', applicationId: 'app-2', candidateId: 'zzz', email: 'ada@example.test' }, KEY);
    expect(a.primary).toBe(b.primary);
    expect(a.primary).toMatch(/^[a-f0-9]{64}$/);
    const other = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', email: 'ada@example.test' }, 'tenant-2-key');
    expect(other.primary).not.toBe(a.primary); // the same address is a different ref in another tenant
    const bareSha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ada@example.test'))))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(a.primary).not.toBe(bareSha); // an unsalted hash would be a lookup table away from the email
  });

  it('falls back to the board person id, then to the application id', async () => {
    const byPerson = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', candidateId: 'c1' }, KEY);
    expect(byPerson.primary).toBe('workable-cand-c1');
    expect(byPerson.all).toEqual(['workable-cand-c1', 'workable-app-app-1']);
    expect((await boardCandidateRefs({ boardKey: 'workable', applicationId: '99' }, KEY)).primary).toBe('workable-app-99');
  });

  it('hashes an id longer than 64 characters instead of slicing it', async () => {
    const prefix = 'x'.repeat(70);
    const one = await fitPartyRef(`${prefix}-one`);
    const two = await fitPartyRef(`${prefix}-two`);
    expect(one).not.toBe(two); // a slice to 64 would have made them the same candidate
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(await fitPartyRef('short-ref-1')).toBe('short-ref-1');
    expect(await fitPartyRef('Has Spaces')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('admitBoardCandidate — one person, one role', () => {
  it('a new person gets ONE candidate role under their primary ref, and an alias row per other ref', async () => {
    const { db, inserts } = fakeDb([[]]);
    const refs = await boardCandidateRefs(person('app-1'), KEY);
    const result = await admitBoardCandidate(db, person('app-1'), KEY);
    expect(result).toEqual({ admitted: true, candidateRef: refs.primary });
    const candidates = inserts.filter((v) => v.role === 'candidate');
    const aliases = inserts.filter((v) => v.role === ALIAS_ROLE);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ partyRef: refs.primary, partyKind: 'person', status: 'active' });
    expect(candidates[0]).not.toHaveProperty('consentBasis'); // no lawful basis asserted
    expect(aliases.map((v) => v.partyRef).sort()).toEqual(refs.all.filter((r) => r !== refs.primary).sort());
    expect(aliases.every((v) => (v.attrs as { primary: string }).primary === refs.primary)).toBe(true);
  });

  it('a person first admitted under their board id and LATER seen with an email gets ONE role, not two', async () => {
    const early = await boardCandidateRefs(person('app-1', { email: null }), KEY);
    const later = await boardCandidateRefs(person('app-2'), KEY);
    expect(later.all).toContain(early.primary); // the board person-id ref is shared
    expect(later.primary).not.toBe(early.primary); // …but the email ref is new

    // The database holds the role created at the first arrival.
    const { db, inserts } = fakeDb([[{ partyRef: early.primary, role: 'candidate', status: 'active' }]]);
    const result = await admitBoardCandidate(db, person('app-2'), KEY);
    expect(result).toEqual({ admitted: true, candidateRef: early.primary }); // reused, not re-keyed
    expect(inserts.filter((v) => v.role === 'candidate')).toHaveLength(0); // no second role
    const aliases = inserts.filter((v) => v.role === ALIAS_ROLE);
    expect(aliases.length).toBeGreaterThan(0);
    expect(aliases.every((v) => (v.attrs as { primary: string }).primary === early.primary)).toBe(true);
    expect(aliases.map((v) => v.partyRef)).toContain(later.primary); // the new email ref now points at the role
  });

  it('an alias hit resolves to its role, so a later arrival by email alone reuses it', async () => {
    const refs = await boardCandidateRefs(person('app-3', { candidateId: null }), KEY);
    const { db, inserts } = fakeDb([[{ partyRef: refs.primary, role: ALIAS_ROLE, status: 'active', attrs: { primary: 'the-role' } }]]);
    const result = await admitBoardCandidate(db, person('app-3', { candidateId: null }), KEY);
    expect(result.candidateRef).toBe('the-role');
    expect(inserts.filter((v) => v.role === 'candidate')).toHaveLength(0);
  });

  it('erasing the person under ONE ref blocks re-admission under EVERY ref', async () => {
    const refs = await boardCandidateRefs(person('app-9'), KEY);
    expect(refs.all.length).toBeGreaterThan(1);
    // Only the LAST ref (the application ref) carries the erased mark; the person now
    // arrives under all of them, including an email ref no row ever held.
    const index: RoleIndex = new Map([[refs.all.at(-1)!, [{ role: ALIAS_ROLE, status: 'erased', primary: null }]]]);
    const { db, inserts } = fakeDb();
    const result = await admitBoardCandidate(db, person('app-9'), KEY, index);
    expect(result.admitted).toBe(false);
    expect(inserts).toHaveLength(0);
    // …and the same person via a second application (same email, new application id).
    const again = await admitBoardCandidate(db, person('app-10'), KEY, new Map([[refs.primary, [{ role: 'candidate', status: 'erased', primary: null }]]]));
    expect(again.admitted).toBe(false);
  });

  it('with a preloaded page index it asks the database NOTHING, and two applicants who are one person share a role', async () => {
    const { db, inserts, selectsLeft } = fakeDb([[{ partyRef: 'never-read', role: 'candidate', status: 'erased' }]]);
    const index: RoleIndex = new Map();
    const first = await admitBoardCandidate(db, person('app-1'), KEY, index);
    const second = await admitBoardCandidate(db, person('app-2'), KEY, index);
    expect(selectsLeft()).toBe(1); // the queued select was never consumed
    expect(second.candidateRef).toBe(first.candidateRef);
    expect(inserts.filter((v) => v.role === 'candidate')).toHaveLength(1);
  });
});

describe('the page index and the linked refs', () => {
  it('loadRoleIndex is one query for the whole page and keys the alias rows’ primary', async () => {
    const { db, selectsLeft } = fakeDb([[
      { partyRef: 'a', role: 'candidate', status: 'active' },
      { partyRef: 'b', role: ALIAS_ROLE, status: 'active', attrs: { primary: 'a' } },
    ]]);
    const index = await loadRoleIndex(db, 1, ['a', 'b', 'c']);
    expect(selectsLeft()).toBe(0);
    expect(index.get('b')).toEqual([{ role: ALIAS_ROLE, status: 'active', primary: 'a' }]);
    expect(index.get('c')).toBeUndefined();
  });

  it('linkedCandidateRefs: an alias expands to its role and every sibling alias', async () => {
    const { db } = fakeDb([
      [{ partyRef: 'b', role: ALIAS_ROLE, status: 'active', attrs: { primary: 'a' } }], // the ref itself
      [{ partyRef: 'b' }, { partyRef: 'c' }] as never, // aliases that name `a`
    ]);
    expect((await linkedCandidateRefs(db, 1, 'b')).sort()).toEqual(['a', 'b', 'c']);
  });

  it('linkedCandidateRefs: a lone ref is just itself', async () => {
    const { db } = fakeDb([[{ partyRef: 'solo', role: 'candidate', status: 'active' }], []]);
    expect(await linkedCandidateRefs(db, 1, 'solo')).toEqual(['solo']);
  });
});
