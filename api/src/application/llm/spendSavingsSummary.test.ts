import { describe, expect, it } from 'vitest';
import type { ModelPrice } from '@builderforce/model-catalog';
import type { PriceBook } from './catalogView';
import { foldSpendSavings, type UsageSlice } from './spendSavingsSummary';

/**
 * The pricing rules behind the chat's spend pill and the Status tab — pure over the
 * grouped ledger slices and a price book, so each rule is pinned here without a database.
 */

const PRICED = 'acme/priced';
/** $1 / M input, $2 / M output. */
const PRICES: Record<string, ModelPrice> = { [PRICED]: { input: 0.000001, output: 0.000002 } };
const book: PriceBook = { priceOf: (model) => PRICES[model] };

function slice(over: Partial<UsageSlice> = {}): UsageSlice {
  return {
    model: PRICED, unpriced: !PRICES[over.model ?? PRICED], byo: false, savingsSource: null, savingsEstimated: false,
    prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0, total: 0,
    costMc: 0, calls: 0, cacheCalls: 0,
    savedPrompt: 0, savedCompletion: 0, recallPrompt: 0, savedCostMc: 0,
    trimCalls: 0, recallCalls: 0, rows: 1,
    ...over,
  };
}

const sourceRows = (summary: ReturnType<typeof foldSpendSavings>, source: string) =>
  summary.saved.bySource.filter((row) => row.source === source);

describe('foldSpendSavings — SPENT', () => {
  it('prices BYO calls at list into "your key", and keeps the platform figure as stamped', () => {
    const summary = foldSpendSavings([
      slice({ byo: true, prompt: 1000, completion: 500, total: 1500, calls: 2 }),
      slice({ prompt: 200, completion: 100, total: 300, costMc: 500, calls: 1 }),
    ], book);
    // (1000 × $1/M + 500 × $2/M) = $0.002
    expect(summary.spend.yourKeyUsd).toBeCloseTo(0.002, 6);
    expect(summary.spend.platformUsd).toBeCloseTo(0.005, 6);
    expect(summary.spend.totalUsd).toBeCloseTo(0.007, 6);
    expect(summary.spend.requests).toBe(3);
    expect(summary.spend.totalTokens).toBe(1800);
  });

  it('counts tokens on a model the catalog does not price, without valuing them', () => {
    const summary = foldSpendSavings([slice({ model: 'acme/unknown', byo: true, prompt: 700, completion: 77, total: 777, calls: 1 })], book);
    expect(summary.spend.unpricedTokens).toBe(777);
    expect(summary.spend.yourKeyUsd).toBe(0);
    expect(summary.spend.totalTokens).toBe(777);
  });
});

describe('foldSpendSavings — SAVED', () => {
  it('values an avoided call by its stamped savedCostMc and spends nothing on it', () => {
    const summary = foldSpendSavings([
      slice({ savingsSource: 'memory_answer', savedCostMc: 300, savedPrompt: 100, savedCompletion: 50, rows: 3 }),
    ], book);
    expect(sourceRows(summary, 'memory_answer')).toEqual([{ source: 'memory_answer', usd: 0.003, tokens: 150, events: 3, estimated: false }]);
    expect(summary.spend.requests).toBe(0);
    expect(summary.spend.totalUsd).toBe(0);
    expect(summary.saved.measuredUsd).toBeCloseTo(0.003, 6);
  });

  it("nets the provider prompt cache: reads save 0.9× input, writes give back 0.25×", () => {
    const summary = foldSpendSavings([slice({ cacheRead: 10_000, cacheCreation: 2_000, prompt: 12_000, total: 12_000, calls: 4, cacheCalls: 3 })], book);
    // (10 000 × 0.9 − 2 000 × 0.25) × $1/M = $0.0085
    const [cache] = sourceRows(summary, 'prompt_cache');
    expect(cache).toMatchObject({ tokens: 10_000, events: 3, estimated: false });
    expect(cache!.usd).toBeCloseTo(0.0085, 6);
    expect(summary.saved.measuredUsd).toBeCloseTo(0.0085, 6);
  });

  it('subtracts what recall added to prompts from the estimated savings', () => {
    const summary = foldSpendSavings([
      slice({ prompt: 5000, total: 5000, calls: 2, savedPrompt: 1000, trimCalls: 1, recallPrompt: 400, recallCalls: 2 }),
    ], book);
    const [trim] = sourceRows(summary, 'context_trim');
    const [recall] = sourceRows(summary, 'recall_overhead');
    expect(trim!.usd).toBeCloseTo(0.001, 6);
    expect(recall).toMatchObject({ tokens: -400, events: 2, estimated: true });
    expect(recall!.usd).toBeCloseTo(-0.0004, 6);
    expect(summary.saved.estimatedUsd).toBeCloseTo(0.0006, 6);
    expect(summary.saved.tokensSaved).toBe(600);
  });

  it('keeps measured and estimated rows of the SAME source apart', () => {
    const summary = foldSpendSavings([
      slice({ savingsSource: 'memory_answer', savingsEstimated: false, savedCostMc: 500, savedPrompt: 100, rows: 1 }),
      slice({ savingsSource: 'memory_answer', savingsEstimated: true, savedCostMc: 200, savedPrompt: 80, rows: 2 }),
    ], book);
    const rows = sourceRows(summary, 'memory_answer');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => !row.estimated)).toMatchObject({ usd: 0.005, tokens: 100, events: 1 });
    expect(rows.find((row) => row.estimated)).toMatchObject({ usd: 0.002, tokens: 80, events: 2 });
    expect(summary.saved.measuredUsd).toBeCloseTo(0.005, 6);
    expect(summary.saved.estimatedUsd).toBeCloseTo(0.002, 6);
  });

  it('reports the share saved, and null when nothing was spent or saved', () => {
    expect(foldSpendSavings([], book).savedPct).toBeNull();
    const summary = foldSpendSavings([
      slice({ prompt: 100, total: 100, costMc: 300, calls: 1 }),
      slice({ savingsSource: 'response_cache', savedCostMc: 100, savedPrompt: 10, rows: 1 }),
    ], book);
    // saved $0.001 ÷ (spent $0.003 + saved $0.001)
    expect(summary.savedPct).toBeCloseTo(0.25, 6);
  });
});
