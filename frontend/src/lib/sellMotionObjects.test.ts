import { describe, expect, it } from 'vitest';
import {
  SELL_MOTION_OBJECT_KINDS, mutualPlanHealth, quoteAcceptability, quoteCheckoutIntent,
  quoteTotals, readMapMilestones, readQuoteLines, readSequenceSteps, readTrustAnswers,
  sequenceDueSteps, sequenceProgress, summarizeProspectEngagement, trustPacketReadiness,
} from '@builderforce/creation-canvas-contract';
import './sellMotionObjects';
import {
  SELL_MOTION_CONTRACT_KINDS, SELL_MOTION_LABELS, SELL_MOTION_NAMESPACE,
  SELL_MOTION_OBJECT_SPECS,
} from './sellMotionObjects';
import {
  isSpecObjectKind, specDerivedValues, specMutableFields, specObjectNamespace,
} from './specObjects';

/**
 * The vocabulary's own guarantees, and the arithmetic every consumer shares.
 *
 * The tests that matter here are the REFUSALS. A quote whose total is computed from a
 * request body, a cadence that re-sends to somebody who replied, a readiness percentage
 * that improves when a buyer strikes a row out — each one is a defect that looks like a
 * working feature, which is exactly the class a unit test earns its place against.
 */
describe('sell-motion vocabulary', () => {
  it('declares every kind the contract does, and no more', () => {
    expect(SELL_MOTION_OBJECT_SPECS.map((spec) => spec.kind).sort())
      .toEqual([...SELL_MOTION_CONTRACT_KINDS].sort());
    expect(Object.keys(SELL_MOTION_LABELS).sort()).toEqual([...SELL_MOTION_OBJECT_KINDS].sort());
  });

  it('registers every kind under its own namespace', () => {
    for (const kind of SELL_MOTION_OBJECT_KINDS) {
      expect(isSpecObjectKind(kind), kind).toBe(true);
      expect(specObjectNamespace(kind)).toBe(SELL_MOTION_NAMESPACE);
    }
  });

  it('never lets a model write an acceptance, a cadence cursor or a transcript', () => {
    // The `derived` flag is only worth having if it actually keeps these out of the
    // authorable list — that is what makes "an LLM cannot close a deal" structural rather
    // than a rule somebody has to remember in a tool handler.
    expect(specMutableFields('quote')).not.toContain('acceptedAt');
    expect(specMutableFields('quote')).not.toContain('acceptedBy');
    expect(specMutableFields('quote')).not.toContain('quoteState');
    expect(specMutableFields('sequence')).not.toContain('enrolments');
    expect(specMutableFields('call')).not.toContain('transcript');
    expect(specMutableFields('trial')).not.toContain('workspaceId');
    expect(specMutableFields('trustPacket')).not.toContain('controls');
    // …and every engagement figure, on every kind that can be shared.
    for (const kind of ['quote', 'call', 'trial', 'trustPacket', 'mutualActionPlan']) {
      expect(specMutableFields(kind), kind).not.toContain('shareOpens');
      expect(specMutableFields(kind), kind).not.toContain('engagementHotspots');
    }
  });

  it('computes a quote card totally from its own lines', () => {
    const derived = specDerivedValues('quote', {
      currency: 'USD',
      termMonths: 12,
      lines: [{ description: 'Teams', plan: 'teams', billingCycle: 'monthly', seats: 10, unitPriceCents: 2_000, discountPercent: 20 }],
    });
    // 10 seats × $20 = $200; 20% off = $160/month; 12 months = $1,920. Cents are shown
    // in full on a quote: this is the figure a buyer is asked to agree to, and rounding a
    // price to whole units is a different price.
    expect(derived.subtotalCents).toBe('$200.00');
    expect(derived.discountCents).toBe('$40.00 (20%)');
    expect(derived.totalCents).toBe('$160.00');
    expect(derived.contractValueCents).toBe('$1,920.00');
  });

  it('shows nothing rather than zero for an unpriced quote', () => {
    // A `$0` total reads as a worthless deal; an absent one reads as an unpriced deal.
    const derived = specDerivedValues('quote', { lines: [], termMonths: 12 });
    expect(derived.totalCents).toBeUndefined();
    expect(derived.subtotalCents).toBeUndefined();
  });
});

describe('quote arithmetic', () => {
  it('multiplies by seats only for per-seat plans', () => {
    const lines = readQuoteLines([
      { description: 'Pro', plan: 'pro', billingCycle: 'monthly', seats: 9, unitPriceCents: 2_900, discountPercent: 0 },
      { description: 'Onboarding', plan: '', billingCycle: 'monthly', seats: 4, unitPriceCents: 100_000, discountPercent: 0 },
    ]);
    // Pro is not per-seat, and neither is a services line — nine seats must not multiply.
    expect(quoteTotals(lines, 12).subtotalCents).toBe(2_900 + 100_000);
  });

  it('rounds per line so the total agrees with the lines printed beneath it', () => {
    const lines = readQuoteLines([
      { plan: 'teams', description: 'A', billingCycle: 'monthly', seats: 3, unitPriceCents: 333, discountPercent: 33 },
      { plan: 'teams', description: 'B', billingCycle: 'monthly', seats: 3, unitPriceCents: 333, discountPercent: 33 },
    ]);
    const totals = quoteTotals(lines, 1);
    expect(totals.discountCents).toBe(Math.round(999 * 0.33) * 2);
    expect(totals.totalCents).toBe(totals.subtotalCents - totals.discountCents);
  });

  it('prices a yearly deal by periods, not by months', () => {
    const lines = readQuoteLines([{ plan: 'pro', description: 'Pro', billingCycle: 'yearly', seats: 1, unitPriceCents: 29_000, discountPercent: 0 }]);
    // A 24-month yearly deal is TWO payments, not twenty-four.
    expect(quoteTotals(lines, 24).contractValueCents).toBe(58_000);
  });

  it('refuses to accept an expired, unsent or settled quote', () => {
    const now = new Date('2026-08-19T00:00:00Z');
    expect(quoteAcceptability({ state: 'sent', expiresAt: '2026-08-01' }, now).reason).toBe('expired');
    expect(quoteAcceptability({ state: 'draft' }, now).reason).toBe('notSent');
    expect(quoteAcceptability({ state: 'accepted' }, now).reason).toBe('settled');
    expect(quoteAcceptability({ state: 'sent', expiresAt: '2026-09-01' }, now).acceptable).toBe(true);
    // No expiry at all is acceptable — an offer with no deadline is unwise, not invalid.
    expect(quoteAcceptability({ state: 'viewed' }, now).acceptable).toBe(true);
  });

  it('carries the negotiated terms into a checkout intent, and refuses a services-only quote', () => {
    const lines = readQuoteLines([{ plan: 'teams', description: 'Teams', billingCycle: 'yearly', seats: 12, unitPriceCents: 19_200, discountPercent: 15 }]);
    const intent = quoteCheckoutIntent(lines, 12);
    expect(intent).toEqual({ targetPlan: 'teams', billingCycle: 'yearly', seats: 12, totalCents: quoteTotals(lines, 12).totalCents, termMonths: 12 });
    expect(quoteCheckoutIntent(readQuoteLines([{ description: 'Migration', plan: '', unitPriceCents: 500_000 }]), 12)).toBeNull();
  });
});

describe('cadence', () => {
  const steps = [
    { dayOffset: 7, channel: 'email', subject: 'Breakup', body: 'Last note' },
    { dayOffset: 0, channel: 'email', subject: 'Hello', body: 'Hi {{firstName}}' },
    { dayOffset: 2, channel: 'social', subject: '', body: 'Nice to connect' },
  ];

  it('orders steps by day, whatever order they were authored in', () => {
    expect(readSequenceSteps(steps).map((step) => step.dayOffset)).toEqual([0, 2, 7]);
  });

  it('sends nothing at all unless the cadence is running', () => {
    const enrolments = [{ contactRef: 'a@b.co', enrolledAtISO: '2026-08-01T00:00:00Z', stepsSent: 0 }];
    for (const state of ['draft', 'paused', 'stopped', 'completed']) {
      expect(sequenceDueSteps({ state, steps, enrolments }, new Date('2026-08-19T00:00:00Z')), state).toEqual([]);
    }
  });

  it('never re-sends to somebody who replied', () => {
    const due = sequenceDueSteps({
      state: 'running',
      steps,
      enrolments: [
        { contactRef: 'replied@b.co', enrolledAtISO: '2026-08-01T00:00:00Z', stepsSent: 1, repliedAtISO: '2026-08-02T00:00:00Z' },
        { contactRef: 'stopped@b.co', enrolledAtISO: '2026-08-01T00:00:00Z', stepsSent: 1, stoppedAtISO: '2026-08-02T00:00:00Z' },
        { contactRef: 'live@b.co', enrolledAtISO: '2026-08-01T00:00:00Z', stepsSent: 1 },
      ],
    }, new Date('2026-08-19T00:00:00Z'));
    expect(due.map((item) => item.enrolment.contactRef)).toEqual(['live@b.co']);
    expect(due[0]?.stepIndex).toBe(1);
  });

  it('measures offsets from enrolment, so a missed tick catches up rather than sliding', () => {
    // Enrolled 3 days ago with nothing sent: the day-0 step is due, not the day-2 one —
    // the cursor decides which, and the clock decides whether.
    const due = sequenceDueSteps({
      state: 'running', steps,
      enrolments: [{ contactRef: 'a@b.co', enrolledAtISO: '2026-08-16T00:00:00Z', stepsSent: 0 }],
    }, new Date('2026-08-19T00:00:00Z'));
    expect(due).toHaveLength(1);
    expect(due[0]?.step.dayOffset).toBe(0);
  });

  it('reports no reply rate at all for an empty cadence', () => {
    // 0% would read as a catastrophe; the absence of data reads as what it is.
    expect(sequenceProgress({ steps, enrolments: [] }).replyRatePercent).toBeUndefined();
    expect(sequenceProgress({ steps, enrolments: [{ contactRef: 'a@b.co', repliedAtISO: 'x' }] }).replyRatePercent).toBe(100);
  });
});

describe('prospect engagement', () => {
  it('ranks attention by seconds and keeps the current label', () => {
    const engagement = summarizeProspectEngagement([
      { event: 'opened', occurredAtISO: '2026-08-01T09:00:00Z', objectId: '', objectLabel: '', seconds: 0 },
      { event: 'dwell', occurredAtISO: '2026-08-01T09:01:00Z', objectId: 'a', objectLabel: 'Pricing', seconds: 30 },
      { event: 'dwell', occurredAtISO: '2026-08-01T09:02:00Z', objectId: 'b', objectLabel: 'Security', seconds: 240 },
      { event: 'dwell', occurredAtISO: '2026-08-01T09:03:00Z', objectId: 'a', objectLabel: 'Pricing v2', seconds: 10 },
    ]);
    expect(engagement.opens).toBe(1);
    expect(engagement.totalSeconds).toBe(280);
    expect(engagement.hotspots[0]).toMatchObject({ objectId: 'b', seconds: 240 });
    // Renamed after it was watched: it reads under the name it has now.
    expect(engagement.hotspots[1]).toMatchObject({ objectId: 'a', objectLabel: 'Pricing v2', seconds: 40 });
  });

  it('distinguishes "never opened" from "opened and did nothing"', () => {
    expect(summarizeProspectEngagement([]).everOpened).toBe(false);
    expect(summarizeProspectEngagement([
      { event: 'opened', occurredAtISO: '2026-08-01T09:00:00Z', objectId: '', objectLabel: '', seconds: 0 },
    ]).everOpened).toBe(true);
  });
});

describe('mutual action plan', () => {
  it('counts the milestones nobody on the buyer side owns', () => {
    const milestones = readMapMilestones([
      { title: 'Security review', dueAtISO: '2026-08-01', sellerOwner: 'Us', buyerOwner: '' },
      { title: 'Contract', dueAtISO: '2026-09-01', sellerOwner: 'Us', buyerOwner: 'Their legal' },
      { title: 'Kickoff', dueAtISO: '2026-07-01', sellerOwner: 'Us', buyerOwner: 'Them', state: 'done' },
    ]);
    const health = mutualPlanHealth(milestones, new Date('2026-08-19T00:00:00Z'));
    expect(health).toMatchObject({ total: 3, done: 1, overdue: 1, unownedByBuyer: 1 });
    expect(health.nextDueTitle).toBe('Contract');
    // A done milestone is not counted as unowned — the plan is judged on what is left.
    expect(mutualPlanHealth([], new Date()).completionPercent).toBeUndefined();
  });
});

describe('trust packet', () => {
  it('cannot be improved by striking rows out', () => {
    const answered = trustPacketReadiness(readTrustAnswersFixture());
    // 1 answered of 2 scored (the notApplicable row counts toward neither half).
    expect(answered.readyPercent).toBe(50);
    expect(answered.gaps).toBe(1);
    // An answer with no evidence is counted separately: it is an assertion, and
    // procurement teams are paid to notice.
    expect(answered.unevidenced).toBe(1);
  });

  function readTrustAnswersFixture() {
    return trustAnswers([
      { question: 'Do you hold SOC 2?', answer: 'Yes', evidence: '', state: 'answered' },
      { question: 'Data residency?', answer: '', evidence: '', state: 'gap' },
      { question: 'HIPAA?', answer: '', evidence: '', state: 'notApplicable' },
    ]);
  }
  function trustAnswers(rows: unknown) { return readTrustAnswers(rows); }
});
