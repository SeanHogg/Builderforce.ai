import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CatalogModel } from './modelCatalog';

const catalogMock = vi.fn<() => Promise<CatalogModel[]>>();
vi.mock('./modelCatalog', () => ({ getCatalogCached: () => catalogMock() }));

import { EMPTY_PRICE_BOOK, catalogPriceId, priceBookFrom, pricesForCall, registryCatalogView } from './catalogView';

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

  it('an unpriced view answers routing questions but never a price', () => {
    const view = registryCatalogView(EMPTY_PRICE_BOOK);
    expect(view.priceOf?.('openai/gpt-4.1')).toBeUndefined();
    expect(typeof view.vendorOf('openai/gpt-4.1')).toBe('string');
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
