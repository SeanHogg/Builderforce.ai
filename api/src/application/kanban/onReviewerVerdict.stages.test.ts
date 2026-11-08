import { describe, expect, it } from 'vitest';
import { decideVerdictReopenStage, type VerdictSlot } from './onReviewerVerdict';

const slot = (over: Partial<VerdictSlot>): VerdictSlot => ({
  stageKey: 'review', roleKey: 'qa', responsibility: 'reviewer', required: true, ...over,
});
const producer = (stageKey: string, state: string): VerdictSlot =>
  slot({ stageKey, roleKey: `dev-${stageKey}`, responsibility: 'owner', state });
const verdict = { roleKey: 'qa', verdict: 'changes_requested' };

describe('decideVerdictReopenStage — stage choice without a laneKey', () => {
  it('picks the stage whose producer slot is completed, whatever the row order', () => {
    const a = [slot({ stageKey: 'qa_a' }), slot({ stageKey: 'qa_b' }), producer('qa_a', 'in_progress'), producer('qa_b', 'completed')];
    const b = [...a].reverse();
    expect(decideVerdictReopenStage(a, verdict)).toBe('qa_b');
    expect(decideVerdictReopenStage(b, verdict)).toBe('qa_b');
  });

  it('falls back deterministically (alphabetical) when no producer is completed', () => {
    const rows = [slot({ stageKey: 'z_stage' }), slot({ stageKey: 'a_stage' }), producer('z_stage', 'open'), producer('a_stage', 'open')];
    expect(decideVerdictReopenStage(rows, verdict)).toBe('a_stage');
    expect(decideVerdictReopenStage([...rows].reverse(), verdict)).toBe('a_stage');
  });

  it('falls back to implementation when none of its stages has a producer', () => {
    expect(decideVerdictReopenStage([slot({ stageKey: 'z' }), slot({ stageKey: 'a' })], verdict)).toBe('in_progress');
  });
});

describe('decideVerdictReopenStage — a role that also holds a producer slot', () => {
  const both = [
    slot({ stageKey: 'build', roleKey: 'qa', responsibility: 'owner', state: 'completed' }),
    slot({ stageKey: 'review', roleKey: 'qa' }),
    producer('review', 'completed'),
  ];

  it('excludes its own producer slots instead of bailing — the review verdict is honoured', () => {
    expect(decideVerdictReopenStage(both, verdict)).toBe('review');
  });

  it('still ignores a verdict given on the role\'s PRODUCER lane', () => {
    expect(decideVerdictReopenStage(both, { ...verdict, laneKey: 'build' })).toBeNull();
  });

  it('is null for a role with only producer slots', () => {
    expect(decideVerdictReopenStage([producer('build', 'completed')], { roleKey: 'dev-build', verdict: 'changes_requested' })).toBeNull();
  });
});
