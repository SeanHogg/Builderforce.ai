import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetMemoryCooldowns,
  classifyFailure,
  loadCooledVendorExpiries,
  loadCooledVendors,
  loadCooldowns,
  recordFailure,
  type CooldownEnv,
} from './cooldownStore';
import { CAPACITY_LIMIT_MARKER } from '../../application/llm/vendors';
import type { VendorId } from '../../application/llm/vendors';

// ---------------------------------------------------------------------------
// A usage cap / spend limit / low credit balance is a property of the whole KEY
// (the account is out of budget), not one model. The vendor maps it to a
// retryable 429 carrying CAPACITY_LIMIT_MARKER so the cascade fails over; the
// cooldown store must then (a) classify it as `capacity`, (b) trip the VENDOR
// cooldown on the FIRST strike (every model on the key is unreachable), and
// (c) back off far LONGER than the 5-min transient window — a monthly cap won't
// recover for hours-to-days, and re-reaching the key wastes calls (and, until
// the cap tripped, re-SPENT real money on a metered floor). In-memory backend.
// ---------------------------------------------------------------------------

const env: CooldownEnv = {}; // no KV → in-memory backend
const VENDOR: VendorId = 'anthropic';
const MODEL = 'claude-sonnet-4-6';
const CAPACITY_HINT = `${CAPACITY_LIMIT_MARKER} (upstream 400): You have reached your specified API usage limits.`;

beforeEach(() => _resetMemoryCooldowns());
afterEach(() => _resetMemoryCooldowns());

describe('classifyFailure — capacity', () => {
  it('classifies a capacity-marked 429 as capacity (not transient)', () => {
    expect(classifyFailure(429, CAPACITY_HINT)).toBe('capacity');
  });

  it('classifies a capacity-marked error even if it arrives as a 400', () => {
    // The marker wins over the status: capacity is checked before the
    // request_error/auth gates so a 400-shaped cap is still a capacity backoff.
    expect(classifyFailure(400, CAPACITY_HINT)).toBe('capacity');
  });

  it('leaves an ordinary 429 (no marker) as transient', () => {
    expect(classifyFailure(429)).toBe('transient');
    expect(classifyFailure(429, 'rate limited, slow down')).toBe('transient');
  });
});

describe('recordFailure — capacity', () => {
  it('trips the VENDOR cooldown on the first strike', async () => {
    await recordFailure(env, VENDOR, MODEL, 429, CAPACITY_HINT);

    const cooled = await loadCooledVendors(env, [VENDOR]);
    expect(cooled.has(VENDOR)).toBe(true);
  });

  it('also cools the model itself', async () => {
    await recordFailure(env, VENDOR, MODEL, 429, CAPACITY_HINT);

    const cooled = await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }]);
    expect(cooled.has(`${VENDOR}/${MODEL}`)).toBe(true);
  });

  it('backs off far longer than a transient (≫ 5 min)', async () => {
    await recordFailure(env, VENDOR, MODEL, 429, CAPACITY_HINT);

    const expiries = await loadCooledVendorExpiries(env, [VENDOR]);
    const until = expiries.get(VENDOR);
    expect(until).toBeDefined();
    // Transient vendor cooldown is 5 min; capacity must be materially longer.
    const remainingMs = (until ?? 0) - Date.now();
    expect(remainingMs).toBeGreaterThan(30 * 60 * 1000); // > 30 min
  });
});
