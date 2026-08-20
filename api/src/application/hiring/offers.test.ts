import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { atsDbStub } from './__fixtures__/atsDbStub';
import { offerLetters } from '../../infrastructure/database/schema/hiring';
import { renderOfferLetter } from '../../domain/hiring/offerLetter';

// The signature engine is mocked, not exercised: the property under test is that an offer
// goes through it EXACTLY ONCE, which is a statement about this module's control flow
// rather than about the engine's own (already tested) behaviour.
vi.mock('../signature/signatureEngine', () => ({
  createSignatureRequest: vi.fn(async () => ({ requestId: 501, status: 'sent', invitations: [] })),
}));
// Acceptance routes through the decision path so the funnel's conversion into `hired`
// equals the number of offers actually accepted. Mocked so this file asserts the
// delegation rather than re-testing the pipeline.
vi.mock('./decisions', () => ({
  recordDecision: vi.fn(async () => ({ decision: { id: 1 }, movedTo: 'hired', movedFrom: 'offer' })),
}));
vi.mock('../activity/activityLog', () => ({
  recordActivity: vi.fn(async () => {}),
  SYSTEM_ACTOR: { type: 'system', ref: null, name: 'System' },
}));

import { createSignatureRequest } from '../signature/signatureEngine';
import { recordDecision } from './decisions';
import { respondToOffer, sendOffer } from './offers';

const engine = vi.mocked(createSignatureRequest);
const decided = vi.mocked(recordDecision);
const ENV = {} as Env;
const NOW = new Date('2026-08-04T00:00:00.000Z');
const ACTOR = { type: 'human' as const, ref: 'user-1', name: 'A Recruiter' };

/** An `offer_letters` row as `readOffer` reads it. */
const offerRow = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  applicationId: 42,
  candidateRef: 'person-1',
  title: 'Staff Engineer',
  baseSalary: '185000.00',
  currency: 'USD',
  equity: '0.25%',
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  status: 'draft',
  expiresAt: new Date('2026-08-20T00:00:00.000Z'),
  sentAt: null,
  respondedAt: null,
  signatureRequestId: null,
  terms: null,
  objectId: null,
  ...overrides,
});

const PARTIES = [{ name: 'Ada Lovelace', email: 'ada@example.com' }];

describe('sendOffer', () => {
  beforeEach(() => { engine.mockClear(); decided.mockClear(); });

  /**
   * ONE signature request. Two would give the candidate two links, one of which binds
   * them to terms nobody is tracking — and would give the platform two answers to "is it
   * signed", which is the defect routing through the engine exists to prevent.
   */
  it('creates exactly one signature request and records its id on the offer', async () => {
    const { db, writes } = atsDbStub({
      rows: [[offerRow()]],
      returning: [[offerRow({ status: 'sent', signatureRequestId: 501, sentAt: NOW })]],
    });

    const sent = await sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: PARTIES, actor: ACTOR }, NOW);

    expect(engine).toHaveBeenCalledTimes(1);
    expect(sent.signature.requestId).toBe(501);
    const marked = writes.find((write) => write.op === 'update' && write.table === offerLetters);
    expect(marked?.payload).toMatchObject({ status: 'sent', signatureRequestId: 501, sentAt: NOW });
  });

  /** The engine freezes `documentBody` verbatim, so what it is handed has to be derived
   *  from the row rather than typed beside it. */
  it('hands the engine the terms rendered from the offer row, and a ref back to it', async () => {
    const { db } = atsDbStub({ rows: [[offerRow()]], returning: [[offerRow({ status: 'sent', signatureRequestId: 501 })]] });
    await sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: PARTIES, actor: ACTOR }, NOW);

    const input = engine.mock.calls[0]?.[2];
    expect(input?.documentRef).toBe('offer_letter:12');
    expect(input?.documentTitle).toBe('Staff Engineer');
    expect(input?.documentBody).toContain('USD 185,000.00');
    expect(input?.documentBody).toContain('0.25%');
    expect(input?.documentBody).toContain('2026-09-01');
    expect(input?.parties).toEqual(PARTIES);
  });

  it('refuses a second send, and does not call the engine again', async () => {
    const { db } = atsDbStub({ rows: [[offerRow({ status: 'sent', signatureRequestId: 501 })]] });
    await expect(sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: PARTIES, actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 409 });
    expect(engine).not.toHaveBeenCalled();
  });

  /** Belt and braces: even with the request id somehow cleared, a status that is not
   *  draft-or-approved is not sendable. */
  it('refuses to send an offer the candidate has already answered', async () => {
    const { db } = atsDbStub({ rows: [[offerRow({ status: 'accepted', signatureRequestId: null })]] });
    await expect(sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: PARTIES, actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 409 });
    expect(engine).not.toHaveBeenCalled();
  });

  it('refuses to send with nobody to send it to', async () => {
    const { db } = atsDbStub({ rows: [[offerRow()]] });
    await expect(sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: [], actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 400 });
    expect(engine).not.toHaveBeenCalled();
  });

  it('404s on an offer that is not this workspace’s', async () => {
    const { db } = atsDbStub({ rows: [[]] });
    await expect(sendOffer(db, ENV, { tenantId: 1, offerId: 12, parties: PARTIES, actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('respondToOffer', () => {
  beforeEach(() => { engine.mockClear(); decided.mockClear(); });

  /** An acceptance IS a hiring decision. Moving the board any other way would let the
   *  funnel's conversion into `hired` drift from the offers actually accepted. */
  it('records an acceptance as a hire decision, which is what moves the pipeline', async () => {
    const { db, writes } = atsDbStub({
      rows: [[offerRow({ status: 'sent', signatureRequestId: 501 })]],
      returning: [[offerRow({ status: 'accepted', respondedAt: NOW, signatureRequestId: 501 })]],
    });

    const result = await respondToOffer(db, ENV, { tenantId: 1, offerId: 12, response: 'accepted', actor: ACTOR }, NOW);

    expect(result.movedTo).toBe('hired');
    expect(decided).toHaveBeenCalledTimes(1);
    expect(decided.mock.calls[0]?.[2]).toMatchObject({ decision: 'hire', applicationId: 42, candidateRef: 'person-1' });
    expect(writes.find((write) => write.op === 'update' && write.table === offerLetters)?.payload)
      .toMatchObject({ status: 'accepted', respondedAt: NOW });
  });

  /**
   * A declined offer is the candidate turning US down. Filing it as `reject` would put a
   * rejection reason against somebody nobody rejected.
   */
  it('records a decline as a hold, never as a rejection of the candidate', async () => {
    const { db } = atsDbStub({
      rows: [[offerRow({ status: 'sent', signatureRequestId: 501 })]],
      returning: [[offerRow({ status: 'declined', respondedAt: NOW })]],
    });
    await respondToOffer(db, ENV, { tenantId: 1, offerId: 12, response: 'declined', actor: ACTOR }, NOW);
    expect(decided.mock.calls[0]?.[2]).toMatchObject({ decision: 'hold' });
  });

  it('refuses an answer to an offer that is not out', async () => {
    const { db } = atsDbStub({ rows: [[offerRow({ status: 'draft' })]] });
    await expect(respondToOffer(db, ENV, { tenantId: 1, offerId: 12, response: 'accepted', actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 409 });
    expect(decided).not.toHaveBeenCalled();
  });

  it('refuses an answer that is neither acceptance nor decline', async () => {
    const { db } = atsDbStub({ rows: [[offerRow({ status: 'sent' })]] });
    await expect(respondToOffer(db, ENV, { tenantId: 1, offerId: 12, response: 'maybe', actor: ACTOR }, NOW))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('renderOfferLetter', () => {
  /** The letter is a pure function of the row, so the text and the columns cannot say
   *  different numbers — and the signed one is the enforceable one. */
  it('quotes the row, and states every extra term rather than dropping it', () => {
    const letter = renderOfferLetter({
      title: 'Staff Engineer',
      baseSalary: '185000.00',
      currency: 'usd',
      equity: '0.25%',
      startDate: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      terms: { signingBonus: 'USD 10,000', remote: 'Fully remote' },
    });
    expect(letter).toContain('USD 185,000.00');
    expect(letter).toContain('signingBonus: USD 10,000');
    expect(letter).toContain('remote: Fully remote');
  });

  it('omits what the offer does not state instead of writing a blank line for it', () => {
    const letter = renderOfferLetter({
      title: 'Contractor', baseSalary: null, currency: 'USD', equity: null, startDate: null, expiresAt: null,
    });
    expect(letter).not.toContain('Base salary');
    expect(letter).not.toContain('Equity');
    expect(letter).toContain('Signing below accepts the terms stated above.');
  });
});
