import { describe, expect, it } from 'vitest';
import { DEFAULT_HANDOFF_RESERVE_TOKENS, handoffReserveTokens, handoffTokenBudget, toolSchemaTokens } from './handoffBudget';

describe('hand-off budget inputs', () => {
  it('reserves the request max_tokens, else the shared default', () => {
    expect(handoffReserveTokens(512)).toBe(512);
    expect(handoffReserveTokens(undefined)).toBe(DEFAULT_HANDOFF_RESERVE_TOKENS);
    expect(handoffReserveTokens(0)).toBe(DEFAULT_HANDOFF_RESERVE_TOKENS);
  });

  it('prices the advertised schemas with the caller estimator, and nothing for none', () => {
    const estimate = (text: string) => text.length;
    expect(toolSchemaTokens(undefined, estimate)).toBe(0);
    expect(toolSchemaTokens([], estimate)).toBe(0);
    expect(toolSchemaTokens([{ name: 'a' }], estimate)).toBe(JSON.stringify([{ name: 'a' }]).length);
  });
});

describe('handoffTokenBudget', () => {
  it('without a tier it is exactly min(cost cap, window - reserve)', () => {
    expect(handoffTokenBudget({ costCapTokens: 40_000, contextWindow: 128_000, reserveOutputTokens: 4_096 })).toBe(40_000);
    expect(handoffTokenBudget({ costCapTokens: 40_000, contextWindow: 32_000, reserveOutputTokens: 4_096 })).toBe(27_904);
    expect(handoffTokenBudget({ costCapTokens: 40_000 })).toBe(40_000);
    expect(handoffTokenBudget({ contextWindow: 1_000_000, reserveOutputTokens: 4_096 })).toBe(995_904);
    expect(handoffTokenBudget({})).toBeUndefined();
  });

  it('caps at the lowest long-context price boundary when one is passed', () => {
    expect(handoffTokenBudget({ contextWindow: 1_000_000, reserveOutputTokens: 4_096, priceTierBoundary: 200_000 })).toBe(200_000);
    // A cost cap already under the boundary is unaffected.
    expect(handoffTokenBudget({ costCapTokens: 40_000, contextWindow: 1_000_000, priceTierBoundary: 200_000 })).toBe(40_000);
  });

  it('never goes below 1', () => {
    expect(handoffTokenBudget({ contextWindow: 100, reserveOutputTokens: 4_096 })).toBe(1);
  });
});
