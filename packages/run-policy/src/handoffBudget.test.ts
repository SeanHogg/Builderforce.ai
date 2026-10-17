import { describe, expect, it } from 'vitest';
import { DEFAULT_HANDOFF_RESERVE_TOKENS, handoffReserveTokens, toolSchemaTokens } from './handoffBudget';

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
