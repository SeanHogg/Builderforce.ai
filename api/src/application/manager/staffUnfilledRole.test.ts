import { describe, expect, it } from 'vitest';
import { MAX_HIRES_PER_PASS, decideStaffingAction } from './staffUnfilledRole';

/**
 * The ladder that clears the largest stall cohort on the board — 447 of 678 tickets on
 * `managed_no_role`, a stage authorising a role no agent can perform. Each rung has to be
 * reachable, and the two refusals have to hold: the manager must never invent a teammate
 * for a role the workspace does not recognise, and never provision without a ceiling.
 */
describe('decideStaffingAction', () => {
  const base = { knownRole: true, hiresUsed: 0 };

  it('pins an already-capable teammate rather than hiring', () => {
    // The cheapest rung: the role was unfilled only because nothing pinned anyone to it.
    expect(decideStaffingAction({ ...base, capableCount: 1 })).toBe('staffed');
    expect(decideStaffingAction({ ...base, capableCount: 4, hiresUsed: 99 })).toBe('staffed');
  });

  it('hires when nobody on the roster can perform a known role', () => {
    expect(decideStaffingAction({ ...base, capableCount: 0 })).toBe('hired');
  });

  it('refuses to invent an agent for a role the workspace does not recognise', () => {
    // A free-text or typo'd required role is a template defect. Provisioning for it would
    // manufacture a teammate to satisfy a mistake, and hide the mistake while doing it.
    expect(decideStaffingAction({ ...base, capableCount: 0, knownRole: false })).toBe('escalate');
  });

  it('stops hiring at the per-pass ceiling and hands over instead', () => {
    expect(decideStaffingAction({ ...base, capableCount: 0, hiresUsed: MAX_HIRES_PER_PASS - 1 })).toBe('hired');
    expect(decideStaffingAction({ ...base, capableCount: 0, hiresUsed: MAX_HIRES_PER_PASS })).toBe('escalate');
    // A board missing more than a couple of roles at once is a misconfigured template,
    // and the honest response is a human looking at it.
    expect(decideStaffingAction({ ...base, capableCount: 0, hiresUsed: 50 })).toBe('escalate');
  });

  it('honours a caller-supplied hiring budget', () => {
    expect(decideStaffingAction({ ...base, capableCount: 0, hiresUsed: 0, maxHires: 0 })).toBe('escalate');
  });
});
