import { describe, expect, it } from 'vitest';
import { evaluateGate, gateRefusalMessage } from './canvasEvaluationGate';

const scored = { goldenDatasetId: 'ds1', judgeModel: 'claude-opus-5' };

describe('evaluateGate', () => {
  it('passes a healthy, fully-provenanced evaluation', () => {
    const verdict = evaluateGate({ ...scored, passRate: 96, gate: { mode: 'block', minPassRate: 90 } });
    expect(verdict).toEqual({ status: 'pass', blocks: false, reasons: [] });
  });

  it('does not block an evaluation that never ran unless blocking was asked for', () => {
    // Treating "no score" as a failing score would make attaching an empty evaluation
    // freeze the object, and people would simply stop attaching them.
    expect(evaluateGate({ passRate: null, gate: { mode: 'warn' } }).blocks).toBe(false);
    expect(evaluateGate({ passRate: null, gate: { mode: 'block' } }).blocks).toBe(true);
    expect(evaluateGate({ passRate: null }).status).toBe('unscored');
  });

  it('blocks below an absolute floor', () => {
    const verdict = evaluateGate({ ...scored, passRate: 71.5, gate: { mode: 'block', minPassRate: 90 } });
    expect(verdict.status).toBe('block');
    expect(verdict.blocks).toBe(true);
    expect(verdict.reasons[0]).toEqual({ key: 'belowFloor', values: { passRate: 71.5, floor: 90 } });
  });

  it('warns rather than blocks when the mode is warn', () => {
    const verdict = evaluateGate({ ...scored, passRate: 71, gate: { mode: 'warn', minPassRate: 90 } });
    expect(verdict.status).toBe('warn');
    expect(verdict.blocks).toBe(false);
  });

  it('catches a regression against the baseline inside the floor', () => {
    // 92 clears a floor of 90 and is still four points worse than the model it replaces.
    const verdict = evaluateGate({ ...scored, passRate: 92, baselinePassRate: 96, gate: { mode: 'block', minPassRate: 90 } });
    expect(verdict.blocks).toBe(true);
    expect(verdict.reasons[0].key).toBe('regressed');
  });

  it('tolerates a regression inside the declared tolerance', () => {
    expect(evaluateGate({ ...scored, passRate: 95, baselinePassRate: 96, gate: { mode: 'block', maxRegressionPoints: 2 } }).blocks).toBe(false);
  });

  it('sees a failing slice the aggregate hides', () => {
    // 94 overall, 61 on the slice that matters — no threshold on the aggregate fires.
    const verdict = evaluateGate({
      ...scored,
      passRate: 94,
      gate: { mode: 'block', minPassRate: 90, maxSliceGapPoints: 10 },
      slices: [{ name: 'majority', passRate: 98 }, { name: 'minority', passRate: 61 }],
    });
    expect(verdict.blocks).toBe(true);
    expect(verdict.reasons[0]).toMatchObject({ key: 'sliceGap', values: { slice: 'minority' } });
  });

  it('judges by the worst slice, not the average of them', () => {
    const verdict = evaluateGate({
      ...scored,
      passRate: 94,
      gate: { mode: 'block', maxSliceGapPoints: 10 },
      slices: [{ name: 'a', passRate: 99 }, { name: 'b', passRate: 99 }, { name: 'c', passRate: 70 }],
    });
    expect(verdict.blocks).toBe(true);
  });

  it('warns about missing provenance without blocking on it', () => {
    // Refusing a release over an unfilled metadata field, when the measured quality is
    // fine, teaches people to route around the gate.
    const verdict = evaluateGate({ passRate: 99, gate: { mode: 'block', minPassRate: 90 } });
    expect(verdict.blocks).toBe(false);
    expect(verdict.status).toBe('warn');
    expect(verdict.reasons.map((reason) => reason.key)).toEqual(['noGoldenSet', 'noJudge']);
  });

  it('writes a refusal that names the reason and forbids blaming the tool', () => {
    const verdict = evaluateGate({ ...scored, passRate: 40, gate: { mode: 'block', minPassRate: 90 } });
    const message = gateRefusalMessage(verdict, 'promote');
    expect(message).toContain('40');
    expect(message).toContain('90');
    expect(message).toContain('promote');
    expect(message).toContain('quality gate');
  });
});
