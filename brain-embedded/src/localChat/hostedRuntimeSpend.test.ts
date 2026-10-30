/**
 * The device's spend cap and savings ledger agree with the one "served on the device" rule: a hosted
 * runtime that merely uses the `local/` grammar (Kimi Code) is the person's own account — priced under its
 * registry catalog alias, counted against the cap, no local saving booked — while Synapse / WebLLM stay
 * free. A call nothing prices is UNKNOWN, never free.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_RUNTIMES } from '@builderforce/local-inference';
import { priceBookFromPrices, snapshotPriceBook } from '@builderforce/model-catalog';
import { callCostMillicents, callCostOrUnknown } from './callCost';
import { servedModel, usageRouteOf } from './usageLedger';

const BOOK = priceBookFromPrices([['moonshotai/kimi-k2', { input: 1e-6, output: 2e-6 }]]);
const MILLION = { prompt: 1_000_000, completion: 500_000 };

describe('usageRouteOf — the device route is the one served-on-device rule', () => {
  it('books a served Kimi Code call as the person’s own direct spend, not a local one', () => {
    expect(usageRouteOf({ resolvedModel: 'local/kimi-code/k2' })).toBe('byo-direct');
    expect(usageRouteOf({ localFirst: [{ target: 'local/kimi-code/k2', outcome: 'served' }] })).toBe('byo-direct');
  });

  it('keeps Synapse, WebLLM and Ollama on the device', () => {
    expect(usageRouteOf({ resolvedModel: 'local/synapse/qwen' })).toBe('local');
    expect(usageRouteOf({ resolvedModel: 'local/webllm/qwen' })).toBe('local');
    expect(usageRouteOf({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'served' }] })).toBe('local');
  });

  it('does not book a call as local because a local model was asked for', () => {
    expect(usageRouteOf({ localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'vendor/model', outcome: 'served' }] }, 'local/ollama/qwen')).toBe('gateway');
    expect(usageRouteOf({}, 'local/ollama/qwen')).toBe('gateway');
  });

  it('names a BYO call by the model the stream resolved, not the "gateway" placeholder of the served attempt', () => {
    const result = {
      localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'gateway', outcome: 'served' }],
      resolvedModel: 'direct/minimax/MiniMax-M2.7',
    };

    expect(usageRouteOf(result, 'local/ollama/qwen')).toBe('byo-direct');
    expect(servedModel(result, 'local/ollama/qwen')).toBe('direct/minimax/MiniMax-M2.7');
  });
});

describe('callCostOrUnknown — Kimi Code counts against the cap', () => {
  it('prices a served Kimi Code call under the catalog id its registry alias names', () => {
    const viaLocalRef = callCostOrUnknown('local/kimi-code/k2', MILLION, BOOK, 'byo-direct');

    expect(viaLocalRef).toBeGreaterThan(0);
    expect(viaLocalRef).toBe(callCostOrUnknown('moonshotai/kimi-k2', MILLION, BOOK, 'byo-direct'));
  });

  it('prices it against the device’s REAL shipped book, so the gap cannot reopen unseen', () => {
    const book = snapshotPriceBook();

    expect(callCostOrUnknown('local/kimi-code/k3', MILLION, book, 'byo-direct')).toBeGreaterThan(0);
    expect(callCostOrUnknown('local/kimi-code/kimi-k3', MILLION, book)).toBe(callCostOrUnknown('local/kimi-code/k3', MILLION, book, 'byo-direct'));
  });

  it('reports a hosted model the registry does not know as UNKNOWN, never as free', () => {
    expect(callCostOrUnknown('local/kimi-code/not-a-model', MILLION, snapshotPriceBook(), 'byo-direct')).toBeUndefined();
  });

  it('reports any unpriced call off the device as unknown, and a call with no model as unknown', () => {
    expect(callCostOrUnknown('vendor/not-in-the-book', MILLION, BOOK, 'gateway')).toBeUndefined();
    expect(callCostOrUnknown(undefined, MILLION, BOOK)).toBeUndefined();
  });

  it('keeps every on-device call free, by its route — the model id is not consulted again', () => {
    expect(callCostOrUnknown('local/webllm/qwen', MILLION, BOOK, 'local')).toBe(0);
    expect(callCostOrUnknown('local/synapse/qwen', MILLION, BOOK)).toBe(0);
    expect(callCostOrUnknown('local/webllm/qwen', MILLION, BOOK)).toBe(0);
  });

  it('the plain-number wrapper still prints an unknown as 0, for reports that print a figure', () => {
    expect(callCostMillicents('vendor/not-in-the-book', MILLION, BOOK, 'gateway')).toBe(0);
  });
});

describe('the runtime registry — a hosted runtime must be priceable', () => {
  const hosted = LOCAL_RUNTIMES.filter((runtime) => !runtime.onDevice);

  it('has at least one hosted runtime to hold to the rule', () => {
    expect(hosted.length).toBeGreaterThan(0);
  });

  it.each(hosted.map((runtime) => [runtime.id, runtime] as const))('%s has a gateway vendor and a catalog alias for every model, each priced by the shipped book', (_id, runtime) => {
    expect(runtime.gatewayVendor).toBeTruthy();
    const aliases = Object.entries(runtime.catalogAliases ?? {});
    expect(aliases.length).toBeGreaterThan(0);
    const book = snapshotPriceBook();
    for (const [model, catalogId] of aliases) {
      expect(book.priceOf(catalogId), `${runtime.id}/${model} → ${catalogId} is not in the shipped price book`).toBeDefined();
    }
  });
});
