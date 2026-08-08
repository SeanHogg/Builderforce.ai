import { describe, expect, it } from 'vitest';
import {
  StakeholderMapService,
  StakeholderSignOff,
  SignOffState,
  SignOffAction,
  type StakeholderSubmission,
  type ConflictDetectionResult,
} from './StakeholderMapService';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const service = new StakeholderMapService();

const NOW = new Date('2026-07-12T12:00:00Z');
const hour = 3_600_000;
const sub = (over: Partial<StakeholderSubmission> = {}): StakeholderSubmission => ({
  stakeholderId: 'stake-a',
  teamId: 'team-1',
  p0Priority: 'Revenue Growth',
  submittedAt: new Date(NOW.getTime() - hour),
  ...over,
});

// ---------------------------------------------------------------------------
// Conflict Detection
// ---------------------------------------------------------------------------

describe('StakeholderMapService.detectConflicts', () => {
  const window = {
    reviewWindowStart: new Date(NOW.getTime() - 24 * hour),
    reviewWindowEnd: new Date(NOW.getTime() + 24 * hour),
  };

  it('returns hasConflict:true when two stakeholders submit different P0s for the same team inside the window', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth' }),
        sub({ stakeholderId: 'stake-b', p0Priority: 'User Acquisition' }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].priorities).toEqual(
      expect.arrayContaining(['Revenue Growth', 'User Acquisition']),
    );
  });

  it('returns hasConflict:false when two stakeholders submit the SAME P0', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth' }),
        sub({ stakeholderId: 'stake-b', p0Priority: 'Revenue Growth' }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('returns hasConflict:false when only one stakeholder submits', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth' })],
      ...window,
    });

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('ignores submissions outside the review window', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth' }),
        sub({
          stakeholderId: 'stake-b',
          p0Priority: 'User Acquisition',
          submittedAt: new Date(NOW.getTime() - 26 * hour), // before window
        }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(false);
  });

  it('scopes to the requested team only', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', teamId: 'team-1', p0Priority: 'Revenue Growth' }),
        sub({ stakeholderId: 'stake-b', teamId: 'team-2', p0Priority: 'User Acquisition' }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(false);
  });

  it('picks the LATEST submission per stakeholder when a stakeholder submits more than once', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', p0Priority: 'Old P0', submittedAt: new Date(NOW.getTime() - 2 * hour) }),
        sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth', submittedAt: new Date(NOW.getTime() - 1 * hour) }),
        sub({ stakeholderId: 'stake-b', p0Priority: 'User Acquisition' }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(true);
    // stake-a's "Old P0" was superseded by "Revenue Growth"
    const p0s = result.conflicts.flatMap((c) => c.priorities);
    expect(p0s).not.toContain('Old P0');
  });

  it('detects multi-way conflict when three stakeholders each have a different P0', () => {
    const result = service.detectConflicts({
      teamId: 'team-1',
      submissions: [
        sub({ stakeholderId: 'stake-a', p0Priority: 'Revenue Growth' }),
        sub({ stakeholderId: 'stake-b', p0Priority: 'User Acquisition' }),
        sub({ stakeholderId: 'stake-c', p0Priority: 'Infrastructure' }),
      ],
      ...window,
    });

    expect(result.hasConflict).toBe(true);
    // 3 distinct P0s → 3 choose 2 = 3 conflict pairs
    expect(result.conflicts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Sign-Off State Machine
// ---------------------------------------------------------------------------

describe('StakeholderSignOff state machine', () => {
  it('starts in Pending', () => {
    const so = service.createSignOff('map-1');
    expect(so.state).toBe(SignOffState.Pending);
    expect(so.history).toEqual([]);
  });

  describe('approve()', () => {
    it('Pending + approve() → Approved', () => {
      const so = service.createSignOff('map-1');
      const esc = so.approve();
      expect(so.state).toBe(SignOffState.Approved);
      expect(esc).toBeNull();
    });

    it('records an audit trail entry with actorId', () => {
      const so = service.createSignOff('map-1');
      so.approve('user-1');
      expect(so.history).toHaveLength(1);
      const t = so.history[0];
      expect(t.from).toBe(SignOffState.Pending);
      expect(t.to).toBe(SignOffState.Approved);
      expect(t.action).toBe(SignOffAction.Approve);
      expect(t.actorId).toBe('user-1');
      expect(t.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('approveWithComment()', () => {
    it('Pending + approveWithComment("looks good") → ApprovedWithComment, comment stored', () => {
      const so = service.createSignOff('map-1');
      const esc = so.approveWithComment('looks good');
      expect(so.state).toBe(SignOffState.ApprovedWithComment);
      expect(so.comment).toBe('looks good');
      expect(esc).toBeNull();
    });

    it('trims the comment', () => {
      const so = service.createSignOff('map-1');
      so.approveWithComment('  looks good  ');
      expect(so.comment).toBe('looks good');
    });

    it('rejects an empty comment', () => {
      const so = service.createSignOff('map-1');
      expect(() => so.approveWithComment('   ')).toThrow('Comment is required');
    });

    it('records the comment in the audit trail', () => {
      const so = service.createSignOff('map-1');
      so.approveWithComment('looks good', 'user-2');
      expect(so.history[0].comment).toBe('looks good');
      expect(so.history[0].actorId).toBe('user-2');
    });
  });

  describe('block()', () => {
    it('Pending + block() → Blocked, escalation event returned', () => {
      const so = service.createSignOff('map-1');
      const esc = so.block();
      expect(so.state).toBe(SignOffState.Blocked);
      expect(esc).not.toBeNull();
      expect(esc!.type).toBe('Escalation');
      expect(esc!.fromState).toBe(SignOffState.Blocked);
      expect(esc!.triggeredAt).toBeInstanceOf(Date);
    });

    it('includes the blocking reason in the escalation event', () => {
      const so = service.createSignOff('map-1');
      const esc = so.block('P0 conflict unresolved', 'user-3');
      expect(esc.reason).toBe('P0 conflict unresolved');
      expect(esc.actorId).toBe('user-3');
    });

    it('falls back to a default reason when none is provided', () => {
      const so = service.createSignOff('map-1');
      const esc = so.block();
      expect(esc.reason).toContain('escalation triggered');
    });
  });

  describe('invalid transitions', () => {
    it('Approved → approve() throws', () => {
      const so = service.createSignOff('map-1');
      so.approve();
      expect(() => so.approve()).toThrow('Invalid transition');
    });

    it('Approved → approveWithComment() throws', () => {
      const so = service.createSignOff('map-1');
      so.approve();
      expect(() => so.approveWithComment('nope')).toThrow('Invalid transition');
    });

    it('Approved → block() throws', () => {
      const so = service.createSignOff('map-1');
      so.approve();
      expect(() => so.block()).toThrow('Invalid transition');
    });

    it('ApprovedWithComment → approve() throws', () => {
      const so = service.createSignOff('map-1');
      so.approveWithComment('done');
      expect(() => so.approve()).toThrow('Invalid transition');
    });

    it('ApprovedWithComment → block() throws', () => {
      const so = service.createSignOff('map-1');
      so.approveWithComment('done');
      expect(() => so.block()).toThrow('Invalid transition');
    });

    it('Blocked → approve() throws', () => {
      const so = service.createSignOff('map-1');
      so.block();
      expect(() => so.approve()).toThrow('Invalid transition');
    });

    it('Blocked → approveWithComment() throws', () => {
      const so = service.createSignOff('map-1');
      so.block();
      expect(() => so.approveWithComment('nope')).toThrow('Invalid transition');
    });

    it('Blocked → block() throws (cannot double-block)', () => {
      const so = service.createSignOff('map-1');
      so.block();
      expect(() => so.block()).toThrow('Invalid transition');
    });
  });
});

// ---------------------------------------------------------------------------
// Service.applyAction helper
// ---------------------------------------------------------------------------

describe('StakeholderMapService.applyAction', () => {
  it('wraps approve() and returns the sign-off with no escalation', () => {
    const so = service.createSignOff('map-1');
    const result = service.applyAction(so, SignOffAction.Approve, { actorId: 'u1' });
    expect(result.signOff.state).toBe(SignOffState.Approved);
    expect(result.escalation).toBeUndefined();
  });

  it('wraps approveWithComment()', () => {
    const so = service.createSignOff('map-1');
    const result = service.applyAction(so, SignOffAction.ApproveWithComment, {
      comment: 'ok',
      actorId: 'u1',
    });
    expect(result.signOff.state).toBe(SignOffState.ApprovedWithComment);
    expect(result.signOff.comment).toBe('ok');
    expect(result.escalation).toBeUndefined();
  });

  it('wraps block() and returns the escalation event', () => {
    const so = service.createSignOff('map-1');
    const result = service.applyAction(so, SignOffAction.Block, {
      reason: 'conflict',
      actorId: 'u1',
    });
    expect(result.signOff.state).toBe(SignOffState.Blocked);
    expect(result.escalation).toBeDefined();
    expect(result.escalation!.type).toBe('Escalation');
    expect(result.escalation!.reason).toBe('conflict');
  });
});

// ---------------------------------------------------------------------------
// Reconstitution
// ---------------------------------------------------------------------------

describe('StakeholderMapService.reconstituteSignOff', () => {
  it('returns a sign-off in the given state with preserved history and comment', () => {
    const history = [{
      from: SignOffState.Pending,
      to: SignOffState.ApprovedWithComment,
      action: SignOffAction.ApproveWithComment,
      timestamp: new Date('2026-07-01T00:00:00Z'),
      actorId: 'u1',
      comment: 'ok',
    }];
    const so = service.reconstituteSignOff('map-1', SignOffState.ApprovedWithComment, history, 'ok');
    expect(so.state).toBe(SignOffState.ApprovedWithComment);
    expect(so.comment).toBe('ok');
    expect(so.history).toEqual(history);
  });
});
