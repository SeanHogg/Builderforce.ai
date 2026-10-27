import { describe, expect, it, vi } from 'vitest';
import { makeCell } from './runCell';
import { noteBudgetContained, noteRunId, reportRunEnd, runEndOutcome } from './runEndOutcome';

describe('runEndOutcome', () => {
  it('containment wins, then a stop, then failure', () => {
    expect(runEndOutcome({ contained: true, aborted: true, failed: true })).toBe('budget-contained');
    expect(runEndOutcome({ contained: false, aborted: true, failed: true })).toBe('stopped');
    expect(runEndOutcome({ contained: false, aborted: false, failed: true })).toBe('failed');
    expect(runEndOutcome({ contained: false, aborted: false, failed: false })).toBe('succeeded');
  });
});

describe('reportRunEnd', () => {
  it('reports once, under the noted run id', () => {
    const c = makeCell();
    const recordRunOutcome = vi.fn();
    noteRunId(c, 'run-1');
    noteBudgetContained(c);
    reportRunEnd(c, { recordRunOutcome }, { aborted: false, failed: false });
    reportRunEnd(c, { recordRunOutcome }, { aborted: false, failed: false });
    expect(recordRunOutcome).toHaveBeenCalledTimes(1);
    expect(recordRunOutcome).toHaveBeenCalledWith({ runId: 'run-1', outcome: 'budget-contained' });
  });

  it('a run that never reached its loop reports nothing', () => {
    const recordRunOutcome = vi.fn();
    reportRunEnd(makeCell(), { recordRunOutcome }, { aborted: false, failed: true });
    expect(recordRunOutcome).not.toHaveBeenCalled();
  });

  it('a failed run reports failed', () => {
    const c = makeCell();
    const recordRunOutcome = vi.fn();
    noteRunId(c, 'run-2');
    reportRunEnd(c, { recordRunOutcome }, { aborted: false, failed: true });
    expect(recordRunOutcome).toHaveBeenCalledWith({ runId: 'run-2', outcome: 'failed' });
  });
});
