import { describe, expect, it } from 'vitest';
import { decideRoute } from './runRoute';

// VS Code chat #157440: a follow-up asking for tickets against a spec started in the code role from step 0.
const VERBATIM = [
  'For all the items that are incomplete, create associated tickets to this chat',
  'Review the Measure.md file; make updates to it to indicate items that are completed/done.',
  'if these are still open, why didnt you create tickets for the open items and assign to this chat?',
];

describe('regression: chat #157440 — ticket / spec requests start in plan', () => {
  for (const request of VERBATIM) {
    it(`regression: "${request}" (a follow-up) routes full and starts in plan`, () => {
      const route = decideRoute({ pipeline: { routing: 'auto', quickModel: 'fast' } }, request, true);
      expect(route.pipeline?.route).toBe('full');
      expect(route.start.startPhase).toBe('plan');
    });
  }
});
