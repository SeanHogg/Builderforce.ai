import { describe, it, expect } from 'vitest';
import { pickSignoffCandidate } from './driveSignoffs';
import { classifySignoffOwnership, type OutstandingSlot } from './signoffGate';

const slot = (over: Partial<OutstandingSlot> = {}): OutstandingSlot => ({
  roleKey: 'architect', roleName: 'Architect', stageKey: 'in_review', state: 'assigned',
  assigneeName: 'Arch Agent', assigneeRef: 'agent-1', assigneeKind: 'agent', ...over,
});

const pick = (slots: OutstandingSlot[]) => pickSignoffCandidate(classifySignoffOwnership(slots));

describe('pickSignoffCandidate', () => {
  it('asks a role nobody has asked yet before re-asking one already dispatched', () => {
    // The bug this encodes: `in_progress` means "already asked and still unanswered",
    // and such a slot stays OUTSTANDING. Taking the first outstanding slot therefore
    // re-asked one role forever while the other nine were never asked once — a 10-slot
    // gate that no number of passes could satisfy.
    const chosen = pick([
      slot({ roleKey: 'architect', state: 'in_progress' }),
      slot({ roleKey: 'developer', roleName: 'Developer', state: 'assigned', assigneeRef: 'agent-2' }),
    ]);
    expect(chosen?.roleKey).toBe('developer');
  });

  it('falls back to re-asking once every agent-owed slot has had its turn', () => {
    const chosen = pick([
      slot({ roleKey: 'architect', state: 'in_progress' }),
      slot({ roleKey: 'developer', roleName: 'Developer', state: 'in_progress', assigneeRef: 'agent-2' }),
    ]);
    expect(chosen?.roleKey).toBe('architect');
  });

  it('never picks a slot the manager cannot dispatch', () => {
    expect(pick([
      slot({ assigneeKind: 'human', assigneeRef: 'u:sean' }),
      slot({ roleKey: 'qa-tester', assigneeKind: null, assigneeRef: null }),
    ])).toBeNull();
    expect(pick([])).toBeNull();
  });
});
