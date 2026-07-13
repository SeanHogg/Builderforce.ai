/**
 * Pre-finish gates for the cloud tool loop — the deterministic guards that decide
 * whether a `finish` is honored or blocked back to the agent.
 *
 *  • assertsUnrunVerification — honesty gate (claims a check passed that can't run).
 *  • hasNoCodeDeliverable     — completeness self-review (ROADMAP #38): a code-bound
 *    run finishing with no real code deliverable, only the seeded PRD or nothing.
 *
 * Both are pure, so they're unit-tested in isolation here (the loop wiring just
 * picks the block message and re-prompts).
 */
import { describe, it, expect } from 'vitest';
import { assertsUnrunVerification, hasNoCodeDeliverable } from './cloudAgentTools';

describe('hasNoCodeDeliverable (ROADMAP #38 completeness self-review)', () => {
  it('flags an empty deliverable set (nothing written)', () => {
    expect(hasNoCodeDeliverable(new Set())).toBe(true);
  });

  it('flags a PRD-only branch (the seeded PRD.md is not a code deliverable)', () => {
    // execution #20 footgun: a PR with PRD.md but no actual code change.
    expect(hasNoCodeDeliverable(new Set(['PRD.md']))).toBe(true);
  });

  it('passes once any real code file was committed', () => {
    expect(hasNoCodeDeliverable(new Set(['PRD.md', 'src/feature.ts']))).toBe(false);
    expect(hasNoCodeDeliverable(new Set(['src/feature.ts']))).toBe(false);
  });
});

describe('assertsUnrunVerification (honesty gate) — unchanged contract', () => {
  it('blocks a summary claiming a check passed', () => {
    expect(assertsUnrunVerification('The typecheck now passes and all tests are green.')).toBe(true);
  });
  it('allows an honest summary that does not claim a check passed', () => {
    expect(assertsUnrunVerification('Implemented the new route; CI on the PR will verify it.')).toBe(false);
  });
});
