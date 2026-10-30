import { describe, expect, it } from 'vitest';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { foldSpendSavings, type UsageSlice } from './index.js';

/** $1 / M input, $2 / M output. */
const book = priceBookFromPrices([['acme/priced', { input: 0.000001, output: 0.000002 }]]);

function slice(over: Partial<UsageSlice> = {}): UsageSlice {
  return {
    model: 'acme/priced', unpriced: false, byo: false, savingsSource: null, savingsEstimated: false,
    prompt: 1000, completion: 500, cacheRead: 0, cacheCreation: 0, total: 1500,
    costMc: 0, calls: 1, cacheCalls: 0,
    savedPrompt: 0, savedCompletion: 0, recallPrompt: 0, savedCostMc: 0,
    trimCalls: 0, recallCalls: 0, rows: 1,
    ...over,
  };
}

describe('foldSpendSavings — the producer states whether a call was priced', () => {
  it('unpriced: true counts the tokens unpriced even when the book prices the model', () => {
    const summary = foldSpendSavings([slice({ byo: true, unpriced: true })], book);
    expect(summary.spend.unpricedTokens).toBe(1500);
    expect(summary.spend.yourKeyUsd).toBe(0);
  });

  it('unpriced: false values the call even when the book does not price the model — the fold never re-derives it', () => {
    const summary = foldSpendSavings([slice({ model: 'acme/unknown', byo: true, unpriced: false })], book);
    expect(summary.spend.unpricedTokens).toBe(0);
    expect(summary.spend.yourKeyUsd).toBe(0);
    expect(summary.spend.totalTokens).toBe(1500);
  });

  it('a priced BYO call is valued at list into your key', () => {
    const summary = foldSpendSavings([slice({ byo: true })], book);
    expect(summary.spend.unpricedTokens).toBe(0);
    expect(summary.spend.yourKeyUsd).toBeCloseTo(0.002, 6);
  });
});
