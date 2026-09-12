import { describe, expect, it } from 'vitest';
import {
  EVERMIND_CODING_QUALITY_BAR,
  codingEvalFromReports,
  codingEvalFromRow,
  evermindQualifiesForCoding,
  type EvermindCodingEval,
} from './evermindCodingGate';

/**
 * Operator decision 2026-09-12: "Evermind for IDE coding ⇒ quality has to be 90%."
 * These pin the ONE predicate every coding router consults — above all that it stays
 * CLOSED for every project as they exist today (starter base, no eval recorded).
 */

const ev = (over: Partial<EvermindCodingEval> = {}): EvermindCodingEval => ({
  version: 12, score: 0.9, baselineScore: 1, baselineModel: 'claude-opus-5', dataset: 'coding-v1', evaluatedAt: null, ...over,
});

describe('EVERMIND_CODING_QUALITY_BAR', () => {
  it('is the operator decision: 90% of the frontier baseline', () => {
    expect(EVERMIND_CODING_QUALITY_BAR).toBe(0.9);
  });
});

describe('evermindQualifiesForCoding', () => {
  it('stays CLOSED with no recorded eval — the state of every project today', () => {
    expect(evermindQualifiesForCoding({ version: 12, codingEval: null })).toMatchObject({ qualified: false, reason: 'no_eval', ratio: null, bar: 0.9 });
    expect(evermindQualifiesForCoding({ version: 12 })).toMatchObject({ qualified: false, reason: 'no_eval' });
  });

  it('opens at exactly 90% of the baseline on the same eval', () => {
    const gate = evermindQualifiesForCoding({ version: 12, codingEval: ev({ score: 0.72, baselineScore: 0.8 }) });
    expect(gate).toMatchObject({ qualified: true, reason: 'qualified', evaluatedVersion: 12 });
    expect(gate.ratio).toBeCloseTo(0.9);
  });

  it('stays closed just under the bar', () => {
    const gate = evermindQualifiesForCoding({ version: 12, codingEval: ev({ score: 0.719, baselineScore: 0.8 }) });
    expect(gate).toMatchObject({ qualified: false, reason: 'below_bar' });
    expect(gate.ratio).toBeCloseTo(0.89875);
  });

  it('is version-exact: an eval of v11 vouches for nothing at v12', () => {
    expect(evermindQualifiesForCoding({ version: 12, codingEval: ev({ version: 11, score: 1 }) }))
      .toMatchObject({ qualified: false, reason: 'stale_eval', evaluatedVersion: 11, headVersion: 12 });
  });

  it('never opens a quarantined head, however good its eval', () => {
    expect(evermindQualifiesForCoding({ version: 12, quarantinedAt: '2026-09-12T00:00:00Z', codingEval: ev({ score: 1 }) }))
      .toMatchObject({ qualified: false, reason: 'quarantined' });
  });

  it('never opens an unseeded head', () => {
    expect(evermindQualifiesForCoding({ version: 0, codingEval: ev({ version: 0 }) })).toMatchObject({ qualified: false, reason: 'unseeded' });
  });

  it('treats a zero baseline as proving nothing', () => {
    expect(evermindQualifiesForCoding({ version: 12, codingEval: ev({ baselineScore: 0 }) }))
      .toMatchObject({ qualified: false, reason: 'below_bar', ratio: null });
  });
});

describe('codingEvalFromRow', () => {
  it('reads nothing from a half-written row — the gate never opens on half a record', () => {
    expect(codingEvalFromRow({ codingEvalVersion: 12, codingEvalScore: 0.9 })).toBeNull();
    expect(codingEvalFromRow({})).toBeNull();
  });

  it('maps a complete row', () => {
    const at = new Date('2026-09-12T10:00:00Z');
    expect(codingEvalFromRow({
      codingEvalVersion: 12, codingEvalScore: 0.72, codingEvalBaselineScore: 0.8,
      codingEvalBaselineModel: 'claude-opus-5', codingEvalDataset: 'coding-v1', codingEvalAt: at,
    })).toEqual({ version: 12, score: 0.72, baselineScore: 0.8, baselineModel: 'claude-opus-5', dataset: 'coding-v1', evaluatedAt: at.toISOString() });
  });
});

describe('codingEvalFromReports (EvalHarness → persisted eval)', () => {
  const cases = Array.from({ length: 50 }, (_, i) => ({ caseId: `c${i}` }));
  const at = new Date('2026-09-12T10:00:00Z');

  it('turns the Evermind + baseline EvalReports into one eval', () => {
    const out = codingEvalFromReports({
      version: 12,
      evermind: { dataset: 'coding-v1', meanScore: 0.72, cases },
      baseline: { dataset: 'coding-v1', meanScore: 0.8, cases: 50 },
      baselineModel: '  claude-opus-5 ',
      evaluatedAt: at,
    });
    expect(out).toEqual({ ok: true, eval: { version: 12, score: 0.72, baselineScore: 0.8, baselineModel: 'claude-opus-5', dataset: 'coding-v1', evaluatedAt: at.toISOString() } });
  });

  it('refuses to compare two different evals', () => {
    const base = { version: 12, evaluatedAt: at };
    expect(codingEvalFromReports({ ...base, evermind: { dataset: 'a', meanScore: 0.7, cases: 5 }, baseline: { dataset: 'b', meanScore: 0.8, cases: 5 } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/different evals/) });
    expect(codingEvalFromReports({ ...base, evermind: { dataset: 'a', meanScore: 0.7, cases: 5 }, baseline: { dataset: 'a', meanScore: 0.8, cases: 6 } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/case counts/) });
  });

  it('rejects out-of-range scores, an empty eval, a zero baseline and a bad version', () => {
    const good = { dataset: 'a', meanScore: 0.5, cases: 5 };
    expect(codingEvalFromReports({ version: 12, evaluatedAt: at, evermind: { ...good, meanScore: 1.5 }, baseline: good }).ok).toBe(false);
    expect(codingEvalFromReports({ version: 12, evaluatedAt: at, evermind: { ...good, cases: 0 }, baseline: { ...good, cases: 0 } }).ok).toBe(false);
    expect(codingEvalFromReports({ version: 12, evaluatedAt: at, evermind: good, baseline: { ...good, meanScore: 0 } }).ok).toBe(false);
    expect(codingEvalFromReports({ version: 0, evaluatedAt: at, evermind: good, baseline: good }).ok).toBe(false);
  });
});
