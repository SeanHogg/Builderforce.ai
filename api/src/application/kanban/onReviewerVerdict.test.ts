import { describe, expect, it, vi, beforeEach } from 'vitest';

const reopen = vi.fn();
vi.mock('./reopenProducerSlots', () => ({ reopenStageProducers: (...a: unknown[]) => reopen(...a) }));

import { decideVerdictReopenStage, onReviewerVerdict, type VerdictSlot } from './onReviewerVerdict';

const slot = (over: Partial<VerdictSlot> = {}): VerdictSlot => ({
  stageKey: 'review', roleKey: 'code-reviewer', responsibility: 'reviewer', required: true, ...over,
});

describe('decideVerdictReopenStage', () => {
  const dev = slot({ stageKey: 'in_progress', roleKey: 'developer', responsibility: 'owner' });

  it('reviewer changes_requested falls back to implementation when its own stage has no producer', () => {
    expect(decideVerdictReopenStage([dev, slot()], { roleKey: 'code-reviewer', laneKey: 'review', verdict: 'changes_requested' })).toBe('in_progress');
  });

  it('prefers the reviewer\'s own stage when it has a required producer', () => {
    const p = slot({ roleKey: 'writer', responsibility: 'owner' });
    expect(decideVerdictReopenStage([dev, p, slot()], { roleKey: 'code-reviewer', laneKey: 'review', verdict: 'changes_requested' })).toBe('review');
  });

  it('ignores a producer slot verdict (no recursion) and non-changes verdicts', () => {
    expect(decideVerdictReopenStage([dev], { roleKey: 'developer', laneKey: 'in_progress', verdict: 'changes_requested' })).toBeNull();
    expect(decideVerdictReopenStage([dev, slot()], { roleKey: 'code-reviewer', verdict: 'approved' })).toBeNull();
  });
});

describe('onReviewerVerdict', () => {
  const dbWith = (rows: VerdictSlot[]) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) }) as never;
  const args = { tenantId: 1, taskId: 7, roleKey: 'code-reviewer', laneKey: 'review', verdict: 'changes_requested', actor: { kind: 'agent' as const, ref: 'a', name: 'A' } };
  beforeEach(() => reopen.mockReset());

  it('reopens producers once for a reviewer changes_requested', async () => {
    reopen.mockResolvedValue(['developer']);
    const rows = [slot({ stageKey: 'in_progress', roleKey: 'developer', responsibility: 'owner' }), slot()];
    expect(await onReviewerVerdict({} as never, dbWith(rows), args)).toEqual(['developer']);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen.mock.calls[0]?.[2]).toMatchObject({ stageKey: 'in_progress', taskId: 7 });
  });

  it('does not reopen on a producer-slot verdict', async () => {
    const rows = [slot({ stageKey: 'in_progress', roleKey: 'developer', responsibility: 'owner' })];
    expect(await onReviewerVerdict({} as never, dbWith(rows), { ...args, roleKey: 'developer', laneKey: 'in_progress' })).toEqual([]);
    expect(reopen).not.toHaveBeenCalled();
  });

  it('is a no-op when producers are already open (reopen returns nothing)', async () => {
    reopen.mockResolvedValue([]);
    const rows = [slot({ stageKey: 'in_progress', roleKey: 'developer', responsibility: 'owner' }), slot()];
    expect(await onReviewerVerdict({} as never, dbWith(rows), args)).toEqual([]);
  });
});
