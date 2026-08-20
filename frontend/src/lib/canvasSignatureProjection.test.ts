import { describe, expect, it } from 'vitest';
import { signatureFieldsFrom, signatureSummary } from './canvasSignatureProjection';
import type { SignatureProgress } from './founderOpsApi';

const progress = (over: Partial<SignatureProgress> = {}): SignatureProgress => ({
  requestId: 41,
  subject: 'Employee handbook v3',
  intent: 'acknowledge',
  status: 'sent',
  total: 4,
  agreed: 2,
  settled: 3,
  parties: [
    { name: 'Ada Okafor', email: 'ada@example.com', status: 'acknowledged', decidedAt: '2026-08-11T09:00:00.000Z' },
    { name: 'Bo Lindqvist', email: 'bo@example.com', status: 'acknowledged', decidedAt: '2026-08-14T17:30:00.000Z' },
    { name: 'Cai Moreau', email: 'cai@example.com', status: 'declined', decidedAt: '2026-08-12T08:00:00.000Z' },
    { name: 'Dev Raman', email: 'dev@example.com', status: 'pending', decidedAt: null },
  ],
  ...over,
});

/**
 * The return leg. `canvas_request_signature` wrote "sent" and nothing ever wrote
 * what happened next, so a policy showed who was ASKED and never who answered.
 */
describe('projecting a signature request back onto its card', () => {
  it('writes the roster and the rate for a policy', () => {
    const fields = signatureFieldsFrom('policy', progress());
    expect(fields.signatureState).toBe('sent');
    expect(fields.signatureRequestId).toBe(41);
    expect(fields.roster).toEqual([
      { person: 'Ada Okafor', requiredBy: 'ada@example.com', status: 'acknowledged', acknowledgedAt: '2026-08-11' },
      { person: 'Bo Lindqvist', requiredBy: 'bo@example.com', status: 'acknowledged', acknowledgedAt: '2026-08-14' },
      { person: 'Cai Moreau', requiredBy: 'cai@example.com', status: 'declined', acknowledgedAt: '2026-08-12' },
      { person: 'Dev Raman', requiredBy: 'dev@example.com', status: 'pending', acknowledgedAt: '' },
    ]);
  });

  it('counts AGREED over total, never settled over total', () => {
    // Somebody who declined has answered and has NOT acknowledged. Counting them as
    // progress is the one arithmetic error this meter must not make: 2 of 4 = 50%,
    // not 3 of 4.
    expect(signatureFieldsFrom('policy', progress()).acknowledgementRate).toBe(50);
  });

  it('reads 0 rather than dividing by nothing on a request with no parties', () => {
    const fields = signatureFieldsFrom('policy', progress({ total: 0, agreed: 0, settled: 0, parties: [] }));
    expect(fields.acknowledgementRate).toBe(0);
    expect(fields.roster).toEqual([]);
  });

  it('gives a contract the state and the date and no meter it does not need', () => {
    const fields = signatureFieldsFrom('contract', progress({ intent: 'sign' }));
    expect(fields.signatureState).toBe('sent');
    expect(fields).not.toHaveProperty('roster');
    expect(fields).not.toHaveProperty('acknowledgementRate');
  });

  it('sets signedAt only on completion, and to the LAST decision', () => {
    // One person agreeing is not the document being agreed, so the first decision
    // is the wrong date — and an incomplete request has no date at all.
    expect(signatureFieldsFrom('contract', progress()).signedAt).toBe('');
    expect(signatureFieldsFrom('contract', progress({ status: 'completed' })).signedAt)
      .toBe('2026-08-14T17:30:00.000Z');
  });

  it('clears a stale date when a request stops being complete', () => {
    // A cancelled or expired request must not keep asserting an agreement.
    for (const status of ['declined', 'expired', 'cancelled'] as const) {
      expect(signatureFieldsFrom('contract', progress({ status })).signedAt, status).toBe('');
    }
  });

  it('leads the summary with what is OUTSTANDING, because that is what somebody acts on', () => {
    const summary = signatureSummary(progress());
    expect(summary).toContain('2 of 4 acknowledged');
    expect(summary).toContain('1 still to answer');
    expect(summary).toContain('1 declined');
  });

  it('says everyone has answered rather than "0 still to answer"', () => {
    const summary = signatureSummary(progress({ settled: 4, agreed: 4, status: 'completed', intent: 'sign' }));
    expect(summary).toContain('everyone has answered');
    expect(summary).toContain('4 of 4 signed');
    expect(summary).not.toContain('still to answer');
  });
});
