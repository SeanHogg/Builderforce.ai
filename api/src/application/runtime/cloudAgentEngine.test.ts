import { describe, it, expect } from 'vitest';
import { isCodingModelDegraded } from './cloudAgentEngine';
import { CODING_MODEL_POOL, CODING_BACKSTOP_MODELS } from '../llm/LlmProxyService';

describe('isCodingModelDegraded', () => {
  it('does NOT flag a curated coding-pool model', () => {
    for (const m of CODING_MODEL_POOL) {
      expect(isCodingModelDegraded(m)).toBe(false);
    }
  });

  it('flags a non-coder model the coding cascade fell back to', () => {
    // The gemini guaranteed backstop is the tail of CODING_BACKSTOP_MODELS and is
    // NOT a CODING_MODEL_POOL member — that is exactly the degradation we signal.
    const tailBackstop = CODING_BACKSTOP_MODELS[CODING_BACKSTOP_MODELS.length - 1]!;
    expect(CODING_MODEL_POOL.includes(tailBackstop)).toBe(false);
    expect(isCodingModelDegraded(tailBackstop)).toBe(true);
    expect(isCodingModelDegraded('google/gemini-2.0-flash')).toBe(true);
  });

  it('does NOT flag when no resolved model was reported (unknown, not degraded)', () => {
    expect(isCodingModelDegraded(undefined)).toBe(false);
    expect(isCodingModelDegraded('')).toBe(false);
    expect(isCodingModelDegraded('default')).toBe(false);
  });
});
