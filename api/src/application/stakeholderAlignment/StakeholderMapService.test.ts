import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  buildWeeklyStakeholderDigest,
  detectPriorityConflicts,
  dueEscalationReminders,
  evaluateSignoffState,
  scoreStakeholderHealth,
} from './StakeholderMapService';

describe('stakeholder alignment domain rules', () => {
  it('scores the canonical structured health profile', () => {
    expect(scoreStakeholderHealth({
      priorities_clear: 'yes',
      competing_p0s_reconciled: 'no',
      approvers_current: 'unknown',
      conflicts_within_sla: 'yes',
      delivery_reflects_priorities: 'yes',
    })).toBe(73);
  });

  it('detects competing P0 submissions for the same team inside 48 hours', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const conflicts = detectPriorityConflicts([
      { stakeholderRef: 'u:a', teamScope: 'platform', priorityKey: 'ship-auth', submittedAt: new Date('2026-08-09T10:00:00Z') },
      { stakeholderRef: 'u:b', teamScope: 'platform', priorityKey: 'ship-canvas', submittedAt: new Date('2026-08-10T10:00:00Z') },
      { stakeholderRef: 'u:c', teamScope: 'growth', priorityKey: 'campaign', submittedAt: new Date('2026-08-10T10:00:00Z') },
    ], now);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      teamScope: 'platform',
      priorityKeys: ['ship-auth', 'ship-canvas'],
      stakeholderRefs: ['u:a', 'u:b'],
    });
  });

  it('requires every approver and lets one block halt approval', () => {
    expect(evaluateSignoffState(['a', 'b'], [{ stakeholderRef: 'a', response: 'approve' }])).toBe('in_review');
    expect(evaluateSignoffState(['a', 'b'], [
      { stakeholderRef: 'a', response: 'approve_with_comment' },
      { stakeholderRef: 'b', response: 'approve' },
    ])).toBe('approved');
    expect(evaluateSignoffState(['a', 'b'], [
      { stakeholderRef: 'a', response: 'approve' },
      { stakeholderRef: 'b', response: 'block' },
    ])).toBe('blocked');
  });

  it('calculates three business-day escalation deadlines and reminder claims', () => {
    expect(addBusinessDays(new Date('2026-08-07T12:00:00Z'), 3).toISOString()).toBe('2026-08-12T12:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00Z');
    expect(dueEscalationReminders([
      { id: 'a', deadlineAt: new Date('2026-08-11T10:00:00Z'), reminder24hAt: null, reminder4hAt: null },
      { id: 'b', deadlineAt: new Date('2026-08-10T15:00:00Z'), reminder24hAt: now, reminder4hAt: null },
      { id: 'c', deadlineAt: new Date('2026-08-10T11:00:00Z'), reminder24hAt: now, reminder4hAt: now },
    ], now)).toEqual([
      { escalationId: 'a', kind: '24h' },
      { escalationId: 'b', kind: '4h' },
      { escalationId: 'c', kind: 'breached' },
    ]);
  });

  it('builds a bounded weekly digest with at most two urgent items', () => {
    const digest = buildWeeklyStakeholderDigest({
      approved: 3, pending: 2, overdue: 1, activeConflicts: 1, openEscalations: 1,
      urgent: ['Conflict A', 'Sign-off B', 'Ignored C'],
    });
    expect(digest).toContain('Conflict A · Sign-off B');
    expect(digest).not.toContain('Ignored C');
    expect(digest.length).toBeLessThanOrEqual(600);
  });
});
