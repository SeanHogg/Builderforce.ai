import { describe, it, expect } from 'vitest';
import { isRoleAttributedRun } from './cloudDispatch';

/**
 * A role-attributed run must HOLD the ticket's lane. Its verdict advances the stage; the
 * run merely completing does not. Measured on task 387: a `manager:signoff-request` run
 * completed in 20 seconds and the ticket's lane moved 1.5 seconds later, regardless of
 * what the reviewer decided.
 */
describe('isRoleAttributedRun', () => {
  it('recognises a REVIEWER round-trip (reviewRole)', () => {
    expect(isRoleAttributedRun(JSON.stringify({ cloudAgentRef: 'a', reviewRole: 'code-reviewer' }))).toBe(true);
  });

  it('recognises a PRODUCER round-trip (actAsRole)', () => {
    expect(isRoleAttributedRun(JSON.stringify({ cloudAgentRef: 'a', actAsRole: 'developer' }))).toBe(true);
  });

  it('does NOT claim an ordinary work run', () => {
    // These must keep advancing the lane on completion — that is the normal flow.
    expect(isRoleAttributedRun(JSON.stringify({ cloudAgentRef: 'a', laneKey: 'in_progress' }))).toBe(false);
    expect(isRoleAttributedRun(null)).toBe(false);
    expect(isRoleAttributedRun('not json')).toBe(false);
    expect(isRoleAttributedRun(JSON.stringify({ reviewRole: '   ' }))).toBe(false);
  });
});
