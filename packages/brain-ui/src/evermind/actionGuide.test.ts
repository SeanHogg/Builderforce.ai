import { describe, expect, it } from 'vitest';
import { evermindNextAction } from './actionGuide';

const healthy = { seeded: true, inferenceEnabled: true, mode: 'connected' as const, pending: 0, recent: [] };

describe('evermindNextAction', () => {
  it('directs a quarantined model with no test evidence to readiness', () => {
    expect(evermindNextAction({ ...healthy, inferenceEnabled: false, quarantinedAt: '2026-07-26T16:10:30Z' })).toMatchObject({ id: 'test', destination: 'Test → Readiness check' });
  });

  it('directs a failed readiness check without a teacher to distillation setup', () => {
    expect(evermindNextAction({ ...healthy, inferenceEnabled: false, quarantinedAt: '2026-07-26T16:10:30Z', probe: { ready: false }, teacherModel: null })).toMatchObject({ id: 'teacher', tone: 'danger' });
  });

  it('does not treat normal unpinned self-learning as failed distillation', () => {
    expect(evermindNextAction({ ...healthy, recent: [{ kind: 'text', prompt: 'p', text: 'answer', skipReason: 'not_pinned' }] })).toMatchObject({ id: 'none' });
  });

  it('surfaces an actual teacher failure before lower-priority states', () => {
    expect(evermindNextAction({ ...healthy, recent: [{ kind: 'text', skipReason: 'gateway_error', attemptedTeacherModel: 'teacher' }] })).toMatchObject({ id: 'teacher', title: 'Fix failed distillation' });
  });
});
