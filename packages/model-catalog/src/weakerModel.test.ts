import { describe, expect, it } from 'vitest';
import { priceBookFromPrices } from './priceBook.js';
import { catalogIdCandidates, isWeakerModel, tierOfModel } from './weakerModel.js';

/** The catalog spells Claude ids dotted (`anthropic/claude-opus-4.5`); a provider-native runner says `claude-opus-4-5`. */
const BOOK = priceBookFromPrices([
  ['anthropic/claude-opus-4.5', { input: 5e-6, output: 25e-6 }],
  ['anthropic/claude-sonnet-4.5', { input: 3e-6, output: 15e-6 }],
  ['anthropic/claude-haiku-4.5', { input: 1e-6, output: 5e-6 }],
  ['openai/gpt-free', { input: 0, output: 0 }],
  ['moonshotai/kimi-k3', { input: 1e-6, output: 3e-6 }],
]);

describe('isWeakerModel', () => {
  it('is true only for a worse catalog tier', () => {
    expect(isWeakerModel('anthropic/claude-opus-4.5', 'anthropic/claude-haiku-4.5', BOOK)).toBe(true);
    expect(isWeakerModel('anthropic/claude-sonnet-4.5', 'openai/gpt-free', BOOK)).toBe(true);
    expect(isWeakerModel('anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.5', BOOK)).toBe(false);
  });

  it('is false for the same model, a model of the same standing, or one the book cannot price', () => {
    expect(isWeakerModel('anthropic/claude-opus-4.5', 'anthropic/claude-opus-4.5', BOOK)).toBe(false);
    expect(isWeakerModel('anthropic/claude-haiku-4.5', 'moonshotai/kimi-k3', BOOK)).toBe(false); // both STANDARD
    expect(isWeakerModel('anthropic/claude-opus-4.5', 'mystery-model', BOOK)).toBe(false);
    expect(isWeakerModel('mystery-model', 'openai/gpt-free', BOOK)).toBe(false);
    expect(isWeakerModel(undefined, 'anthropic/claude-haiku-4.5', BOOK)).toBe(false);
    expect(isWeakerModel('anthropic/claude-opus-4.5', 'default', BOOK)).toBe(false);
  });

  it('resolves a provider-native id and a provider-qualified one to the same model', () => {
    for (const opus of ['anthropic/claude-opus-4.5', 'anthropic/claude-opus-4-5', 'claude-opus-4-5', 'claude-opus-4.5']) {
      expect(tierOfModel(opus, BOOK), opus).toBe('ULTRA');
    }
    // A direct-provider failover as the legacy runner reports it (`${provider}/${id}`): opus -> haiku.
    expect(isWeakerModel('anthropic/claude-opus-4-5', 'anthropic/claude-haiku-4-5', BOOK)).toBe(true);
    // …and bare against qualified.
    expect(isWeakerModel('claude-opus-4-5', 'anthropic/claude-haiku-4.5', BOOK)).toBe(true);
    expect(isWeakerModel('claude-haiku-4-5', 'anthropic/claude-opus-4.5', BOOK)).toBe(false);
  });
});

describe('catalogIdCandidates', () => {
  it('gives the id as spoken, then the catalog spelling for a native Claude id', () => {
    expect(catalogIdCandidates('moonshotai/kimi-k3')).toEqual(['moonshotai/kimi-k3']);
    expect(catalogIdCandidates('claude-opus-4-5')).toEqual(['claude-opus-4-5', 'anthropic/claude-opus-4.5']);
    expect(catalogIdCandidates('anthropic/claude-sonnet-4-6')).toEqual(['anthropic/claude-sonnet-4-6', 'anthropic/claude-sonnet-4.6']);
    expect(catalogIdCandidates('claude-opus-5')).toEqual(['claude-opus-5', 'anthropic/claude-opus-5.0', 'anthropic/claude-opus-5']);
  });
});
