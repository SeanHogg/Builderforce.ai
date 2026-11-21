import { describe, expect, it } from 'vitest';
import { ROUTE_WEIGHTS, TICKET_INTENT_PATTERNS, pipelineFeaturesOf, scorePipeline } from './index.js';

// VS Code chat #157440: requests to file, review or reconcile TICKETS against a spec started in the code role (quick route).
const VERBATIM = [
  'For all the items that are incomplete, create associated tickets to this chat',
  'Review the Measure.md file; make updates to it to indicate items that are completed/done.',
  'if these are still open, why didnt you create tickets for the open items and assign to this chat?',
];

describe('regression: chat #157440 — ticket / spec reconciliation intent routes full', () => {
  for (const request of VERBATIM) {
    it(`regression: "${request}" has ticket intent and plans first, even as a follow-up`, () => {
      for (const actionType of ['other', 'docs', 'analysis']) {
        const f = pipelineFeaturesOf(request, { actionType, followUp: true });
        expect(f.ticketIntent).toBe(true);
        const scored = scorePipeline(f);
        expect(scored.route).toBe('full');
        expect(scored.reason).toContain('ticket intent');
      }
    });
  }

  it('the intent is data, and outweighs every quick-leaning feature together', () => {
    expect(TICKET_INTENT_PATTERNS.length).toBeGreaterThan(0);
    const quickest = ROUTE_WEIGHTS.bias + ROUTE_WEIGHTS.followUp + ROUTE_WEIGHTS.questionOnly + Math.min(...Object.values(ROUTE_WEIGHTS.actionType));
    expect((ROUTE_WEIGHTS.ticketIntent ?? 0) + quickest).toBeGreaterThan(0);
  });

  it('an ordinary small edit has no ticket intent and stays quick', () => {
    const f = pipelineFeaturesOf('Fix the typo in the README heading', { actionType: 'docs' });
    expect(f.ticketIntent).toBe(false);
    expect(scorePipeline(f).route).toBe('quick');
  });
});
