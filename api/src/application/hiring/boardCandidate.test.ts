/**
 * Who a board applicant IS, and the rule that an erased person is never re-admitted —
 * whichever application, board id or spelling of the same person arrives next.
 */
import { describe, expect, it, vi } from 'vitest';
import { admitBoardCandidate, boardCandidateRefs, fitPartyRef } from './boardCandidate';

/** A db whose `select` answers from a queue and whose `insert` records what it was given. */
function fakeDb(erasedAnswers: boolean[]) {
  const inserts: unknown[] = [];
  const asked: unknown[] = [];
  const answers = [...erasedAnswers];
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async () => { asked.push(condition); return answers.shift() ? [{ id: 1 }] : []; },
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => { inserts.push(values); return { onConflictDoNothing: vi.fn(async () => undefined) }; },
    }),
  };
  return { db: db as never, inserts, asked };
}

const person = (applicationId: string, over: Record<string, unknown> = {}) => ({
  tenantId: 1, boardKey: 'workable', applicationId, candidateId: 'cand-1', name: 'Ada', email: 'ada@example.test', ...over,
});

describe('the candidate ref identifies the PERSON', () => {
  it('is the same for two applications by one email, whatever the application or board person id', async () => {
    const a = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', candidateId: 'c1', email: ' Ada@Example.test ' });
    const b = await boardCandidateRefs({ boardKey: 'lever-postings', applicationId: 'app-2', candidateId: 'zzz', email: 'ada@example.test' });
    expect(a.primary).toBe(b.primary);
    expect(a.primary).toMatch(/^[a-f0-9]{64}$/); // `email:<sha256>` is 70 chars, so it is hashed, not sliced
  });

  it('falls back to the board person id, then to the application id', async () => {
    const byPerson = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', candidateId: 'c1' });
    expect(byPerson.primary).toBe('workable-cand-c1');
    const byApplication = await boardCandidateRefs({ boardKey: 'workable', applicationId: '99' });
    expect(byApplication.primary).toBe('workable-app-99');
    expect(byPerson.all).toEqual(['workable-cand-c1', 'workable-app-app-1']);
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

describe('admitBoardCandidate', () => {
  it('registers a new person as a candidate, with no lawful basis asserted', async () => {
    const { db, inserts } = fakeDb([false]);
    const result = await admitBoardCandidate(db, person('app-1'));
    expect(result.admitted).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ tenantId: 1, partyKind: 'person', role: 'candidate', status: 'active', partyRef: result.candidateRef });
    expect(inserts[0]).not.toHaveProperty('consentBasis');
  });

  it('does not re-admit an erased person — the second application by the same email writes nothing', async () => {
    const first = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-1', candidateId: 'c1', email: 'ada@example.test' });
    const second = await boardCandidateRefs({ boardKey: 'workable', applicationId: 'app-2', candidateId: 'c1', email: 'ada@example.test' });
    expect(second.primary).toBe(first.primary); // the same role — the one erasure marked

    const { db, inserts } = fakeDb([true]); // the erased-role check finds the marked role
    const result = await admitBoardCandidate(db, person('app-2', { candidateId: 'c1' }));
    expect(result).toMatchObject({ admitted: false, candidateRef: second.primary });
    expect(inserts).toHaveLength(0);
  });

  it('checks EVERY ref the person could be under in one lookup', async () => {
    const { db, asked } = fakeDb([false]);
    await admitBoardCandidate(db, person('app-3'));
    expect(asked).toHaveLength(1); // one `inArray` over email, person-id and application refs
  });
});
