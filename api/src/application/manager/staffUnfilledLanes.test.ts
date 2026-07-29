import { describe, it, expect } from 'vitest';
import {
  describeLaneStaffing, unfilledRolesForBoard, distinctTaskShapes, type LaneStaffingResult,
} from './staffUnfilledLanes';
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
   * THE 294 (0383). A role bound on one lane by an agent STAFFED TO THAT LANE says
   * nothing about any other lane — lane staffing is per-lane, only the roster is
   * board-wide — yet the board-wide `bound` set filtered exactly those roles back out of
   * the unfilled list. The project-scope pin that would fix the other lanes is written to
   * the roster by `staffUnfilledRole`, so masking the gap meant it was never written.
   *
   * Measured on project 11, 2026-07-29, with the 0382 shape fix already live:
   * `managed_no_role` at 294 of 670 stalled tickets, oldest idle 17 days, and ZERO
   * `assign` decisions in 429 that day — a sweep convinced it had nothing to do.
   */
  it('reports a role bound only by another lane’s own staffing', () => {
    const staffed = {
      agentRef: 'agent-arch', agentName: 'Aria', declaredRole: 'architect',
      model: null, position: 0, capableRoleKeys: ['architect'],
    };
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect')], laneAgents: [staffed] }),
      lane({ requirements: [roleRequirement('architect')] }),
    ])).toEqual(['architect']);
  });

  /**
   * The other half of the same rule: the ROSTER is board-wide, so a role it can fill is
   * genuinely filled on every lane. Reporting it would hire a second agent for a role
   * already filled — the blast radius the ladder's "never invent a teammate it could have
   * found" rule exists to avoid.
   */
  it('does not report a role the board-wide roster fills on every lane', () => {
    const roster = rosterFor(['architect']);
    expect(unfilledRolesForBoard([
      lane({ requirements: [roleRequirement('architect')], roster }),
      lane({ requirements: [roleRequirement('architect')], roster }),
    ])).toEqual([]);
  });

  /**
   * Within ONE lane the union still holds — binding is shape-independent and a lane that
   * authorises a role twice dispatches on either binding — so scoping per lane must not
   * start reporting a role its own lane already binds.
   */
  it('does not report a role its own lane binds, whatever the shape', () => {
    expect(unfilledRolesForBoard(
      [lane({
        requirements: [
          roleRequirement('architect'),
          roleRequirement('architect', { ticketType: 'bug' }),
        ],
        roster: rosterFor(['architect']),
      })],
      [{ taskType: 'bug', actionType: null }],
    )).toEqual([]);
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

/**
 * THE 293. The board sweep above ran every pass, was never shed, and still reported
 * NOTHING TO DO while `managed_no_role` held 293 of 673 stalled tickets on project 11 for
 * days — 3 `assign` decisions in a whole day against 3,940 decisions total.
 *
 * It probed lane authority with ONE synthetic empty task. `decideManagedLaneAuthority`
 * filters requirements through `requirementApplies`, which scopes them by `ticketType` and
 * by a `condition` (`is_security` / `has_ui_change` / `is_data_change`). Against `{}` the
 * ticket type defaults to `'task'` and the action type is undefined, so every requirement
 * scoped to another ticket type and every conditional requirement evaluated FALSE. Their
 * roles were invisible: never reported unfilled, never staffed, never even named.
 *
 * Meanwhile a real security ticket, or a real `frontend_ui` ticket, authorises exactly
 * those roles — and `pickManagedProducer` finds no agent, so the dispatcher refuses. The
 * board said "everything binds"; the tickets said "no role can execute this stage". Both
 * were reading the same table through different probes.
 */
describe('unfilledRolesForBoard — conditional and type-scoped roles (0382)', () => {
  const securityReviewer = roleRequirement('security-reviewer', { condition: 'is_security' });
  const uiApprover = roleRequirement('ui-approver', { condition: 'has_ui_change' });
  const bugTriager = roleRequirement('bug-triager', { ticketType: 'bug' });

  it('MISSES a conditional role when probed with no ticket shapes — the old behaviour', () => {
    // Kept as an explicit statement of the defect: the same board, same roster, the only
    // difference being whether the caller passes the shapes it already holds.
    expect(unfilledRolesForBoard([lane({ requirements: [securityReviewer] })])).toEqual([]);
  });

  it('finds it once the board is known to hold a security ticket', () => {
    expect(unfilledRolesForBoard(
      [lane({ requirements: [securityReviewer] })],
      [{ taskType: 'security', actionType: null }],
    )).toEqual(['security-reviewer']);
  });

  it('finds an action-type-conditional role from a real ticket shape', () => {
    expect(unfilledRolesForBoard(
      [lane({ requirements: [uiApprover] })],
      [{ taskType: 'task', actionType: 'frontend_ui' }],
    )).toEqual(['ui-approver']);
  });

  it('finds a role scoped to a ticket TYPE the board actually has', () => {
    expect(unfilledRolesForBoard(
      [lane({ requirements: [bugTriager] })],
      [{ taskType: 'bug', actionType: null }],
    )).toEqual(['bug-triager']);
  });

  it('still refuses to staff a role NO ticket on the board needs', () => {
    // The guard against the cohort fix becoming a hiring spree: the shapes come from the
    // board's own tickets, so a role whose condition no ticket satisfies stays invisible.
    expect(unfilledRolesForBoard(
      [lane({ requirements: [securityReviewer, uiApprover] })],
      [{ taskType: 'task', actionType: 'backend_api' }],
    )).toEqual([]);
  });

  it('counts a role as filled when it binds under ANY shape', () => {
    // The agent is not shape-specific: one capable teammate serves the role whatever
    // ticket triggered the requirement.
    expect(unfilledRolesForBoard(
      [lane({ requirements: [securityReviewer], roster: rosterFor(['security-reviewer']) })],
      [{ taskType: 'security', actionType: null }],
    )).toEqual([]);
  });

  it('unions across every shape, so one pass names every unfillable role at once', () => {
    expect(unfilledRolesForBoard(
      [lane({ requirements: [securityReviewer, uiApprover, bugTriager] })],
      [
        { taskType: 'security', actionType: null },
        { taskType: 'task', actionType: 'frontend_ui' },
        { taskType: 'bug', actionType: null },
      ],
    )).toEqual(['bug-triager', 'security-reviewer', 'ui-approver']);
  });
});

describe('distinctTaskShapes', () => {
  it('collapses a whole backlog to the pairs that change applicability', () => {
    // 678 tickets must not become 678 probes — only (taskType, actionType) matters.
    const shapes = distinctTaskShapes([
      { taskType: 'task', actionType: 'frontend_ui' },
      { taskType: 'task', actionType: 'frontend_ui' },
      { taskType: 'security', actionType: null },
      { taskType: 'task', actionType: 'frontend_ui' },
    ]);
    expect(shapes).toHaveLength(2);
    expect(shapes).toContainEqual({ taskType: 'task', actionType: 'frontend_ui' });
    expect(shapes).toContainEqual({ taskType: 'security', actionType: null });
  });

  it('normalizes absent fields so undefined and null are one shape, not two', () => {
    expect(distinctTaskShapes([{}, { taskType: null }, { taskType: null, actionType: null }]))
      .toEqual([{ taskType: null, actionType: null }]);
  });
});
