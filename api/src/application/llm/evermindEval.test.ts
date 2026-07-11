import { describe, it, expect } from 'vitest';
import { EvermindLM, EvermindLMTrainer, BPETokenizer } from '@seanhogg/builderforce-memory-engine';
import { meanEvalLoss, type EvalExample } from './evermindEval';

/** Chunk ids into fixed windows (min length 2) — mirrors the coordinator's trainer feed. */
function windows(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < ids.length; i += size) {
    const seq = ids.slice(i, i + size);
    if (seq.length >= 2) out.push(seq);
  }
  return out;
}

describe('meanEvalLoss', () => {
  const corpus = 'alpha beta gamma delta epsilon zeta eta theta the agent fixes the bug and ships';
  const tok = new BPETokenizer();
  tok.train(corpus);
  const lm = new EvermindLM({ vocabSize: tok.vocabSize, seed: 3 });
  const examples: EvalExample[] = [
    { prompt: 'greek letters', text: 'alpha beta gamma delta epsilon' },
    { text: 'the agent fixes the bug and ships' },
  ];

  it('returns null for an empty eval set', () => {
    expect(meanEvalLoss(lm, tok, [])).toBeNull();
  });

  it('returns a finite, positive mean loss for real examples', () => {
    const loss = meanEvalLoss(lm, tok, examples);
    expect(loss).not.toBeNull();
    expect(Number.isFinite(loss!)).toBe(true);
    expect(loss!).toBeGreaterThan(0);
  });

  it('returns null when every example is too short to score', () => {
    expect(meanEvalLoss(lm, tok, [{ text: 'a' }])).toBeNull();
  });

  it('a model adapted on the eval text scores it as well or better (delta not a regression)', () => {
    const baseLoss = meanEvalLoss(lm, tok, examples)!;
    // Adapt a COPY of the base on the eval examples, then re-score — mirrors a merge.
    const adapted = new EvermindLM({ vocabSize: tok.vocabSize, seed: 3 });
    adapted.loadWeights(lm.exportWeights());
    const seqs = examples.flatMap((ex) => windows(tok.encode((ex.prompt ? ex.prompt + '\n' : '') + ex.text), 32));
    new EvermindLMTrainer(adapted, { epochs: 12 }).fit(seqs);
    const newLoss = meanEvalLoss(adapted, tok, examples)!;
    // delta = baseLoss - newLoss should be ≥ ~0: training on the data must not regress it.
    expect(newLoss).toBeLessThanOrEqual(baseLoss + 1e-6);
  });
});
