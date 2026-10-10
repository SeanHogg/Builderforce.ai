import { describe, expect, it } from 'vitest';
import { decideProducerReopen, type ReopenCandidateSlot } from './reopenProducerSlots';

/**
 * A completed producer slot stays closed (ticket #2180: a finished Business Analyst was
 * re-dispatched seven more times because nothing distinguished "rework owed" from "the
 * generic pick chose it again"). Rework now happens only through this explicit reopen,
 * so WHAT it reopens is the whole contract.
 */
describe('decideProducerReopen', () => {
  const slot = (over: Partial<ReopenCandidateSlot> = {}): ReopenCandidateSlot => ({
    stageKey: 'in_progress', roleKey: 'developer', responsibility: 'owner', required: true, state: 'completed', ...over,
  });

  it('reopens a completed, required producer on the returned stage', () => {
    expect(decideProducerReopen([slot(), slot({ roleKey: 'architect', responsibility: 'contributor' })], 'in_progress'))
      .toEqual(['developer', 'architect']);
  });

  it('never reopens another stage, a reviewer, an optional slot, or a slot not yet completed', () => {
    expect(decideProducerReopen([
      slot({ stageKey: 'ready', roleKey: 'business-analyst' }),
      slot({ roleKey: 'code-reviewer', responsibility: 'reviewer' }),
      slot({ roleKey: 'architect', required: false }),
      slot({ roleKey: 'qa-tester', state: 'in_progress' }),
    ], 'in_progress')).toEqual([]);
  });

  it('leaves a WAIVED or SKIPPED producer alone — a waiver is a recorded decision, not an omission', () => {
    expect(decideProducerReopen([slot({ state: 'waived' }), slot({ roleKey: 'devops', state: 'skipped' })], 'in_progress')).toEqual([]);
  });

  it('reopens a role once even when it holds several slots on the stage', () => {
    expect(decideProducerReopen([slot(), slot({ responsibility: 'contributor' })], 'in_progress')).toEqual(['developer']);
  });
});
