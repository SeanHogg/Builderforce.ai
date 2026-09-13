import { describe, it, expect } from 'vitest';
import { codeRunOutcome, runOutcomeId } from './runOutcomeReport';
import type { BrainTraceEvent } from './brainTriage';

const turn = (isError = false) => ({ ts: '', category: 'llm', label: 'llm.complete', isError }) as unknown as BrainTraceEvent;
const base = {
  runId: runOutcomeId(7, 1000),
  codeModel: 'claude-opus-5',
  codeChanged: true,
  aborted: false,
  failed: false,
  shipped: true,
  trace: [turn(), turn(), turn(true)],
  projectId: 11,
};

describe('codeRunOutcome', () => {
  it('grades the model that made the code changes, as a coder', () => {
    expect(codeRunOutcome(base)).toEqual({
      clientRunId: 'ide:7:1000',
      model: 'claude-opus-5',
      role: 'code',
      source: 'ide',
      terminalStatus: 'completed',
      merged: true,
      steps: 2,
      projectId: 11,
    });
  });

  it('reports a failed run as failed', () => {
    expect(codeRunOutcome({ ...base, failed: true })?.terminalStatus).toBe('failed');
  });

  it('has nothing to report for a stopped run, a run that changed no code, or an unknown coder', () => {
    expect(codeRunOutcome({ ...base, aborted: true })).toBeNull();
    expect(codeRunOutcome({ ...base, codeChanged: false })).toBeNull();
    expect(codeRunOutcome({ ...base, codeModel: null })).toBeNull();
  });
});
