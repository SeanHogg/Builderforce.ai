import { describe, expect, it } from 'vitest';
import {
  VALID_TICKET_TRANSITIONS,
  canTransitionTicket,
  mapWorkflowStatusToTicketEvent,
  resolveStageAction,
  shouldSkipFailedStage,
  countLaneFailures,
  type TicketLifecycle,
  type WorkflowStatus,
} from './transitions';

describe('shouldSkipFailedStage [1316]', () => {
  it("only 'skip' on a non-terminal lane advances a failed stage", () => {
    expect(shouldSkipFailedStage('skip', false)).toBe(true);
    expect(shouldSkipFailedStage('skip', true)).toBe(false);  // terminal lane → park
    expect(shouldSkipFailedStage('needs_attention', false)).toBe(false);
    expect(shouldSkipFailedStage('retry', false)).toBe(false); // retry is handled separately
    expect(shouldSkipFailedStage(null, false)).toBe(false);
    expect(shouldSkipFailedStage(undefined, false)).toBe(false);
  });
});

describe('countLaneFailures [1316]', () => {
  const history = JSON.stringify([
    { swimlaneId: 'l0', status: 'failed' },
    { swimlaneId: 'l0', status: 'retry' },
    { swimlaneId: 'l0', status: 'failed' },
    { swimlaneId: 'l1', status: 'failed' },
    { swimlaneId: 'l0', status: 'completed' },
  ]);
  it('counts only the failed entries for the given lane', () => {
    expect(countLaneFailures(history, 'l0')).toBe(2);
    expect(countLaneFailures(history, 'l1')).toBe(1);
    expect(countLaneFailures(history, 'lX')).toBe(0);
  });
  it('returns 0 for empty/null/malformed history', () => {
    expect(countLaneFailures(null, 'l0')).toBe(0);
    expect(countLaneFailures('', 'l0')).toBe(0);
    expect(countLaneFailures('not json', 'l0')).toBe(0);
    expect(countLaneFailures(history, null)).toBe(0);
  });
});

const ALL_STATES: TicketLifecycle[] = [
  'queued',
  'awaiting_gate',
  'awaiting_workflow',
  'stage_running',
  'stage_completed',
  'advancing',
  'needs_attention',
  'done',
  'cancelled',
];

describe('VALID_TICKET_TRANSITIONS', () => {
  it('defines a row for every lifecycle state', () => {
    for (const s of ALL_STATES) {
      expect(VALID_TICKET_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('makes terminal states truly terminal (no outgoing transitions)', () => {
    expect(VALID_TICKET_TRANSITIONS.done).toEqual([]);
    expect(VALID_TICKET_TRANSITIONS.cancelled).toEqual([]);
  });

  it('only references known lifecycle states as targets', () => {
    for (const targets of Object.values(VALID_TICKET_TRANSITIONS)) {
      for (const t of targets) {
        expect(ALL_STATES).toContain(t);
      }
    }
  });
});

describe('canTransitionTicket', () => {
  it('allows queued -> stage_running and queued -> cancelled', () => {
    expect(canTransitionTicket('queued', 'stage_running')).toBe(true);
    expect(canTransitionTicket('queued', 'cancelled')).toBe(true);
  });

  it('rejects skipping straight from queued to done', () => {
    expect(canTransitionTicket('queued', 'done')).toBe(false);
  });

  it('allows the success path stage_running -> stage_completed -> advancing -> stage_running', () => {
    expect(canTransitionTicket('stage_running', 'stage_completed')).toBe(true);
    expect(canTransitionTicket('stage_completed', 'advancing')).toBe(true);
    expect(canTransitionTicket('advancing', 'stage_running')).toBe(true);
  });

  it('allows stage_completed -> done for a terminal lane', () => {
    expect(canTransitionTicket('stage_completed', 'done')).toBe(true);
  });

  it('allows the gate path stage_completed -> awaiting_gate -> advancing', () => {
    expect(canTransitionTicket('stage_completed', 'awaiting_gate')).toBe(true);
    expect(canTransitionTicket('awaiting_gate', 'advancing')).toBe(true);
  });

  it('allows the run_workflow gate path stage_completed -> awaiting_workflow -> advancing | done | needs_attention', () => {
    expect(canTransitionTicket('stage_completed', 'awaiting_workflow')).toBe(true);
    expect(canTransitionTicket('awaiting_workflow', 'advancing')).toBe(true);
    expect(canTransitionTicket('awaiting_workflow', 'done')).toBe(true);
    expect(canTransitionTicket('awaiting_workflow', 'needs_attention')).toBe(true);
  });

  it('allows recovery from needs_attention via retry (stage_running) or manual (advancing)', () => {
    expect(canTransitionTicket('needs_attention', 'stage_running')).toBe(true);
    expect(canTransitionTicket('needs_attention', 'advancing')).toBe(true);
  });

  it('forbids any transition out of done or cancelled', () => {
    for (const target of ALL_STATES) {
      expect(canTransitionTicket('done', target)).toBe(false);
      expect(canTransitionTicket('cancelled', target)).toBe(false);
    }
  });

  it('forbids stage_running -> done (must go through stage_completed)', () => {
    expect(canTransitionTicket('stage_running', 'done')).toBe(false);
  });
});

describe('mapWorkflowStatusToTicketEvent', () => {
  it('maps completed -> stage_completed and permits auto-advance', () => {
    const ev = mapWorkflowStatusToTicketEvent('completed');
    expect(ev.next).toBe('stage_completed');
    expect(ev.reason).toBe('autonomous');
    expect(ev.canAutoAdvance).toBe(true);
  });

  it('CRITICAL: maps failed -> needs_attention and NEVER auto-advances', () => {
    const ev = mapWorkflowStatusToTicketEvent('failed');
    expect(ev.next).toBe('needs_attention');
    expect(ev.reason).toBe('failed');
    expect(ev.canAutoAdvance).toBe(false);
  });

  it('maps cancelled -> cancelled with no auto-advance', () => {
    const ev = mapWorkflowStatusToTicketEvent('cancelled');
    expect(ev.next).toBe('cancelled');
    expect(ev.canAutoAdvance).toBe(false);
  });

  it('maps running/pending -> stage_running with no auto-advance', () => {
    for (const s of ['running', 'pending'] as WorkflowStatus[]) {
      const ev = mapWorkflowStatusToTicketEvent(s);
      expect(ev.next).toBe('stage_running');
      expect(ev.canAutoAdvance).toBe(false);
    }
  });

  it('no workflow status ever produces an auto-advancing failure', () => {
    const statuses: WorkflowStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
    for (const s of statuses) {
      const ev = mapWorkflowStatusToTicketEvent(s);
      if (ev.reason === 'failed') {
        expect(ev.canAutoAdvance).toBe(false);
        expect(ev.next).toBe('needs_attention');
      }
    }
  });
});

describe('resolveStageAction', () => {
  const base = { isTerminalLane: false, gate: 'auto', actionType: null, actionTarget: null };

  it('human gate wins: awaiting_gate even on a terminal lane or with an action', () => {
    expect(resolveStageAction({ ...base, gate: 'human' }).lifecycle).toBe('awaiting_gate');
    expect(resolveStageAction({ ...base, gate: 'human', isTerminalLane: true }).lifecycle).toBe('awaiting_gate');
    expect(resolveStageAction({ ...base, gate: 'human', actionType: 'move_ticket', actionTarget: 'x' }).lifecycle).toBe('awaiting_gate');
  });

  it('terminal lane (auto gate) → done', () => {
    expect(resolveStageAction({ ...base, isTerminalLane: true }).lifecycle).toBe('done');
  });

  it('default / advance action → advancing with no move/workflow target', () => {
    const plan = resolveStageAction(base);
    expect(plan.lifecycle).toBe('advancing');
    expect(plan.moveToLaneKey).toBeUndefined();
    expect(plan.runWorkflowId).toBeFalsy();
  });

  it('move_ticket → advancing toward the named lane key', () => {
    const plan = resolveStageAction({ ...base, actionType: 'move_ticket', actionTarget: 'done-lane' });
    expect(plan.lifecycle).toBe('advancing');
    expect(plan.moveToLaneKey).toBe('done-lane');
  });

  it('run_workflow → advancing plus the workflow id side-effect', () => {
    const plan = resolveStageAction({ ...base, actionType: 'run_workflow', actionTarget: 'wf-1' });
    expect(plan.lifecycle).toBe('advancing');
    expect(plan.runWorkflowId).toBe('wf-1');
  });

  it('do_nothing → stage_completed: ticket rests in its lane, no move/workflow target', () => {
    const plan = resolveStageAction({ ...base, actionType: 'do_nothing' });
    expect(plan.lifecycle).toBe('stage_completed');
    expect(plan.moveToLaneKey).toBeUndefined();
    expect(plan.runWorkflowId).toBeUndefined();
    // Even on a terminal lane, do_nothing stays put rather than auto-completing.
    expect(resolveStageAction({ ...base, isTerminalLane: true, actionType: 'do_nothing' }).lifecycle).toBe('stage_completed');
    // The coordinator reaches it directly from stage_running (no stage_completed intermediate).
    expect(canTransitionTicket('stage_running', plan.lifecycle)).toBe(true);
  });

  it('every resolved lifecycle is a transition the lifecycle allows from stage_completed', () => {
    const plans = [
      resolveStageAction({ ...base, isTerminalLane: true }),
      resolveStageAction({ ...base, gate: 'human' }),
      resolveStageAction(base),
      resolveStageAction({ ...base, actionType: 'move_ticket', actionTarget: 'x' }),
    ];
    for (const p of plans) {
      expect(canTransitionTicket('stage_completed', p.lifecycle)).toBe(true);
    }
  });
});
