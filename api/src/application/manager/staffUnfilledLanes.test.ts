import { describe, it, expect } from 'vitest';
import { describeLaneStaffing, unfilledRolesForBoard, type LaneStaffingResult } from './staffUnfilledLanes';
import { EMPTY_ROLE_ROSTER, buildRoleRoster } from '../kanban/roleCapability';
import type { LaneAuthorityInputs } from '../kanban/managedLaneRoles';

/**
 * THE ARITHMETIC. `managed_no_role` was the largest stall cause on the measured board —
 * 293 of 678 stalled tickets, oldest idle 16 days — and its remedy already existed and was
 * already correct. It just lived inside a PER-TICKET triage remedy: capped per pass, in
 * the stage that gets shed, on a project-scope problem.
 *
 * The cause is per-LANE. A board has a few dozen lanes, not 678 tickets, so asking once
 * per lane turns the whole cohort into a couple of writes. These tests pin the selection
 * rule, because staffing a role the board does not universally need is how a cohort fix
 * becomes a hiring spree.
 */

const lane = (over: Partial<LaneAuthorityInputs> = {}): LaneAuthorityInputs => ({
  requirements: [],
  laneAgents: [],
  roster: EMPTY_ROLE_ROSTER,
  ...over,
});

const roleRequirement = (ref: string, over: Partial<LaneAuthorityInputs['requirements'][number]> = {}) => ({
  kind: 'role', ref, ticketType: null, condition: null, ...over,
});

/** A roster that can fill exactly the named roles. */
const rosterFor = (roleKeys: string[]) => buildRoleRoster({
  agents: roleKeys.map((k, i) => ({
    id: `agent-${i}`, name: `Agent ${i}`, title: null, bio: null, skills: null,
    roleKeys: [k], builtinKind: null, baseModel: null, status: 'active',
  })),
  pins: [],
  humans: [],
} as never, 1);

describe('unfilledRolesForBoard', () => {
  it('finds nothing on a board with no managed lanes', () => {
    expect(unfilledRolesForBoard([])).toEqual([]);
    expect(unfilledRolesForBoard([lane()])).toEqual([]);
  });

  it('reports a role the lane authorises that binds to no agent', () => {
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect')] }),
    ])).toEqual(['architect']);
  });

  it('reports nothing when the roster can already fill the role', () => {
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect')], roster: rosterFor(['architect']) }),
    ])).toEqual([]);
  });

  /**
   * One board, several lanes, one shared gap — this IS the 293-ticket cohort: the roles
   * are few and the tickets are many, so the answer must be per-role and deduplicated.
   */
  it('deduplicates a gap shared across lanes', () => {
    const roster = rosterFor(['developer']);
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect'), roleRequirement('developer')], roster }),
      lane({ requirements: [roleRequirement('architect')], roster }),
      lane({ requirements: [roleRequirement('validator')], roster }),
    ])).toEqual(['architect', 'validator']);
  });

  /**
   * A role bound on ONE lane is dispatchable, so it is not a staffing gap even if another
   * lane leaves it unbound. Reporting it would hire a second agent for a role already
   * filled — the blast radius the ladder's "never invent a teammate it could have found"
   * rule exists to avoid.
   */
  it('does not report a role that binds on at least one lane', () => {
    const roster = rosterFor(['architect']);
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect')], roster }),
      lane({ requirements: [roleRequirement('architect')], roster: EMPTY_ROLE_ROSTER }),
    ])).toEqual([]);
  });

  /**
   * The scope guard. A requirement that only applies to some tickets (a security reviewer
   * on security tickets) is a per-ticket concern; hiring for it board-wide would provision
   * a teammate the board does not universally need. The board sweep asks the
   * unconditional question only, and leaves the rest to the per-ticket remedy.
   */
  it('ignores a conditional requirement — the board sweep asks the unconditional question', () => {
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('security', { ticketType: 'bug' })] }),
    ])).toEqual([]);
  });

  it('returns a stable, sorted list so the journal line does not churn between passes', () => {
    const roles = unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('validator'), roleRequirement('architect'), roleRequirement('developer')] }),
    ]);
    expect(roles).toEqual([...roles].sort());
  });
});

describe('describeLaneStaffing', () => {
  const result = (over: Partial<LaneStaffingResult> = {}): LaneStaffingResult =>
    ({ unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, ...over });

  it('says nothing when there was nothing to staff — the steady state is silent', () => {
    expect(describeLaneStaffing(result())).toBe('');
  });

  /**
   * Names the COHORT effect, not the write. "Pinned Ada to architect" is a row; "every
   * ticket held at those stages can now be dispatched" is the fact a reader needs, and it
   * is the difference between a feed that explains the board and one that narrates itself.
   */
  it('reports what filling the role unblocks, not merely that a row was written', () => {
    const text = describeLaneStaffing(result({
      unfilledRoleKeys: ['architect'],
      filled: [{ roleKey: 'architect', action: 'staffed', agentName: 'Ada', detail: '' }],
    }));
    expect(text).toContain('architect');
    expect(text).toContain('Ada');
    expect(text).toMatch(/can now be dispatched/);
  });

  it('marks a hire as a hire — provisioning a teammate is not the same as pinning one', () => {
    const text = describeLaneStaffing(result({
      unfilledRoleKeys: ['validator'],
      filled: [{ roleKey: 'validator', action: 'hired', agentName: 'Validator', detail: '' }],
      hires: 1,
    }));
    expect(text).toContain('(hired)');
  });

  it('hands the unfillable roles to a human by name', () => {
    const text = describeLaneStaffing(result({
      unfilledRoleKeys: ['made-up-role'],
      unfillable: [{ roleKey: 'made-up-role', action: 'escalate', agentName: null, detail: '' }],
    }));
    expect(text).toContain('made-up-role');
    expect(text).toMatch(/human/);
  });
});
