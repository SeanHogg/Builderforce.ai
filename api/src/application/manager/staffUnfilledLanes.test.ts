import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  describeLaneStaffing, unfilledRolesForBoard, findBoardStaffingGaps, distinctTaskShapes,
  laneStaffingFingerprint, type LaneStaffingResult, type UnauthorizedLane,
} from './staffUnfilledLanes';
import { stateFingerprint } from './managerActionJournal';
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

/**
 * THE GRANT (0386) — reporting must never depend on it, acting always must.
 *
 * A lane that authorises NO role is reported by `findBoardStaffingGaps` unconditionally,
 * and that is the part an operator needs whatever their policy says. ACTING on it —
 * pinning a producer — starts every ticket sitting in the lane, which on the measured
 * board was 299 tickets in `backlog` alone. So the write is behind `allowAutoStaffLanes`,
 * and these pin the three properties no unit test of the pure half can see: the gate
 * exists, it wraps only the write, and `shape_unmatched` is never written to at all.
 */
describe('lane auto-staffing is gated, and only the WRITE is gated', () => {
  // `.href`: the ambient `URL` here is the workers-types one, which is not assignable to
  // node:url's `URL`. fileURLToPath accepts a string — same idiom as the sibling tests.
  const source = readFileSync(
    fileURLToPath(new URL('./staffUnfilledLanes.ts', import.meta.url).href), 'utf8',
  );

  it('performs the lane write only under the explicit grant', () => {
    expect(source).toMatch(/if \(args\.allowAutoStaffLanes\) \{[\s\S]*?staffLaneProducer\(/);
  });

  it('reports the unauthorised lanes BEFORE the gate, so a withheld grant still surfaces them', () => {
    expect(source.indexOf('const unauthorizedLanes')).toBeLessThan(source.indexOf('if (args.allowAutoStaffLanes)'));
  });

  /** Tier (a) wins over lane staffing, so a staffed agent on a lane that HAS requirements
   *  would never be consulted — the write would be a lie in the feed and a row nobody reads. */
  it('never writes to a lane whose requirements simply do not match its tickets', () => {
    expect(source).toMatch(/if \(lane\.reason === 'shape_unmatched'\) continue;/);
  });

  /** Capability comes from the ROSTER, not from the assignment row: `approverRoleKeyForLaneAgent`
   *  refuses any lane agent whose capable set is empty. Writing only the lane row would
   *  produce a lane that still authorises nothing — the exact bug being fixed. */
  it('pins the ROLE before binding the lane, or the lane still authorises nothing', () => {
    // Lane staffing writes to the canonical `agent_assignments` since migration 1085.
    expect(source).toMatch(/staffUnfilledRole\([\s\S]*?\)[\s\S]*?insert\(laneAgentAssignments\)/);
  });
});

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
    ({ unfilledRoleKeys: [], unauthorizedLanes: [], filled: [], unfillable: [], hires: 0, error: null, ...over });

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

  it('does not disguise a failed staffing sweep as an empty, healthy board', () => {
    const text = describeLaneStaffing(result({ error: 'role roster unavailable' }));
    expect(text).toContain('role roster unavailable');
    expect(text).toMatch(/needs attention/);
  });
});

/**
 * THE MEASURED LOOP (project 11, 2026-07-31, api 2026.7.195): the identical `assign`
 * verdict — "3 stages on this board authorise NO role … 317 tickets …" — journalled 3×
 * in the last 30 decisions (07:55:06 → 09:00:02) for a condition nobody had touched. One
 * `manager_actions` row per project per five minutes, on a board deliberately held on
 * Neon's free tier, crowding real decisions out of both the feed and the 200-row window.
 *
 * The fingerprint is the CONTRACT. Too narrow and a genuine change is suppressed as
 * "already said", which is strictly worse than the duplicate it prevents — so every input
 * the sentence is computed from has to move it.
 */
describe('laneStaffingFingerprint', () => {
  const result = (over: Partial<LaneStaffingResult> = {}): LaneStaffingResult =>
    ({ unfilledRoleKeys: [], unauthorizedLanes: [], filled: [], unfillable: [], hires: 0, error: null, ...over });
  const unauthorized = (over: Partial<UnauthorizedLane> = {}): UnauthorizedLane =>
    ({ swimlaneId: 's1', laneKey: 'backlog', reason: 'lane_unstaffed', ticketCount: 299, unmappedAgents: [], ...over });
  const board = () => result({
    unauthorizedLanes: [unauthorized(), unauthorized({ swimlaneId: 's2', laneKey: 'blocked', ticketCount: 10 })],
  });

  it('is stable across passes for an unchanged board — the whole point', () => {
    expect(laneStaffingFingerprint(board())).toBe(laneStaffingFingerprint(board()));
  });

  it('does not move when the lanes are merely reported in a different order', () => {
    const reversed = result({ unauthorizedLanes: [...board().unauthorizedLanes].reverse() });
    expect(laneStaffingFingerprint(reversed)).toBe(laneStaffingFingerprint(board()));
  });

  it('RE-ARMS when the cohort a lane is holding changes size', () => {
    // A lane draining 299 → 4 is the board changing, and the reader has to be told.
    const drained = result({
      unauthorizedLanes: [unauthorized({ ticketCount: 4 }), unauthorized({ swimlaneId: 's2', laneKey: 'blocked', ticketCount: 10 })],
    });
    expect(laneStaffingFingerprint(drained)).not.toBe(laneStaffingFingerprint(board()));
  });

  it('RE-ARMS when a new stage falls unconfigured', () => {
    const worse = result({
      unauthorizedLanes: [...board().unauthorizedLanes, unauthorized({ swimlaneId: 's3', laneKey: 'todo', ticketCount: 8 })],
    });
    expect(laneStaffingFingerprint(worse)).not.toBe(laneStaffingFingerprint(board()));
  });

  it('RE-ARMS when a lane\'s reason changes, even at the same count', () => {
    const retyped = result({
      unauthorizedLanes: [
        unauthorized({ reason: 'lane_agents_not_role_capable', unmappedAgents: ['Kevin BA/PM/PO'] }),
        unauthorized({ swimlaneId: 's2', laneKey: 'blocked', ticketCount: 10 }),
      ],
    });
    expect(laneStaffingFingerprint(retyped)).not.toBe(laneStaffingFingerprint(board()));
  });

  it('RE-ARMS when the sweep itself starts failing', () => {
    expect(laneStaffingFingerprint(result({ error: 'role roster unavailable' })))
      .not.toBe(laneStaffingFingerprint(result()));
  });

  it('RE-ARMS on the roles it could not fill', () => {
    expect(laneStaffingFingerprint(result({ unfilledRoleKeys: ['architect'] })))
      .not.toBe(laneStaffingFingerprint(result({ unfilledRoleKeys: ['architect', 'validator'] })));
  });
});

describe('stateFingerprint', () => {
  it('is deterministic and short enough to survive detail truncation', () => {
    expect(stateFingerprint(['a', 1, null])).toBe(stateFingerprint(['a', 1, null]));
    expect(stateFingerprint(['a', 1, null])).toHaveLength(8);
  });

  it('distinguishes different verdicts', () => {
    expect(stateFingerprint(['a'])).not.toBe(stateFingerprint(['b']));
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

/**
 * THE GAP WITH NO NAME — why `managed_no_role` survived four rounds of fixes.
 *
 * `unfilledRolesForBoard` can only report a role it can NAME: a role key appearing as an
 * unbound approver. But `decideLaneApprovers` has outcomes that produce NO approvers at
 * all — a lane with neither requirements nor staffed agents, staffed agents that map to
 * no role, or requirements all scoped to ticket types the lane's tickets are not. Each
 * one makes `pickManagedProducer` return null, which the evaluator reports as
 * `managed_no_role` — and leaves the staffing sweep with nothing to put in its unfilled
 * set, so it returned empty and journalled nothing.
 *
 * Measured on project 11 across four captures: `managed_no_role` at 294 → 304 → 305 of
 * ~670 stalled tickets while `board_staffing` ran every pass (427ms) and the decision
 * feed held ZERO `assign` decisions of any kind. The surface told readers to look for an
 * assign decision naming the roles it could not fill; there was none, because the gap had
 * no role to name. Silence meant "everything binds" and "the gap is nameless"
 * indistinguishably — which is exactly how it survived.
 */
describe('findBoardStaffingGaps — the lanes that authorise NOTHING', () => {
  it('reports a lane with no requirements and no agents, which has no role to staff', () => {
    const gaps = findBoardStaffingGaps([['lane-a', lane({ laneKey: 'ready' })]]);
    // Nothing NAMED — which is precisely why the old sweep reported nothing at all.
    expect(gaps.unfilledRoleKeys).toEqual([]);
    expect(gaps.unauthorizedLanes).toEqual([
      { swimlaneId: 'lane-a', laneKey: 'ready', reason: 'lane_unstaffed', unmappedAgents: [] },
    ]);
  });

  /**
   * NAMING THE AGENT IS THE WHOLE REPAIR for this reason. "Agents are staffed to the stage
   * but none of them can act as any role" tells a reader a role is missing and not which
   * agent to give it to — the same "go and look for it" flaw the traversal exists to
   * remove, one level further down. Measured on project 11 (2026-07-31): the `todo` lane
   * reported this reason holding 8 tickets and named nobody.
   */
  it('distinguishes agents-with-no-role from a lane nobody configured, and NAMES them', () => {
    const gaps = findBoardStaffingGaps([['lane-b', lane({
      laneKey: 'in_progress',
      laneAgents: [
        { agentRef: 'c:1', agentName: 'Bob', declaredRole: 'Bob Developer', position: 0, model: null, capableRoleKeys: [] },
        { agentRef: 'c:2', agentName: null, declaredRole: null, position: 1, model: null, capableRoleKeys: [] },
      ],
    })]]);
    // A different repair: give the agent a job role, rather than declare a requirement.
    expect(gaps.unauthorizedLanes[0]).toMatchObject({
      reason: 'lane_agents_not_role_capable',
      unmappedAgents: ['Bob (declared "Bob Developer")', 'c:2'],
    });
  });

  it('leaves the agent list empty for a reason that has no agents to name', () => {
    const gaps = findBoardStaffingGaps([['lane-g', lane({ laneKey: 'backlog' })]]);
    expect(gaps.unauthorizedLanes[0]).toMatchObject({ reason: 'lane_unstaffed', unmappedAgents: [] });
  });

  /**
   * The subtle one, and the likeliest on a real board: requirements EXIST and bind fine
   * for one ticket type while authorising nothing for another. A board-wide "does this
   * lane work?" answer says yes and the tickets of the other type still cannot dispatch —
   * the same per-shape hole the role half already had to be taught about.
   */
  it('reports a lane that authorises nothing for SOME shape it holds', () => {
    const gaps = findBoardStaffingGaps(
      [['lane-c', lane({
        laneKey: 'ready',
        requirements: [roleRequirement('architect', { ticketType: 'bug' })],
        roster: rosterFor(['architect']),
      })]],
      [{ taskType: 'bug', actionType: null }, { taskType: 'story', actionType: null }],
    );
    // 'bug' binds architect; 'story' authorises nothing at all.
    expect(gaps.unfilledRoleKeys).toEqual([]);
    expect(gaps.unauthorizedLanes[0]).toMatchObject({ laneKey: 'ready', reason: 'shape_unmatched' });
  });

  it('stays silent on a lane that authorises a bound role for every shape', () => {
    const gaps = findBoardStaffingGaps(
      [['lane-d', lane({
        laneKey: 'ready',
        requirements: [roleRequirement('architect')],
        roster: rosterFor(['architect']),
      })]],
      [{ taskType: 'bug', actionType: null }],
    );
    expect(gaps).toEqual<typeof gaps>({ unfilledRoleKeys: [], unauthorizedLanes: [] });
  });

  /** The two gaps are complements and must both be reported from one probe — a lane can
   *  have a nameable unbound role AND authorise nothing for another shape. */
  it('reports both halves of a board that has both problems', () => {
    const gaps = findBoardStaffingGaps([
      ['lane-e', lane({ laneKey: 'ready', requirements: [roleRequirement('architect')] })],
      ['lane-f', lane({ laneKey: 'done' })],
    ]);
    expect(gaps.unfilledRoleKeys).toEqual(['architect']);
    expect(gaps.unauthorizedLanes.map((l) => l.laneKey)).toEqual(['done']);
  });

  /** The role half must keep answering exactly as before — it is the same traversal now. */
  it('agrees with unfilledRolesForBoard, which is now its role half', () => {
    const lanes: Array<readonly [string, LaneAuthorityInputs]> = [
      ['1', lane({ requirements: [roleRequirement('architect')] })],
      ['2', lane({ requirements: [roleRequirement('validator')], roster: rosterFor(['validator']) })],
    ];
    expect(findBoardStaffingGaps(lanes).unfilledRoleKeys)
      .toEqual(unfilledRolesForBoard(lanes.map(([, v]) => v)));
  });
});

describe('describeLaneStaffing — the nameless gap must be said out loud', () => {
  const result = (over: Partial<LaneStaffingResult> = {}): LaneStaffingResult =>
    ({ unfilledRoleKeys: [], unauthorizedLanes: [], filled: [], unfillable: [], hires: 0, error: null, ...over });

  it('names the stage, the cost, and the repair — not just that something is wrong', () => {
    const text = describeLaneStaffing(result({
      unauthorizedLanes: [
        { swimlaneId: 'x', laneKey: 'ready', reason: 'lane_unstaffed', ticketCount: 200, unmappedAgents: [] },
        { swimlaneId: 'y', laneKey: 'in_progress', reason: 'shape_unmatched', ticketCount: 105, unmappedAgents: [] },
      ],
    }));
    expect(text).toContain('305 tickets');      // the cost, summed
    expect(text).toContain('"ready"');           // the stage a human recognises
    expect(text).toContain('cannot fix it automatically'); // there is no role to staff
    expect(text).toMatch(/add a role requirement or staff an agent/);
    expect(text).toMatch(/widen the requirement or re-type the tickets/);
    expect(text).toContain('2 stages on this board authorise NO role');
  });

  it('names the agent to give a job role, and agrees with itself on ONE stage', () => {
    const text = describeLaneStaffing(result({
      unauthorizedLanes: [{
        swimlaneId: 'z', laneKey: 'todo', reason: 'lane_agents_not_role_capable', ticketCount: 8,
        unmappedAgents: ['Bob (declared "Bob Developer")'],
      }],
    }));
    expect(text).toContain('Bob (declared "Bob Developer")');
    // "1 stage … authorise" was in the live feed. A sentence an operator is meant to act
    // on should not read as machine output.
    expect(text).toContain('1 stage on this board authorises NO role');
  });

  it('still says nothing when the board is genuinely fine', () => {
    expect(describeLaneStaffing(result())).toBe('');
  });
});
