/**
 * The device's spend cap and savings ledger agree with the one "served on the device" rule: a hosted
 * runtime that merely uses the `local/` grammar (Kimi Code) is the person's own account — priced and
 * capped like a direct call, no local saving booked — while Synapse / WebLLM stay free.
 */
import { describe, expect, it } from 'vitest';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { callCostMillicents } from './callCost';
import { usageRouteOf } from './usageLedger';

const BOOK = priceBookFromPrices([['kimi-code/k2', { input: 1e-6, output: 2e-6 }]]);
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
});

describe('callCostMillicents — Kimi Code counts against the cap', () => {
  it('prices a served Kimi Code call under its direct spelling', () => {
    const viaLocalRef = callCostMillicents('local/kimi-code/k2', MILLION, BOOK, 'byo-direct');

    expect(viaLocalRef).toBeGreaterThan(0);
    expect(viaLocalRef).toBe(callCostMillicents('direct/kimi-code/k2', MILLION, BOOK, 'byo-direct'));
  });

  it('reads the route a model implies: Kimi Code is own-account spend, Synapse and WebLLM are free', () => {
    expect(callCostMillicents('local/kimi-code/k2', MILLION, BOOK)).toBeGreaterThan(0);
    expect(callCostMillicents('local/synapse/qwen', MILLION, BOOK)).toBe(0);
    expect(callCostMillicents('local/webllm/qwen', MILLION, BOOK)).toBe(0);
  });

  it('keeps every on-device call free even when its route says otherwise', () => {
    expect(callCostMillicents('local/webllm/qwen', MILLION, BOOK, 'local')).toBe(0);
  });
});
