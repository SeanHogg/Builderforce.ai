/**
 * The device's spend cap, savings ledger and route report agree with the one "served on the device" rule: a
 * hosted runtime that merely uses the `local/` grammar (Kimi Code) is the person's own account — priced under
 * its registry catalog alias (either spelling), counted against the cap, no local saving booked — while
 * Synapse / WebLLM stay free. A call nothing prices is UNKNOWN, never free, and every surface says so.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_RUNTIMES } from '@builderforce/local-inference';
import { priceBookFromPrices, snapshotPriceBook } from '@builderforce/model-catalog';
import { callCostOrUnknown } from './callCost';
import { ledgerSpend } from './ledgerSpend';
import { routeRunRecords } from './routeLedger';
import { servedModel, usageRouteOf, type RunUsageValue } from './usageLedger';

const BOOK = priceBookFromPrices([['moonshotai/kimi-k2', { input: 1e-6, output: 2e-6 }]]);
const MILLION = { prompt: 1_000_000, completion: 500_000 };

const usageRow = (over: Partial<RunUsageValue>): RunUsageValue => ({
  clientEventId: Math.random().toString(36).slice(2),
  clientChatId: 'chat-a',
  runKey: 1,
  model: 'openai/gpt-x',
  route: 'gateway',
  promptTokens: 1_000_000,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  at: '2026-10-20T10:00:00.000Z',
  ...over,
});

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

  it('never lets the REQUESTED model name a call the cloud answered: a hosted pick the gateway served is the gateway', () => {
    const result = { localFirst: [{ target: 'local/ollama/qwen', outcome: 'failed' }, { target: 'gateway', outcome: 'served' }] };

    expect(servedModel(result, 'local/kimi-code/k3')).toBeUndefined();
    expect(usageRouteOf(result, 'local/kimi-code/k3')).toBe('gateway');
  });

  it('lets the requested model stand in only when the result says nothing of how it was served', () => {
    expect(servedModel({}, 'openai/gpt-x')).toBe('openai/gpt-x');
    expect(servedModel({ resolvedModel: 'vendor/model' }, 'openai/gpt-x')).toBe('vendor/model');
  });
});

describe('callCostOrUnknown — Kimi Code counts against the cap', () => {
  it('prices a served Kimi Code call under the catalog id its registry alias names', () => {
    const viaLocalRef = callCostOrUnknown('local/kimi-code/k2', MILLION, BOOK, 'byo-direct');

    expect(viaLocalRef).toBeGreaterThan(0);
    expect(viaLocalRef).toBe(callCostOrUnknown('moonshotai/kimi-k2', MILLION, BOOK, 'byo-direct'));
  });

  it('prices both spellings of a hosted ref the same: local/kimi-code/<m> and direct/kimi-code/<m>', () => {
    const book = snapshotPriceBook();
    const local = callCostOrUnknown('local/kimi-code/k3', MILLION, book, 'byo-direct');

    expect(local).toBeGreaterThan(0);
    expect(callCostOrUnknown('direct/kimi-code/k3', MILLION, book, 'byo-direct')).toBe(local);
    expect(callCostOrUnknown('direct/kimi-code/kimi-k3', MILLION, book)).toBe(local);
  });

  it('prices it against the device’s REAL shipped book, so the gap cannot reopen unseen', () => {
    const book = snapshotPriceBook();

    expect(callCostOrUnknown('local/kimi-code/k3', MILLION, book, 'byo-direct')).toBeGreaterThan(0);
    expect(callCostOrUnknown('local/kimi-code/kimi-k3', MILLION, book)).toBe(callCostOrUnknown('local/kimi-code/k3', MILLION, book, 'byo-direct'));
  });

  it('reports a hosted model the registry does not know as UNKNOWN, never as free', () => {
    expect(callCostOrUnknown('local/kimi-code/not-a-model', MILLION, snapshotPriceBook(), 'byo-direct')).toBeUndefined();
    expect(callCostOrUnknown('direct/kimi-code/not-a-model', MILLION, snapshotPriceBook(), 'byo-direct')).toBeUndefined();
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
});

describe('ONE unpriced decision — the cost and the fold agree', () => {
  // A book that LISTS a direct-vendor model (so listPriceOf knows it) but does not BILL it (priceOf does not).
  const LIST_ONLY = priceBookFromPrices([['minimax/minimax-m2.7', { input: 1e-6, output: 1e-6 }]]);
  const MODEL = 'direct/minimax/MiniMax-M2.7';

  it('is unpriced in the cost for a platform (gateway) call…', () => {
    expect(callCostOrUnknown(MODEL, { prompt: 1_000_000, completion: 0 }, LIST_ONLY, 'gateway')).toBeUndefined();
  });

  it('…and the fold counts the same call as unpriced tokens from the flag, not as valued spend', () => {
    const summary = ledgerSpend([usageRow({ model: MODEL, route: 'gateway' })], { excludeGateway: false, book: LIST_ONLY })!;

    expect(summary.spend.unpricedTokens).toBe(1_000_000);
    expect(summary.spend.totalUsd).toBe(0);
  });

  it('values the SAME model for the person’s own key (BYO), where the list price is the right one', () => {
    const summary = ledgerSpend([usageRow({ model: MODEL, route: 'byo-direct' })], { excludeGateway: false, book: LIST_ONLY })!;

    expect(summary.spend.unpricedTokens).toBe(0);
    expect(summary.spend.yourKeyUsd).toBeGreaterThan(0);
  });

  it('reports a hosted runtime’s model with no alias as unpriced tokens in the ledger', () => {
    const summary = ledgerSpend([usageRow({ model: 'local/kimi-code/not-a-model', route: 'byo-direct' })], { excludeGateway: false, book: snapshotPriceBook() })!;

    expect(summary.spend.unpricedTokens).toBe(1_000_000);
  });

  it('prices an aliased hosted model for the ledger under its catalog id', () => {
    const summary = ledgerSpend([usageRow({ model: 'local/kimi-code/k3', route: 'byo-direct' })], { excludeGateway: false, book: snapshotPriceBook() })!;

    expect(summary.spend.unpricedTokens).toBe(0);
    expect(summary.spend.yourKeyUsd).toBeGreaterThan(0);
  });
});

describe('the route report — an unpriced run is unknown, never $0', () => {
  const run = (rows: RunUsageValue[]) => routeRunRecords(rows.map((r) => ({ ...r, runId: 'r1', pipelineRoute: 'full' as const })), BOOK);

  it('is null when any call of the run has no known price (never a partial figure)', () => {
    const [record] = run([usageRow({ model: 'vendor/not-in-the-book' }), usageRow({ model: 'local/ollama/q', route: 'local' })]);

    expect(record!.costMc).toBeNull();
  });

  it('stays null once unknown, whatever priced call comes after it', () => {
    const [record] = run([usageRow({ model: 'vendor/not-in-the-book' }), usageRow({ model: 'openai/gpt-x', route: 'gateway' })]);

    expect(record!.costMc).toBeNull();
  });

  it('is the sum when every call is priced', () => {
    const book = priceBookFromPrices([['openai/gpt-x', { input: 1e-6, output: 2e-6 }]]);
    const [record] = routeRunRecords([usageRow({ runId: 'r1', pipelineRoute: 'full' }), usageRow({ runId: 'r1', pipelineRoute: 'full' })], book);

    expect(record!.costMc).toBe(200_000);
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
