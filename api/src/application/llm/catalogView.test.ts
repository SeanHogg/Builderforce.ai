import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CatalogModel } from './modelCatalog';

const catalogMock = vi.fn<() => Promise<CatalogModel[]>>();
vi.mock('./modelCatalog', () => ({ getCatalogCached: () => catalogMock() }));

import { EMPTY_PRICE_BOOK, catalogPriceId, listPriceOf, priceBookFrom, pricesForCall, registryCatalogView } from './catalogView';

function model(id: string, prompt: number, completion: number): CatalogModel {
  return {
    id, name: id, provider: 'x', description: '', contextLength: 0,
    pricing: { prompt, completion }, tier: prompt === 0 && completion === 0 ? 'FREE' : 'STANDARD', routable: false,
  };
}

const env = {} as never;

describe('price book', () => {
  it('prices a registered OpenRouter connection ref under its bare catalog id', () => {
    expect(catalogPriceId('openrouter/openai/gpt-4.1')).toBe('openai/gpt-4.1');
    expect(catalogPriceId('direct/anthropic/claude-sonnet-5-5')).toBe('direct/anthropic/claude-sonnet-5-5');
  });

  it('indexes one catalog snapshot once and answers per-token prices', () => {
    const snapshot = [model('openai/gpt-4.1', 2e-6, 8e-6)];
    const book = priceBookFrom(snapshot);
    expect(priceBookFrom(snapshot)).toBe(book);
    expect(book.priceOf('openrouter/openai/gpt-4.1')).toEqual({ input: 2e-6, output: 8e-6 });
    expect(book.priceOf('unknown/model')).toBeUndefined();
  });

  it('values a direct-vendor id at its catalog LIST price, but never bills it', () => {
    const book = priceBookFrom([model('minimax/minimax-m2.7', 4e-7, 2.2e-6)]);
    // Billing (`priceOf`) is unchanged: a direct route is not a catalog id.
    expect(book.priceOf('direct/minimax/MiniMax-M2.7')).toBeUndefined();
    // The list price a BYO call / a saving is valued at resolves it.
    expect(listPriceOf(book, 'direct/minimax/MiniMax-M2.7')).toEqual({ input: 4e-7, output: 2.2e-6 });
    expect(listPriceOf(book, 'direct/minimax/unknown')).toBeUndefined();
  });

  it('an unpriced view answers routing questions but never a price', () => {
    const view = registryCatalogView(EMPTY_PRICE_BOOK);
    expect(view.priceOf?.('openai/gpt-4.1')).toBeUndefined();
    expect(typeof view.vendorOf('openai/gpt-4.1')).toBe('string');
  });

  it('a priced view carries long-context tiers so cost ordering sees the step-up (C9)', () => {
    const view = registryCatalogView(priceBookFrom([
      model('google/gemini-2.5-pro', 1.25e-6, 1e-5),
      model('openai/gpt-4.1', 2e-6, 8e-6),
    ]));
    const tiered = view.priceOf?.('google/gemini-2.5-pro');
    expect(tiered).toMatchObject({ input: 1.25e-6, output: 1e-5 });
    expect(tiered?.priceTiers?.[0]?.aboveInputTokens).toBe(200_000);
    // A flat-priced family is returned unchanged.
    expect(view.priceOf?.('openai/gpt-4.1')).toEqual({ input: 2e-6, output: 8e-6 });
  });
});

describe('pricesForCall', () => {
  beforeEach(() => catalogMock.mockReset());

  it('loads prices only for a cost-first call', async () => {
    catalogMock.mockResolvedValue([model('openai/gpt-4.1', 2e-6, 8e-6)]);
    const book = await pricesForCall(env, 'explore', undefined);
    expect(book?.priceOf('openai/gpt-4.1')).toEqual({ input: 2e-6, output: 8e-6 });
  });

  it('skips the catalog read for any other call', async () => {
    expect(await pricesForCall(env, 'code', undefined)).toBeUndefined();
    expect(await pricesForCall(env, 'plan', 'make')).toBeUndefined();
    expect(await pricesForCall(env, undefined, undefined)).toBeUndefined();
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it('an unreachable catalog is an empty book, never an error', async () => {
    catalogMock.mockResolvedValue([]);
    expect((await pricesForCall(env, 'utility', undefined))?.priceOf('openai/gpt-4.1')).toBeUndefined();
  });
});
