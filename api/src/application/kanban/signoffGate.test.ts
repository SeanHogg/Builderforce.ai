import { describe, it, expect } from 'vitest';
import {
  classifySignoffOwnership, decideSignoffGate, describeSignoffOwnership, slotsForStage,
  resolveRequiredSignoffGate, SIGNOFF_NOT_REQUIRED,
  type OutstandingSlot,
} from './signoffGate';
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

describe('classifySignoffOwnership — who actually owes the sign-off', () => {
  const out = (over: Partial<OutstandingSlot> = {}): OutstandingSlot => ({
    roleKey: 'architect', roleName: 'Architect', stageKey: 'in_review', state: 'assigned',
    responsibility: 'reviewer',
    assigneeName: 'Arch Agent', assigneeRef: 'agent-9', assigneeKind: 'agent', ...over,
  });

  it('splits agent-owed, human-owed and nobody-owed slots', () => {
    const o = classifySignoffOwnership([
      out(),
      out({ roleKey: 'product-owner', roleName: 'Product Owner', assigneeKind: 'human', assigneeRef: 'u:sean', assigneeName: 'Sean' }),
      out({ roleKey: 'qa-tester', roleName: 'QA / Tester', assigneeKind: null, assigneeRef: null, assigneeName: null }),
    ]);
    expect(o.dispatchable.map((s) => s.roleKey)).toEqual(['architect']);
    expect(o.humanOwed.map((s) => s.roleKey)).toEqual(['product-owner']);
    expect(o.unstaffed.map((s) => s.roleKey)).toEqual(['qa-tester']);
  });

  it('treats a slot with NO assignee ref as unstaffed even when its state says "assigned"', () => {
    // The exact shape behind "the manager says awaiting sign-off but nobody is on the
    // ticket": a stale state column must never imply someone is working the slot.
    const o = classifySignoffOwnership([out({ state: 'assigned', assigneeRef: null, assigneeKind: 'agent' })]);
    expect(o.dispatchable).toHaveLength(0);
    expect(o.unstaffed).toHaveLength(1);
  });

  it('says nothing when an agent CAN be asked — the caller reports what it asked', () => {
    expect(describeSignoffOwnership(classifySignoffOwnership([out()]))).toBe('');
  });

  it('names the blocker, the roles and the people when no agent can clear it', () => {
    const detail = describeSignoffOwnership(classifySignoffOwnership([
      out({ assigneeKind: null, assigneeRef: null, assigneeName: null }),
      out({ roleKey: 'product-owner', roleName: 'Product Owner', assigneeKind: 'human', assigneeRef: 'u:sean', assigneeName: 'Sean' }),
    ]));
    expect(detail).toContain('1 with nobody assigned (Architect)');
    expect(detail).toContain('1 owed by a person (Product Owner → Sean)');
  });
});

describe('slotsForStage — scoping the ASK to the lane the ticket is on', () => {
  const at = (stageKey: string | null, roleKey: string): OutstandingSlot => ({
    roleKey, roleName: roleKey, stageKey, state: 'assigned', responsibility: 'reviewer',
    assigneeName: 'Bot', assigneeRef: 'agent-1', assigneeKind: 'agent',
  });

  /**
   * The completion gate must see EVERY stage (or a ticket completes with earlier stages
   * unsigned); the ASK must see only the current one (or a Requirements-stage ticket
   * would be sent to its QA reviewer). Same manifest, two questions.
   */
  it('keeps the current stage and drops later ones', () => {
    const scoped = slotsForStage(
      [at('requirements', 'business-analyst'), at('in_review', 'qa-tester'), at('design', 'architect')],
      'requirements',
    );
    expect(scoped.map((s) => s.roleKey)).toEqual(['business-analyst']);
  });

  it('always keeps a stage-less slot — it belongs to the ticket, not to a lane', () => {
    const scoped = slotsForStage([at(null, 'product-owner'), at('in_review', 'qa-tester')], 'requirements');
    expect(scoped.map((s) => s.roleKey)).toEqual(['product-owner']);
  });
});

/**
 * THE PROJECT SETTING (0380). `requireSignoffToComplete` is what the whole premise turns
 * on — "other team members sign off, so the work is actually reviewed" is a practice a
 * project chooses, and before this read existed only the conduct step and the merge
 * consulted it. Stall triage did not, so a project with sign-off OFF still had its
 * tickets diagnosed `awaiting_signoff` and its dispatch budget spent re-asking for
 * verdicts nobody owed (265 of 679 stalled tickets on the reference board).
 *
 * These tests pin the two properties that keep that from recurring: the gate OPENS when
 * the project does not require sign-off, and it does so WITHOUT touching the manifest —
 * so no manifest state, however broken, can put a ticket back into the loop.
 */
describe('resolveRequiredSignoffGate — the project setting is the gate', () => {
  /** Any read of the manifest would throw, proving none happened. */
  const explodingDb = new Proxy({}, {
    get() { throw new Error('the manifest must not be read when sign-off is not required'); },
  }) as never;

  it('opens, owing nothing, when the project does not require sign-off', async () => {
    const gate = await resolveRequiredSignoffGate({} as never, explodingDb, {
      tenantId: 1, taskId: 42, requireSignoff: false,
    });
    expect(gate.satisfied).toBe(true);
    expect(gate.reason).toBe('not_required');
    expect(gate.outstanding).toEqual([]);
    expect(gate.requiredCount).toBe(0);
  });

  it('reports a reason distinct from all_signed_off — "nobody asked" is not "all approved"', () => {
    // Both open the gate; only one means the work was reviewed. A ledger that conflates
    // them cannot answer "was this merged unreviewed?" after the fact.
    expect(SIGNOFF_NOT_REQUIRED.reason).not.toBe('all_signed_off');
    expect(SIGNOFF_NOT_REQUIRED.satisfied).toBe(true);
  });

  it('still evaluates the manifest when the project DOES require sign-off', async () => {
    // The opt-in path is unchanged: it reads, and an unreadable manifest fails closed.
    const gate = await resolveRequiredSignoffGate({} as never, explodingDb, {
      tenantId: 1, taskId: 42, requireSignoff: true,
    });
    expect(gate.satisfied).toBe(false);
    expect(gate.detail).toContain('Could not read the ticket participation manifest');
  });
});
