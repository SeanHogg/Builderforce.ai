import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_TOKENS, TYPICAL_OUTPUT_TOKENS, estimateTokensFromChars, isArcStage, profileWorkload } from './index.js';

describe('profileWorkload', () => {
  it('keeps a declared role and never invents one', () => {
    expect(profileWorkload({ role: 'explore' }).role).toBe('explore');
    expect(profileWorkload({ role: 'wizard' }).role).toBeUndefined();
    expect(profileWorkload({}).role).toBeUndefined();
  });

  it('expects the role-typical output when the caller set no cap', () => {
    expect(profileWorkload({ role: 'code' }).outputTokens).toBe(TYPICAL_OUTPUT_TOKENS.code);
    expect(profileWorkload({}).outputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it('never expects more than the caller capped', () => {
    expect(profileWorkload({ role: 'code', maxOutputTokens: 256 }).outputTokens).toBe(256);
  });

  it('labels the instruction with the shared taxonomy', () => {
    const p = profileWorkload({ instruction: 'Fix the bug where the parser crashes on empty input' });
    expect(p.actionType).toBe('bugfix');
    expect(p.actionConfidence).toBeGreaterThan(0);
  });

  it('sanitises token estimates and arc stage', () => {
    const p = profileWorkload({ inputTokens: Number.NaN, arcStage: 'make', hasTools: true });
    expect(p.inputTokens).toBe(0);
    expect(p.arcStage).toBe('make');
    expect(p.agentic).toBe(true);
    expect(isArcStage('launch')).toBe(false);
  });
});

describe('estimateTokensFromChars', () => {
  it('rounds up at four chars per token', () => {
    expect(estimateTokensFromChars(9)).toBe(3);
    expect(estimateTokensFromChars(0)).toBe(0);
  });
});
