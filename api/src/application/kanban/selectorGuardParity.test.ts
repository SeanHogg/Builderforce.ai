import { describe, expect, it } from 'vitest';
import {
  decideManagedLaneAuthority, pickManagedProducer, bindStaffedAgentsToRoles,
  type LaneAuthorityInputs,
} from './managedLaneRoles';
import {
  agentIsRoleCapable, buildRoleRoster, BUILTIN_KIND_ROLE_KEYS, EMPTY_ROLE_ROSTER,
  roleCandidatesFrom, type RoleCapableAgentRow, type RoleRosterData,
} from './roleCapability';
import { BUILTIN_ROLES } from './roleCatalog';
import type { LaneStaffedAgent } from '../swimlane/laneApprover';

/**
 * SELECTOR ↔ GUARD PARITY — the bug class this codebase has now shipped THREE times.
 *
 * Two independent components answer "can this agent act as this role?":
 *
 *   the GUARD     `isAgentRefRoleCapable` / `agentIsRoleCapable` — validates a dispatch.
 *                 Accepts FOUR paths: a `project_role_assignments` pin, explicit
 *                 `ide_agents.role_keys`, `builtin_kind`, or a fuzzy title/skill match.
 *   the SELECTOR  `pickManagedProducer` — CHOOSES who to dispatch. Accepts exactly ONE
 *                 path: an agent in `swimlane_agent_assignments` for that lane.
 *
 * Whenever those two sets diverge, the platform enters a state that reads as a staffing
 * problem and is not one: a capable agent exists, the guard would wave it through, and
 * nothing can ever nominate it. The three instances, in order: an empty sign-off ledger
 * (0 rows against 1,030 reviewer runs), then 405 stalled tickets, then 447 — 66% of
 * project 11's backlog. Each was fixed by widening whichever side was narrower, which
 * closes the instance and preserves the seam, and none left behind a test asserting the
 * two sides AGREE.
 *
 * THE SEAM IS NOW GONE. `roleCandidatesFrom` is the single capability oracle: the guard
 * asks whether one ref is in its answer, the selector takes the head of it. These tests
 * assert the PARITY PROPERTY itself rather than either implementation, so a future
 * narrowing of either side fails here instead of in production two weeks later.
 *
 * Both sides are pure functions, so the whole contract is expressible with no database.
 */

const laneAgent = (over: Partial<LaneStaffedAgent> = {}): LaneStaffedAgent => ({
  agentRef: 'bob-dev', agentName: 'Bob Developer', declaredRole: 'Developer',
  model: null, position: 0, capableRoleKeys: ['developer'], ...over,
});

/** The workspace roster measured on project 11 — all built-in, none lane-staffed. */
const ROSTER: RoleCapableAgentRow[] = [
  { id: 'validator-t1', name: 'Validator', builtinKind: 'validator' },
  { id: 'product-manager-t1', name: 'Product Manager', builtinKind: 'product_manager' },
  { id: 'cto-t1', name: 'CTO', builtinKind: 'cto' },
  { id: 'designer-t1', name: 'Designer', builtinKind: 'designer' },
];
const ROSTER_DATA: RoleRosterData = { agents: ROSTER, pins: [] };
const PROJECT = 11;
const workspaceRoster = buildRoleRoster(ROSTER_DATA, PROJECT);

const inputs = (over: Partial<LaneAuthorityInputs> = {}): LaneAuthorityInputs => ({
  requirements: [], laneAgents: [], roster: workspaceRoster, ...over,
});

const roleRequirement = (ref: string) => ({ kind: 'role', ref, ticketType: null, condition: null });
const task = { taskType: 'task', actionType: null };

const someoneCapableOf = (roleKey: string): RoleCapableAgentRow | undefined =>
  ROSTER.find((a) => agentIsRoleCapable(a, roleKey));

/** The GUARD, as a pure function: is this ref in the oracle's answer for this role? */
const guardAccepts = (ref: string, roleKey: string): boolean =>
  roleCandidatesFrom(ROSTER_DATA, PROJECT, roleKey).some((c) => c.ref === ref);

describe('the guard and the selector must agree on who can work a stage', () => {
  /**
   * THE CONTRACT. This test was `it.fails` for one commit — the defect pinned, not fixed,
   * so the suite stayed honest while it was open. It is a plain `it` now, and it fails
   * the moment either side narrows again.
   *
   * The failure it pins: `decideLaneApprovers` tier (a) builds approvers from the lane's
   * requirement rows with `agentRef: null` by design, and `bindStaffedAgentsToRoles` —
   * the only thing that can fill that ref — consulted lane staffing alone. Only 3 of 61
   * auto-gated lanes carried any `swimlane_agent_assignments` row, so on 58 of them no
   * role could EVER bind, whatever the workspace roster held.
   */
  it('the selector can nominate an agent for any role the guard would accept', () => {
    const authority = decideManagedLaneAuthority(
      inputs({ requirements: [roleRequirement('business-analyst')], laneAgents: [] }),
      task,
    );

    // The stage authorises the role — the guard's first check passes.
    expect(authority.roleKeys).toContain('business-analyst');
    // A capable agent demonstrably exists — the guard's second check would pass too.
    expect(someoneCapableOf('business-analyst')).toBeDefined();

    // Therefore something IS dispatchable, and the guard accepts precisely it.
    const producer = pickManagedProducer(authority, []);
    expect(producer).not.toBeNull();
    expect(guardAccepts(producer!.agentRef, producer!.roleKey)).toBe(true);
  });

  /**
   * The same contract stated over the whole default lifecycle, which is what made it a
   * 447-ticket cohort rather than one ticket: every role the board can require is one the
   * roster can already fill, and not one of them was selectable.
   */
  it('every required role the roster can fill is selectable without lane staffing', () => {
    const required = ['business-analyst', 'product-owner', 'architect', 'validator', 'code-reviewer'];
    const fillable = required.filter((r) => someoneCapableOf(r));
    expect(fillable.length).toBeGreaterThan(0);

    const unselectable = fillable.filter((roleKey) => {
      const authority = decideManagedLaneAuthority(
        inputs({ requirements: [roleRequirement(roleKey)], laneAgents: [] }), task,
      );
      return pickManagedProducer(authority, []) === null;
    });
    expect(unselectable).toEqual([]);
  });

  /**
   * THE PROPERTY, over the ENTIRE role catalog rather than a chosen handful. For every
   * builtin role: if the guard would accept anybody, the selector must nominate somebody,
   * and the guard must accept exactly who it nominated.
   *
   * This is the assertion whose absence let the same asymmetry ship three times. It is
   * total, so it cannot be satisfied by widening one convenient case.
   */
  it.each(BUILTIN_ROLES.map((r) => r.key))('role %s: guard-acceptable ⇒ selector-nominable', (roleKey) => {
    const guardWouldAccept = roleCandidatesFrom(ROSTER_DATA, PROJECT, roleKey);
    const producer = pickManagedProducer(
      decideManagedLaneAuthority(inputs({ requirements: [roleRequirement(roleKey)] }), task),
      [],
    );
    if (guardWouldAccept.length === 0) {
      // Fail-closed is the honest verdict when nobody is capable — never a silent pick.
      expect(producer).toBeNull();
      return;
    }
    expect(producer).not.toBeNull();
    expect(guardAccepts(producer!.agentRef, producer!.roleKey)).toBe(true);
  });

  /**
   * A pin is the STRONGEST capability signal the oracle recognises, and the manager's
   * `staffUnfilledRole` remedy writes exactly that pin. It must reach the selector, or
   * the remedy is a no-op that reports success — which is what shipped: the ladder wrote
   * `project_role_assignments` rows into a table this path never read.
   */
  it('a project_role_assignments pin reaches the SELECTOR, not just the guard', () => {
    const pinned = buildRoleRoster({
      agents: ROSTER,
      pins: [{ projectId: PROJECT, roleKey: 'developer', assigneeRef: 'designer-t1', assigneeName: 'Designer' }],
    }, PROJECT);
    // The designer is NOT derivably capable of `developer` — only the pin grants it.
    expect(agentIsRoleCapable(ROSTER[3]!, 'developer')).toBe(false);

    const authority = decideManagedLaneAuthority(
      inputs({ requirements: [roleRequirement('developer')], roster: pinned }), task,
    );
    expect(pickManagedProducer(authority, [])).toMatchObject({
      roleKey: 'developer', agentRef: 'designer-t1', source: 'roster',
    });
  });

  it('binds nothing when the roster is empty, so an unstaffable stage still fails closed', () => {
    const approvers = decideManagedLaneAuthority(
      inputs({ requirements: [roleRequirement('business-analyst')], roster: EMPTY_ROLE_ROSTER }), task,
    ).approvers;
    expect(bindStaffedAgentsToRoles(approvers, [], EMPTY_ROLE_ROSTER)).toEqual(approvers);
    expect(approvers.every((a) => a.agentRef === null)).toBe(true);
  });
});

describe('lane staffing still wins when it exists (regression lock)', () => {
  it('binds a lane-staffed agent to a required role it is capable of', () => {
    const authority = decideManagedLaneAuthority(
      inputs({
        requirements: [roleRequirement('developer')],
        laneAgents: [laneAgent({ capableRoleKeys: ['developer'] })],
      }),
      task,
    );
    expect(pickManagedProducer(authority, [])).toMatchObject({
      roleKey: 'developer', agentRef: 'bob-dev', source: 'lane_agent',
    });
  });

  it('reaches past an incapable lane agent to the roster rather than mis-binding', () => {
    const authority = decideManagedLaneAuthority(
      inputs({
        requirements: [roleRequirement('architect')],
        laneAgents: [laneAgent({ capableRoleKeys: ['developer'] })],
      }),
      task,
    );
    // The lane's Developer must never be sent to do an Architect's stage; the CTO, whom
    // the guard accepts for `architect`, is picked instead.
    expect(authority.roleKeys).toContain('architect');
    expect(pickManagedProducer(authority, [])).toMatchObject({ roleKey: 'architect', agentRef: 'cto-t1' });
  });

  it('is honestly fail-closed when NOBODY — lane or roster — can act as the role', () => {
    const authority = decideManagedLaneAuthority(
      inputs({
        requirements: [roleRequirement('devops')],
        laneAgents: [laneAgent({ capableRoleKeys: ['developer'] })],
        roster: EMPTY_ROLE_ROSTER,
      }),
      task,
    );
    expect(authority.roleKeys).toContain('devops');
    expect(pickManagedProducer(authority, [])).toBeNull();
  });
});

describe('built-in agents cover the roles the default lifecycle requires', () => {
  /**
   * The config half of the same cohort. `BUILTIN_KIND_ROLE_KEYS` is an AUTHORITATIVE
   * boundary — `agentRoleKeys` returns early for any kind listed there and refuses to
   * widen by fuzzy match — so a missing entry is a silent capability LOSS, not a
   * conservative default.
   *
   * `cto`, `product_owner` and `manager` were seeded as built-in agents (migrations 0335,
   * 0376) and shipped for months with no entry, which is how a workspace could hold a CTO
   * whose declared skills begin with 'architecture' while the `architect` role resolved to
   * nobody at all.
   */
  it.each(['validator', 'security', 'product_manager', 'designer', 'incident_manager', 'cto', 'product_owner', 'manager'])(
    'built-in kind %s declares the roles it can act as',
    (kind) => {
      expect(BUILTIN_KIND_ROLE_KEYS[kind]).toBeDefined();
      expect(BUILTIN_KIND_ROLE_KEYS[kind]!.length).toBeGreaterThan(0);
    },
  );

  it('covers each role the default board requires with at least one built-in agent', () => {
    const lifecycleRoles = ['business-analyst', 'product-owner', 'architect', 'code-reviewer', 'validator', 'qa-tester'];
    const uncovered = lifecycleRoles.filter((r) => !someoneCapableOf(r));
    expect(uncovered).toEqual([]);
  });
});
