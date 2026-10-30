import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ live: { priceOf: (_m: string): { input: number; output: number } | undefined => undefined } }));
vi.mock('../../llm/catalogView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../llm/catalogView')>()),
  loadPriceBook: async () => h.live,
}));

import type { Env } from '../../../env';
import { WEAKER_SERVED_MARKER, servedWeakerThanRequested } from './servedWeaker';

/**
 * The cloud decides `run_model_outcomes.degraded` PER TURN by the same rule as the ONE agent's row and the
 * legacy runner: served by a model WEAKER than the run asked for (`isWeakerModel`). It no longer hangs on the
 * `coding_model_degraded` event, which only fires for a model that is not a curated coder.
 */
const env = {} as Env;
const ULTRA_CODER = 'anthropic/claude-opus-4.5';
const STANDARD_CODER = 'anthropic/claude-haiku-4.5';

describe('servedWeakerThanRequested', () => {
  it('an ULTRA coder that fell through to a STANDARD curated coder is degraded (no coding_model_degraded event exists for it)', async () => {
    h.live = { priceOf: (m) => (m === ULTRA_CODER ? { input: 5e-6, output: 25e-6 } : m === STANDARD_CODER ? { input: 1e-6, output: 5e-6 } : undefined) };
    expect(await servedWeakerThanRequested(env, ULTRA_CODER, STANDARD_CODER)).toBe(true);
  });

  it('a STANDARD coder floored onto a STRONGER generalist is NOT degraded', async () => {
    expect(await servedWeakerThanRequested(env, STANDARD_CODER, ULTRA_CODER)).toBe(false);
  });

  it('reads the LIVE catalog first: a repriced model is judged by its current price', async () => {
    h.live = { priceOf: (m) => (m === STANDARD_CODER ? { input: 5e-6, output: 25e-6 } : m === ULTRA_CODER ? { input: 5e-6, output: 25e-6 } : undefined) };
    expect(await servedWeakerThanRequested(env, ULTRA_CODER, STANDARD_CODER)).toBe(false);
  });

  it('falls back to the bundled snapshot for a model the live catalog does not price', async () => {
    h.live = { priceOf: () => undefined };
    expect(await servedWeakerThanRequested(env, ULTRA_CODER, STANDARD_CODER)).toBe(true);
  });

  it('says nothing about a turn it cannot rank: no intended model, an unpriced model', async () => {
    expect(await servedWeakerThanRequested(env, undefined, STANDARD_CODER)).toBe(false);
    expect(await servedWeakerThanRequested(env, '', STANDARD_CODER)).toBe(false);
    expect(await servedWeakerThanRequested(env, ULTRA_CODER, 'mystery/unpriced')).toBe(false);
  });

  it('the scorer filters for exactly the text the turn writes', () => {
    expect(JSON.stringify({ model: 'm', weaker: true, step: 1 })).toContain(WEAKER_SERVED_MARKER);
    expect(JSON.stringify({ model: 'm', weaker: false, step: 1 })).not.toContain(WEAKER_SERVED_MARKER);
  });
});
