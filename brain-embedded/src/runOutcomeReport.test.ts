import { describe, it, expect } from 'vitest';
import { TENANT_BUDGET_CODES, foldsIntoRouting } from '@builderforce/learned-routing';
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

  it('a run that died on a TENANT budget code reports quotaExhausted and does not fold into routing', () => {
    for (const code of TENANT_BUDGET_CODES) {
      const outcome = codeRunOutcome({ ...base, failed: true, error: `chat completion failed with HTTP 429: {"code":"${code}"}` });
      expect(outcome, code).toMatchObject({ terminalStatus: 'failed', quotaExhausted: true });
      expect(foldsIntoRouting({ source: outcome!.source, terminalStatus: outcome!.terminalStatus, quotaExhausted: outcome!.quotaExhausted }), code).toBe(false);
    }
  });

  it('a run that died on a provider 429 or "overloaded" reports rateLimited (availability, still folded as a demotion), never quotaExhausted', () => {
    for (const error of ['chat completion failed with HTTP 429: Too many requests', 'chat completion failed with HTTP 529: overloaded, over capacity']) {
      const outcome = codeRunOutcome({ ...base, failed: true, error });
      expect(outcome, error).toMatchObject({ terminalStatus: 'failed', rateLimited: true });
      expect(outcome, error).not.toHaveProperty('quotaExhausted');
      expect(foldsIntoRouting({ source: outcome!.source, terminalStatus: outcome!.terminalStatus, quotaExhausted: outcome!.quotaExhausted }), error).toBe(true);
    }
  });

  it('a tenant budget code is quotaExhausted and NOT rateLimited, even though it arrives as an HTTP 429', () => {
    const outcome = codeRunOutcome({ ...base, failed: true, error: 'chat completion failed with HTTP 429: {"code":"plan_token_limit_exceeded"}' });
    expect(outcome).toMatchObject({ quotaExhausted: true });
    expect(outcome).not.toHaveProperty('rateLimited');
  });

  it('says nothing of quota or throttling for any other failure, or for a run that did not fail', () => {
    expect(codeRunOutcome({ ...base, failed: true, error: 'tool calls kept failing' })).not.toHaveProperty('rateLimited');
    expect(codeRunOutcome({ ...base, failed: false, error: 'HTTP 429 too many requests' })).not.toHaveProperty('rateLimited');
    expect(codeRunOutcome({ ...base, failed: false, error: '{"code":"plan_token_limit_exceeded"}' })).not.toHaveProperty('quotaExhausted');
  });

  it('has nothing to report for a stopped run, a run that changed no code, or an unknown coder', () => {
    expect(codeRunOutcome({ ...base, aborted: true })).toBeNull();
    expect(codeRunOutcome({ ...base, codeChanged: false })).toBeNull();
    expect(codeRunOutcome({ ...base, codeModel: null })).toBeNull();
  });
});
