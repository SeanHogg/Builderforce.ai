import { beforeEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore } from '../brainRunStore';
import { getCell, runTrace } from './runCells';
import type { BrainRunContext } from './brainRunContext';
import { RunProgressGuard, progressAfterToolCalls } from './progressGuard';

beforeEach(resetBrainRunStore);

/** The B1 readiness advisory is never a trip, but it used to vanish from the trace entirely. */
describe('progressAfterToolCalls traces the advisory', () => {
  it('a readiness advisory yields exactly one loop.progress_advisory row, and no progress_check', () => {
    const progress = new RunProgressGuard(true);
    const c = getCell(4901);
    const run = { progress, c } as unknown as BrainRunContext;
    progress.noteTurnText('Now I have everything I need.');
    progress.observe('read_file', { path: 'f0.ts' }, { data: { ok: true } });
    progressAfterToolCalls(run)({ step: 3 });
    // A later quiet turn adds nothing: the advisory is taken once.
    progressAfterToolCalls(run)({ step: 4 });
    const rows = runTrace(c).filter((e) => e.label.startsWith('loop.progress_'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'message',
      label: 'loop.progress_advisory',
      args: { step: 3, advisory: 'readiness' },
      result: 'progress advisory (readiness): a one-off note on the next turn, not a trip',
    });
  });
});
