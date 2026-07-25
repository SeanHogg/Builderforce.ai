import { describe, it, expect } from 'vitest';
import { decideSignoffGate } from './signoffGate';
import {
  SATISFIED_PARTICIPANT_STATES, OPEN_PARTICIPANT_STATES,
  isParticipantSatisfied, isParticipantOpen, blocksCompletion,
} from './participantStates';
import type { ManifestParticipant, ParticipantState } from './ticketParticipants';

/**
 * This gate is the ONLY thing standing between an AI Manager and a squash-merge of
 * unreviewed work — before it existed the manager force-completed in-review tickets and
 * merged them with no manifest check at all. So the tests below are deliberately
 * paranoid about the ways it could wrongly open.
 */

function slot(over: Partial<ManifestParticipant> = {}): ManifestParticipant {
  return {
    id: 'p1',
    stageKey: 'in_review',
    roleKey: 'developer',
    roleName: 'Developer',
    responsibility: 'owner',
    required: true,
    source: 'template',
    assigneeKind: 'agent',
    assigneeRef: 'agent-1',
    assigneeName: 'Dev Agent',
    state: 'completed',
    signoffId: 's1',
    childTaskId: null,
    evidence: null,
    note: null,
    ...over,
  };
}

describe('decideSignoffGate', () => {
  it('opens only when every required slot is satisfied', () => {
    const g = decideSignoffGate([
      slot({ roleKey: 'developer', state: 'completed' }),
      slot({ roleKey: 'qa', roleName: 'QA', state: 'completed' }),
    ]);
    expect(g.satisfied).toBe(true);
    expect(g.reason).toBe('all_signed_off');
    expect(g.requiredCount).toBe(2);
    expect(g.satisfiedCount).toBe(2);
    expect(g.outstanding).toEqual([]);
  });

  it('FAILS CLOSED on an empty manifest — nobody reviewed is not everybody approved', () => {
    // The critical case. "All required slots satisfied" is vacuously TRUE for zero
    // slots, which would make an unreviewed ticket the EASIEST thing to auto-merge.
    const g = decideSignoffGate([]);
    expect(g.satisfied).toBe(false);
    expect(g.reason).toBe('no_required_participants');
    expect(g.detail).toContain('no agent has signed off');
  });

  it('FAILS CLOSED when the manifest holds only OPTIONAL slots, however complete', () => {
    // Same vacuous-truth trap one level down: filtering to `required` must not leave an
    // empty set that then reads as unanimity.
    const g = decideSignoffGate([
      slot({ required: false, state: 'completed' }),
      slot({ required: false, roleKey: 'qa', state: 'completed' }),
    ]);
    expect(g.satisfied).toBe(false);
    expect(g.reason).toBe('no_required_participants');
  });

  it('holds when any required slot still owes a verdict, and names who', () => {
    const g = decideSignoffGate([
      slot({ roleKey: 'developer', state: 'completed' }),
      slot({ roleKey: 'qa', roleName: 'QA Engineer', state: 'pending' }),
    ]);
    expect(g.satisfied).toBe(false);
    expect(g.reason).toBe('outstanding_signoffs');
    expect(g.satisfiedCount).toBe(1);
    expect(g.outstanding.map((o) => o.roleName)).toEqual(['QA Engineer']);
    expect(g.detail).toContain('QA Engineer');
    expect(g.detail).toContain('1 of 2');
  });

  it('treats an UNSTAFFED required slot as blocking — no agent must not mean approved', () => {
    // `unstaffed` is excluded from OPEN_PARTICIPANT_STATES (nothing to dispatch), so a
    // gate built on that set would have silently ignored it and merged.
    const g = decideSignoffGate([
      slot({ roleKey: 'developer', state: 'completed' }),
      slot({ roleKey: 'security', roleName: 'Security', state: 'unstaffed', assigneeRef: null, assigneeName: null }),
    ]);
    expect(g.satisfied).toBe(false);
    expect(g.outstanding.map((o) => o.roleKey)).toEqual(['security']);
  });

  it('treats changes_requested as blocking', () => {
    const g = decideSignoffGate([slot({ state: 'changes_requested' })]);
    expect(g.satisfied).toBe(false);
    expect(g.outstanding[0]?.state).toBe('changes_requested');
  });

  it.each(['pending', 'assigned', 'in_progress', 'changes_requested', 'unstaffed'] as ParticipantState[])(
    'holds the gate for a required slot in state %s',
    (state) => {
      expect(decideSignoffGate([slot({ state })]).satisfied).toBe(false);
    },
  );

  it.each(['completed', 'waived', 'skipped'] as ParticipantState[])(
    'opens the gate for a required slot in state %s',
    (state) => {
      // waived/skipped are RECORDED, reasoned decisions (the sign-off route demands a
      // reason to waive), so they satisfy — otherwise a template role the project does
      // not use would deadlock every ticket forever.
      expect(decideSignoffGate([slot({ state })]).satisfied).toBe(true);
    },
  );

  it('ignores optional slots when required ones are all satisfied', () => {
    const g = decideSignoffGate([
      slot({ roleKey: 'developer', state: 'completed' }),
      slot({ roleKey: 'designer', required: false, state: 'pending' }),
    ]);
    expect(g.satisfied).toBe(true);
    expect(g.requiredCount).toBe(1);
  });

  it('carries the assignee so the UI can say who is being waited on', () => {
    const g = decideSignoffGate([
      slot({ roleKey: 'qa', state: 'assigned', assigneeName: 'QA Bot', assigneeRef: 'agent-9', assigneeKind: 'agent' }),
    ]);
    expect(g.outstanding[0]).toMatchObject({ assigneeName: 'QA Bot', assigneeRef: 'agent-9', assigneeKind: 'agent' });
  });

  it('singularizes the detail sentence for exactly one required role', () => {
    expect(decideSignoffGate([slot({ state: 'completed' })]).detail).toContain('1 required role signed off');
  });
});

describe('participantStates — the shared classification', () => {
  it('partitions the 8 states so satisfied and open never overlap', () => {
    for (const s of SATISFIED_PARTICIPANT_STATES) expect(OPEN_PARTICIPANT_STATES.has(s)).toBe(false);
    for (const s of OPEN_PARTICIPANT_STATES) expect(SATISFIED_PARTICIPANT_STATES.has(s)).toBe(false);
  });

  it('leaves `unstaffed` in NEITHER set — the asymmetry the gate depends on', () => {
    // Not open (nothing to dispatch) but not satisfied (nobody approved). Any refactor
    // that "tidies" it into one of the sets breaks either dispatch or the merge gate.
    expect(isParticipantOpen('unstaffed')).toBe(false);
    expect(isParticipantSatisfied('unstaffed')).toBe(false);
    expect(blocksCompletion({ required: true, state: 'unstaffed' })).toBe(true);
  });

  it('blocksCompletion ignores optional slots regardless of state', () => {
    expect(blocksCompletion({ required: false, state: 'pending' })).toBe(false);
    expect(blocksCompletion({ required: true, state: 'pending' })).toBe(true);
  });

  it('tolerates an unknown state string without claiming it is satisfied', () => {
    expect(isParticipantSatisfied('some_future_state')).toBe(false);
    expect(blocksCompletion({ required: true, state: 'some_future_state' })).toBe(true);
  });
});
