import { describe, it, expect } from 'vitest';
import {
  bindStaffedAgentsToRoles, decideManagedLaneAuthority, pickManagedProducer,
  type LaneAuthorityInputs, type ManagedLaneAuthority, type ManagedProducerSlot,
} from './managedLaneRoles';
import type { LaneStaffedAgent } from '../swimlane/laneApprover';

/**
 * THE MEASURED FAILURE these guard against.
 *
 * A lifecycle-managed board refuses any dispatch whose payload carries no role. The lane
 * trigger never produced one, so on a managed board NOTHING could auto-run: the dispatcher
 * threw, the throw preceded the execution row so no failure was counted, the breaker never
 * engaged, and the refusal repeated every sweep forever. Project 11, task 1032 — a manager
 * systemic-finding ticket — was refused two seconds after it was filed.
 *
 * This module is the shared answer both sides now read: which roles a stage authorises,
 * and who can act as one.
 */

const agent = (over: Partial<LaneStaffedAgent> = {}): LaneStaffedAgent => ({
  agentRef: 'bob-dev',
  agentName: 'Bob Developer',
  declaredRole: 'Developer',
  model: null,
  position: 0,
  capableRoleKeys: ['developer'],
  ...over,
});

const inputs = (over: Partial<LaneAuthorityInputs> = {}): LaneAuthorityInputs => ({
  requirements: [],
  laneAgents: [],
  ...over,
});

/**
 * THE SECOND MEASURED FAILURE — the one that survived the first fix.
 *
 * `decideLaneApprovers` answers "who must APPROVE this lane?" and leaves `agentRef` null
 * on tier (a) by design. Execution asks "who may ACT AS this required role?", and reading
 * the first answer as the second meant a templated lane could never produce an agent. On
 * project 11 that was 405 of 675 stalled tickets — the largest cohort on the board — every
 * one of them on a stage that DID declare a required role and a lane that WAS staffed with
 * an agent capable of it.
 */
describe('bindStaffedAgentsToRoles', () => {
  const approver = (roleKey: string) =>
    ({ roleKey, roleName: roleKey, agentRef: null, agentName: null, model: null });

  it('gives a required role the lane agent capable of it — the 405-ticket cohort', () => {
    const [bound] = bindStaffedAgentsToRoles([approver('developer')], [agent()]);
    expect(bound?.agentRef).toBe('bob-dev');
  });

  it('leaves a role nobody on the lane is capable of UNBOUND rather than mis-binding it', () => {
    const [bound] = bindStaffedAgentsToRoles([approver('architect')], [agent()]);
    expect(bound?.agentRef).toBeNull();
  });

  it('never overwrites an agent the approver decision already resolved (tier b)', () => {
    const staffed = { ...approver('developer'), agentRef: 'already-picked' };
    const [bound] = bindStaffedAgentsToRoles([staffed], [agent({ agentRef: 'someone-else' })]);
    expect(bound?.agentRef).toBe('already-picked');
  });

  it('prefers the agent whose DECLARED assignment role names this role over one merely capable', () => {
    const [bound] = bindStaffedAgentsToRoles([approver('developer')], [
      agent({ agentRef: 'generalist', declaredRole: 'Architect', capableRoleKeys: ['developer', 'architect'], position: 0 }),
      agent({ agentRef: 'bob-dev', declaredRole: 'Developer', capableRoleKeys: ['developer'], position: 1 }),
    ]);
    expect(bound?.agentRef).toBe('bob-dev');
  });

  it('falls back to lane position when no declared role matches', () => {
    const [bound] = bindStaffedAgentsToRoles([approver('developer')], [
      agent({ agentRef: 'second', declaredRole: null, position: 2 }),
      agent({ agentRef: 'first', declaredRole: null, position: 1 }),
    ]);
    expect(bound?.agentRef).toBe('first');
  });

  it('lets ONE agent serve several required roles — unlike approver resolution, which dedupes', () => {
    const bound = bindStaffedAgentsToRoles(
      [approver('developer'), approver('code-reviewer')],
      [agent({ capableRoleKeys: ['developer', 'code-reviewer'] })],
    );
    expect(bound.map((b) => b.agentRef)).toEqual(['bob-dev', 'bob-dev']);
  });

  it('is a no-op on an unstaffed lane, so an unstaffed stage still fails closed', () => {
    expect(bindStaffedAgentsToRoles([approver('developer')], [])).toEqual([approver('developer')]);
  });
});

describe('decideManagedLaneAuthority', () => {
  // The regression that matters: authority came back with roles but no agent, so
  // `pickManagedProducer` returned null and the ticket classified `managed_no_role`.
  it('binds staffing to requirement roles WITHOUT widening the authorised role set', () => {
    const a = decideManagedLaneAuthority(inputs({
      requirements: [{ kind: 'role', ref: 'developer', ticketType: null, condition: null }],
      laneAgents: [agent(), agent({ agentRef: 'ada', declaredRole: 'Architect', capableRoleKeys: ['architect'], position: 1 })],
    }), {});
    // Staffing an Architect on the lane must NOT authorise the architect role…
    expect(a.roleKeys).toEqual(['developer']);
    expect(a.tier).toBe('requirements');
    // …but the required Developer role is now dispatchable.
    expect(a.approvers[0]?.agentRef).toBe('bob-dev');
    expect(pickManagedProducer(a, [])).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev' });
  });

  it('authorises the stage\'s applicable requirement roles', () => {
    const a = decideManagedLaneAuthority(inputs({
      requirements: [
        { kind: 'role', ref: 'business-analyst', ticketType: null, condition: null },
        { kind: 'review', ref: 'architect', ticketType: null, condition: null },
      ],
    }), { taskType: 'task', actionType: null });

    expect(a.tier).toBe('requirements');
    expect(a.roleKeys).toEqual(['business-analyst', 'architect']);
  });

  it('scopes requirements to the ticket — a security-only role does not authorise a docs ticket', () => {
    const a = decideManagedLaneAuthority(inputs({
      requirements: [{ kind: 'role', ref: 'security', ticketType: null, condition: 'is_security' }],
      laneAgents: [],
    }), { taskType: 'docs', actionType: null });

    expect(a.roleKeys).toEqual([]);
  });

  // The rule `decideLaneApprovers` documents, restated at THIS layer because the guard and
  // the dispatcher both read it here: a requirement that does not apply must not suppress
  // the staffing tier, or a lane with one security requirement would be dead for every
  // non-security ticket.
  it('falls through to lane STAFFING when no requirement applies to this ticket', () => {
    const a = decideManagedLaneAuthority(inputs({
      requirements: [{ kind: 'role', ref: 'security', ticketType: null, condition: 'is_security' }],
      laneAgents: [agent()],
    }), { taskType: 'task', actionType: null });

    expect(a.tier).toBe('lane_agents');
    expect(a.roleKeys).toEqual(['developer']);
    expect(a.approvers[0]?.agentRef).toBe('bob-dev');
  });

  it('authorises NOTHING when the lane is unstaffed and declares no requirement — fail closed', () => {
    const a = decideManagedLaneAuthority(inputs(), { taskType: 'task', actionType: null });
    expect(a.tier).toBe('none');
    expect(a.roleKeys).toEqual([]);
  });
});

describe('pickManagedProducer', () => {
  const authority = (roleKeys: string[], approvers: ManagedLaneAuthority['approvers'] = []): ManagedLaneAuthority =>
    ({ roleKeys, approvers, tier: approvers.length ? 'lane_agents' : 'requirements' });

  const slot = (over: Partial<ManagedProducerSlot> = {}): ManagedProducerSlot => ({
    roleKey: 'developer',
    responsibility: 'owner',
    state: 'assigned',
    assigneeKind: 'agent',
    assigneeRef: 'bob-dev',
    ...over,
  });

  it('prefers the ticket\'s OWN manifest slot — the Coordinator\'s recorded intent', () => {
    const p = pickManagedProducer(authority(['developer']), [slot()]);
    expect(p).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest' });
  });

  it('lets an open required manifest slot authorize its producer when the lane template is empty', () => {
    const p = pickManagedProducer(authority([]), [slot()]);
    expect(p).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest' });
  });

  // Ticket-specific lifecycle authority outranks the generic lane template. The guard
  // applies this same rule through `slotAuthorizesRole`.
  it('accepts an open manifest slot whose role is absent from the lane template', () => {
    expect(pickManagedProducer(authority(['architect']), [slot({ roleKey: 'developer' })]))
      .toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest' });
  });

  it('never picks a reviewer slot — a reviewer is not the stage producer', () => {
    expect(pickManagedProducer(authority(['developer']), [slot({ responsibility: 'reviewer' })])).toBeNull();
  });

  it('skips a slot whose work is finished, waived or skipped, and re-picks changes_requested', () => {
    for (const state of ['completed', 'waived', 'skipped']) {
      expect(pickManagedProducer(authority(['developer']), [slot({ state })]), state).toBeNull();
    }
    expect(pickManagedProducer(authority(['developer']), [slot({ state: 'changes_requested' })])?.agentRef).toBe('bob-dev');
  });

  it('ignores a human or unresolved slot — a managed run is dispatched to an AGENT', () => {
    expect(pickManagedProducer(authority(['developer']), [slot({ assigneeKind: 'human' })])).toBeNull();
    expect(pickManagedProducer(authority(['developer']), [slot({ assigneeRef: null })])).toBeNull();
  });

  it('falls back to the lane\'s staffed approver when the manifest resolves nothing', () => {
    const a = authority(['developer'], [
      { roleKey: 'developer', roleName: 'Developer', agentRef: 'bob-dev', agentName: 'Bob', model: 'x' },
    ]);
    expect(pickManagedProducer(a, [])).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev', source: 'lane_agent', model: 'x' });
  });

  // Requirement order lists the reviewer first on plenty of real templates, and binding
  // agents to required roles made both of them dispatchable — so the tiebreak now matters.
  // Sending a Code Reviewer to write the code it is meant to judge is a run that can
  // neither succeed nor be reviewed.
  it('prefers a PRODUCING role over a reviewing one, whatever order they are authorised in', () => {
    const a = authority(['code-reviewer', 'developer'], [
      { roleKey: 'code-reviewer', roleName: 'Code Reviewer', agentRef: 'validator-t1', agentName: 'Validator', model: null },
      { roleKey: 'developer', roleName: 'Developer', agentRef: 'bob-dev', agentName: 'Bob', model: null },
    ]);
    expect(pickManagedProducer(a, [])).toMatchObject({ roleKey: 'developer', agentRef: 'bob-dev' });
  });

  it('still dispatches a review-only stage rather than stalling it', () => {
    const a = authority(['code-reviewer'], [
      { roleKey: 'code-reviewer', roleName: 'Code Reviewer', agentRef: 'validator-t1', agentName: 'Validator', model: null },
    ]);
    expect(pickManagedProducer(a, [])).toMatchObject({ roleKey: 'code-reviewer', agentRef: 'validator-t1' });
  });

  // The `managed_no_role` leaf. Returning null here is what stops the trigger from
  // building a payload the dispatcher must refuse.
  it('is null when nothing resolves — which the evaluator reports as managed_no_role', () => {
    expect(pickManagedProducer(authority([]), [])).toBeNull();
    expect(pickManagedProducer(authority(['developer']), [])).toBeNull();
  });

  it('prefers the first OPEN authorised producer when several slots exist', () => {
    const rows = [
      slot({ responsibility: 'reviewer', assigneeRef: 'validator-t1', roleKey: 'code-reviewer' }),
      slot({ state: 'completed', assigneeRef: 'kevin-pm', roleKey: 'product-owner' }),
      slot({ assigneeRef: 'bob-dev', roleKey: 'developer' }),
    ];
    expect(pickManagedProducer(authority(['code-reviewer', 'product-owner', 'developer']), rows)?.agentRef).toBe('bob-dev');
  });
});
