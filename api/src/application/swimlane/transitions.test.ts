import { describe, expect, it } from 'vitest';
import {
  VALID_TICKET_TRANSITIONS,
  canTransitionTicket,
  mapWorkflowStatusToTicketEvent,
  resolveSuccessfulStageTarget,
  type TicketLifecycle,
  type WorkflowStatus,
} from './transitions';

const ALL_STATES: TicketLifecycle[] = [
  'queued',
  'awaiting_gate',
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

describe('resolveSuccessfulStageTarget', () => {
  it('returns done when the lane is terminal regardless of gate/autonomy', () => {
    expect(resolveSuccessfulStageTarget({ isTerminalLane: true, gate: 'auto', boardAutonomous: true })).toBe('done');
    expect(resolveSuccessfulStageTarget({ isTerminalLane: true, gate: 'human', boardAutonomous: false })).toBe('done');
  });

  it('returns awaiting_gate when the lane has a human gate', () => {
    expect(resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'human', boardAutonomous: true })).toBe('awaiting_gate');
  });

  it('returns awaiting_gate on a non-autonomous board even with an auto gate', () => {
    expect(resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'auto', boardAutonomous: false })).toBe('awaiting_gate');
  });

  it('returns advancing only when autonomous AND auto gate AND non-terminal', () => {
    expect(resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'auto', boardAutonomous: true })).toBe('advancing');
  });

  it('every resolved target is a transition the lifecycle allows from stage_completed', () => {
    const targets = [
      resolveSuccessfulStageTarget({ isTerminalLane: true, gate: 'auto', boardAutonomous: true }),
      resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'human', boardAutonomous: true }),
      resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'auto', boardAutonomous: false }),
      resolveSuccessfulStageTarget({ isTerminalLane: false, gate: 'auto', boardAutonomous: true }),
    ];
    for (const t of targets) {
      expect(canTransitionTicket('stage_completed', t)).toBe(true);
    }
  });
});
