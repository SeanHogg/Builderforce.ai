import { describe, it, expect } from 'vitest';
import { NO_DELIVERABLE_MIN_STEPS, codeRunOutcome, runOutcomeId } from './runOutcomeReport';
import type { BrainTraceEvent } from './brainTriage';

const FLASH = 'direct/minimax/MiniMax-M3.1-Flash-Preview';
const turns = (n: number, model: string = FLASH) =>
  Array.from({ length: n }, () => ({ ts: '', category: 'llm', label: 'llm.complete', args: { model } }) as unknown as BrainTraceEvent);
const spawn = { ts: '', category: 'tool', label: 'spawn_agents' } as unknown as BrainTraceEvent;
const emptyHanded = {
  runId: runOutcomeId(6, 2000),
  codeModel: null,
  codeChanged: false,
  aborted: false,
  failed: false,
  shipped: false,
  trace: turns(NO_DELIVERABLE_MIN_STEPS),
  projectId: 11,
  askedForChange: true,
};

describe('codeRunOutcome — a run asked for a change that delivered none (VS Code chat #6)', () => {
  it('grades the model that served it as failed', () => {
    expect(codeRunOutcome(emptyHanded)).toEqual({
      clientRunId: 'ide:6:2000',
      model: FLASH,
      role: 'code',
      source: 'ide',
      terminalStatus: 'failed',
      merged: false,
      steps: NO_DELIVERABLE_MIN_STEPS,
      projectId: 11,
    });
  });

  it('an empty-handed run that died on a tenant budget code is stored as quota-exhausted, never taught', () => {
    expect(codeRunOutcome({ ...emptyHanded, failed: true, error: '{"code":"plan_token_limit_exceeded"}' })).toMatchObject({ terminalStatus: 'failed', quotaExhausted: true });
    expect(codeRunOutcome({ ...emptyHanded, failed: true, error: 'the build failed' })).not.toHaveProperty('quotaExhausted');
  });

  it('grades a long empty-handed run the person stopped, too', () => {
    expect(codeRunOutcome({ ...emptyHanded, aborted: true })?.terminalStatus).toBe('failed');
  });

  it('says nothing for a short run, a question, a run that delegated, or an unknown model', () => {
    expect(codeRunOutcome({ ...emptyHanded, trace: turns(NO_DELIVERABLE_MIN_STEPS - 1) })).toBeNull();
    expect(codeRunOutcome({ ...emptyHanded, askedForChange: false })).toBeNull();
    expect(codeRunOutcome({ ...emptyHanded, trace: [...turns(NO_DELIVERABLE_MIN_STEPS), spawn] })).toBeNull();
    expect(codeRunOutcome({ ...emptyHanded, trace: turns(NO_DELIVERABLE_MIN_STEPS, 'default') })).toBeNull();
  });

  it('grades the model that served most turns, not the planner that closed the run', () => {
    const trace = [...turns(NO_DELIVERABLE_MIN_STEPS), ...turns(2, 'anthropic/claude-opus-5')];
    expect(codeRunOutcome({ ...emptyHanded, trace })?.model).toBe(FLASH);
  });
});
