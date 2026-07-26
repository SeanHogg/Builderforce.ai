import { describe, it, expect } from 'vitest';
import {
  decideManagedLaneAuthority, pickManagedProducer,
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

describe('decideManagedLaneAuthority', () => {
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

  // The guard would refuse this dispatch, and a dispatch guaranteed to be refused is
  // exactly the loop the whole change exists to end.
  it('SKIPS a manifest slot whose role the stage does not authorise', () => {
    expect(pickManagedProducer(authority(['architect']), [slot({ roleKey: 'developer' })])).toBeNull();
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
