import { describe, expect, it } from 'vitest';
import {
  MODEL_ANALYTICS_PATH,
  OWN_TENANT_SCOPE_TOKEN,
  RUN_OUTCOME_PATH,
  parseRunOutcomeRequest,
  scopeHasSignal,
  type ActionModelRankStat,
} from '@builderforce/learned-routing';

// The write-back door's request contract (PRD 13). The route hands its raw body
// straight to this parser and the on-prem host builds its body from the same module,
// so these are the tests that keep the two halves of the door honest.
describe('parseRunOutcomeRequest', () => {
  it('rejects a body with nothing to key on or attribute to', () => {
    expect(parseRunOutcomeRequest({})).toEqual({ ok: false, error: 'clientRunId and model are required' });
    expect(parseRunOutcomeRequest({ clientRunId: 'r1' }).ok).toBe(false);
    expect(parseRunOutcomeRequest({ model: 'm' }).ok).toBe(false);
    expect(parseRunOutcomeRequest({ clientRunId: '  ', model: 'm' }).ok).toBe(false);
    expect(parseRunOutcomeRequest(null).ok).toBe(false);
  });

  it('normalizes the minimum viable report', () => {
    const parsed = parseRunOutcomeRequest({ clientRunId: ' onprem:r1 ', model: ' a/one ' });
    expect(parsed).toEqual({
      ok: true,
      outcome: {
        clientRunId: 'onprem:r1',
        model: 'a/one',
        // Unstated source is the most conservative bucket, and unstated terminal
        // status means the caller reported a run that ended.
        source: 'external',
        terminalStatus: 'completed',
      },
    });
  });

  it('`terminalStatus` wins over the friendly `success` alias', () => {
    const base = { clientRunId: 'r', model: 'm' };
    const t = (body: Record<string, unknown>) => {
      const r = parseRunOutcomeRequest({ ...base, ...body });
      return r.ok ? r.outcome.terminalStatus : null;
    };
    expect(t({ terminalStatus: 'failed', success: true })).toBe('failed');
    expect(t({ terminalStatus: 'cancelled' })).toBe('cancelled');
    expect(t({ success: false })).toBe('failed');
    expect(t({ success: true })).toBe('completed');
    expect(t({ terminalStatus: 'nonsense' })).toBe('completed');
  });

  it('refuses to let a client claim to be a CLOUD run', () => {
    // A cloud run has an executions row and is scored server-side; accepting the claim
    // would double-count it in the learned table.
    const parsed = parseRunOutcomeRequest({ clientRunId: 'r', model: 'm', source: 'cloud' });
    expect(parsed.ok && parsed.outcome.source).toBe('external');
    for (const source of ['onprem', 'ide', 'external'] as const) {
      const ok = parseRunOutcomeRequest({ clientRunId: 'r', model: 'm', source });
      expect(ok.ok && ok.outcome.source).toBe(source);
    }
  });

  it('carries every optional signal a client actually has — including rateLimited', () => {
    const parsed = parseRunOutcomeRequest({
      clientRunId: 'onprem:r2',
      model: 'a/one',
      source: 'onprem',
      terminalStatus: 'failed',
      actionType: 'bugfix',
      projectId: 11,
      taskId: 42,
      merged: true,
      ciGreen: false,
      degraded: true,
      steps: 9,
      costMc: 1234,
      approved: true,
      rateLimited: true,
    });
    expect(parsed.ok && parsed.outcome).toEqual({
      clientRunId: 'onprem:r2',
      model: 'a/one',
      source: 'onprem',
      terminalStatus: 'failed',
      actionType: 'bugfix',
      projectId: 11,
      taskId: 42,
      merged: true,
      ciGreen: false,
      degraded: true,
      steps: 9,
      costMc: 1234,
      approved: true,
      rateLimited: true,
    });
  });

  it('OMITS a field the client did not state, rather than inventing a false one', () => {
    // The difference matters: `merged: false` scores a run as having failed a gate,
    // where absent means the gate never applied (an embedded run has no PR at all).
    const parsed = parseRunOutcomeRequest({
      clientRunId: 'r',
      model: 'm',
      merged: 'yes',
      steps: 'lots',
      projectId: Number.NaN,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.outcome).not.toHaveProperty('merged');
    expect(parsed.outcome).not.toHaveProperty('steps');
    expect(parsed.outcome).not.toHaveProperty('projectId');
  });

  it('pins the paths and the own-tenant token both sides spell', () => {
    expect(RUN_OUTCOME_PATH).toBe('/llm/v1/run-outcome');
    expect(MODEL_ANALYTICS_PATH).toBe('/llm/v1/model-analytics');
    expect(OWN_TENANT_SCOPE_TOKEN).toBe('tenant');
  });
});

describe('scopeHasSignal', () => {
  const stat = (n: number, extra: Partial<ActionModelRankStat> = {}): ActionModelRankStat => ({
    model: 'a/one', n, avgScore: 0.5, avgCostMc: 0, ...extra,
  });

  it('is false for an absent or cold slice — the coarser scope should be tried', () => {
    expect(scopeHasSignal(undefined)).toBe(false);
    expect(scopeHasSignal([])).toBe(false);
    expect(scopeHasSignal([stat(7)])).toBe(false);
  });

  it('counts human thumbs as evidence, not just runs', () => {
    expect(scopeHasSignal([stat(0, { ratedUp: 8 })])).toBe(true);
    expect(scopeHasSignal([stat(4, { ratedUp: 2, ratedDown: 2 })])).toBe(true);
  });

  it('honours an explicit floor', () => {
    expect(scopeHasSignal([stat(3)], 3)).toBe(true);
    expect(scopeHasSignal([stat(3)], 4)).toBe(false);
  });
});
