/**
 * The orphan sweep judges a draft by the run that OPENED it (its marker), not by the task's newest run: a duplicate
 * dispatch that admission refused is the newest run and says nothing about the draft; a parent whose sub-agent children
 * are still going is not finished.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const live = vi.fn(async (..._a: unknown[]) => false);
vi.mock('../runtime/liveExecutionStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/liveExecutionStatus')>()),
  taskHasLiveRun: (...a: unknown[]) => live(...a),
}));

import { draftRunOutcome, ORPHAN_DRAFT_GRACE_MS } from './orphanRunOutcome';

const NOW = new Date('2026-11-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;

type Run = { id: number; status: string; startedAt: Date | null; completedAt: Date | null; createdAt: Date };
const run = (over: Partial<Run> & { id: number; status: string }): Run => ({ startedAt: ago(5 * HOUR), completedAt: ago(2 * HOUR), createdAt: ago(6 * HOUR), ...over });

/** Each awaited select answers the next list: the opener first, then one list per child level. */
function fakeDb(...answers: Run[][]) {
  return {
    select: () => {
      const c: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(answers.shift() ?? []).then(res);
      return c;
    },
  } as never;
}

beforeEach(() => { vi.clearAllMocks(); live.mockResolvedValue(false); });

describe('draftRunOutcome', () => {
  it('judges a completed opener past the grace as succeeded, and a failed or cancelled one as dead', async () => {
    expect(await draftRunOutcome(fakeDb([run({ id: 5, status: 'completed' })], []), 1, 3, 5, NOW)).toBe('succeeded');
    expect(await draftRunOutcome(fakeDb([run({ id: 5, status: 'failed' })], []), 1, 3, 5, NOW)).toBe('dead');
    expect(await draftRunOutcome(fakeDb([run({ id: 5, status: 'cancelled' })], []), 1, 3, 5, NOW)).toBe('dead');
  });

  it('is recent inside the grace, measured from the end of the work', async () => {
    const justEnded = run({ id: 5, status: 'failed', completedAt: ago(ORPHAN_DRAFT_GRACE_MS - 60_000) });
    expect(await draftRunOutcome(fakeDb([justEnded], []), 1, 3, 5, NOW)).toBe('recent');
  });

  it('regression: M4 - a parent whose sub-agent child is still live is live, even though the parent itself is terminal', async () => {
    const parent = run({ id: 5, status: 'completed' });
    const child = run({ id: 6, status: 'running', completedAt: null });
    expect(await draftRunOutcome(fakeDb([parent], [child]), 1, 3, 5, NOW)).toBe('live');
  });

  it('regression: M4 - a grandchild still live holds the draft too (the tree is followed past one level)', async () => {
    const parent = run({ id: 5, status: 'completed' });
    const child = run({ id: 6, status: 'completed' });
    const grandchild = run({ id: 7, status: 'running', completedAt: null });
    expect(await draftRunOutcome(fakeDb([parent], [child], [grandchild]), 1, 3, 5, NOW)).toBe('live');
  });

  it('regression: M4 - the grace runs from the LAST child to end, not the parent', async () => {
    const parent = run({ id: 5, status: 'completed', completedAt: ago(3 * HOUR) });
    const lateChild = run({ id: 6, status: 'completed', completedAt: ago(60_000) });
    expect(await draftRunOutcome(fakeDb([parent], [lateChild]), 1, 3, 5, NOW)).toBe('recent');
  });

  it('regression: M4 - an opener that was cancelled without ever starting (how admission refuses a run) is no evidence', async () => {
    const refused = run({ id: 5, status: 'cancelled', startedAt: null });
    expect(await draftRunOutcome(fakeDb([refused], []), 1, 3, 5, NOW)).toBe('none');
  });

  it('regression: M4 - a refused child never moves the end time or the verdict of the run that did the work', async () => {
    const parent = run({ id: 5, status: 'completed', completedAt: ago(3 * HOUR) });
    const refusedChild = run({ id: 6, status: 'cancelled', startedAt: null, completedAt: ago(60_000) });
    expect(await draftRunOutcome(fakeDb([parent], [refusedChild]), 1, 3, 5, NOW)).toBe('succeeded');
  });

  it('is live while any run on the task is live, whatever the opener did', async () => {
    live.mockResolvedValue(true);
    expect(await draftRunOutcome(fakeDb([run({ id: 5, status: 'failed' })], []), 1, 3, 5, NOW)).toBe('live');
  });

  it('is none when the opener row is gone, and for an unmarked draft with no run that started', async () => {
    expect(await draftRunOutcome(fakeDb([], []), 1, 3, 5, NOW)).toBe('none');
    expect(await draftRunOutcome(fakeDb([], []), 1, 3, null, NOW)).toBe('none');
  });

  it('an unmarked draft falls back to the task\'s newest run that started', async () => {
    expect(await draftRunOutcome(fakeDb([run({ id: 9, status: 'failed' })], []), 1, 3, null, NOW)).toBe('dead');
  });
});
