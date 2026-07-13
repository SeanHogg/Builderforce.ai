import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetMemoryCooldowns,
  classifyFailure,
  loadCooldowns,
  loadCooledVendors,
  recordFailure,
  type CooldownEnv,
} from './cooldownStore';
import type { VendorId } from '../../application/llm/vendors';

// ---------------------------------------------------------------------------
// Gap [1230]: 400/422 request-validation failures are the CALLER's bug, not the
// model's or vendor's. They must write NEITHER per-model NOR vendor cooldown —
// otherwise a tenant's schema typo benches a healthy model for the next caller
// and (worse) trips vendor cooldown, starving every tenant on that upstream.
// In-memory backend (no AUTH_CACHE_KV bound) is the unit-test surface.
// ---------------------------------------------------------------------------

const env: CooldownEnv = {}; // no KV → in-memory backend
const VENDOR: VendorId = 'openrouter';
const MODEL = 'openrouter/qwen3-coder:free';

beforeEach(() => _resetMemoryCooldowns());
afterEach(() => _resetMemoryCooldowns());

describe('classifyFailure', () => {
  it('classifies 400 and 422 as request_error', () => {
    expect(classifyFailure(400)).toBe('request_error');
    expect(classifyFailure(422)).toBe('request_error');
  });

  it('keeps auth/transient/embedded classification intact', () => {
    expect(classifyFailure(401)).toBe('auth');
    expect(classifyFailure(403)).toBe('auth');
    expect(classifyFailure(429)).toBe('transient');
    expect(classifyFailure(500)).toBe('transient');
    expect(classifyFailure(200, 'embedded:empty: ...')).toBe('embedded');
  });
});

describe('recordFailure — request_error (400/422)', () => {
  it('writes NO per-model cooldown on a 400', async () => {
    await recordFailure(env, VENDOR, MODEL, 400);

    const cooled = await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }]);
    expect(cooled.has(`${VENDOR}/${MODEL}`)).toBe(false);
  });

  it('writes NO per-model cooldown on a 422', async () => {
    await recordFailure(env, VENDOR, MODEL, 422);

    const cooled = await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }]);
    expect(cooled.has(`${VENDOR}/${MODEL}`)).toBe(false);
  });

  it('does NOT trip vendor cooldown even after the transient threshold of 400s', async () => {
    // Three transient failures in-window WOULD trip vendor cooldown; three 400s
    // must not, because request errors are caller-side, not vendor saturation.
    await recordFailure(env, VENDOR, MODEL, 400);
    await recordFailure(env, VENDOR, MODEL, 400);
    await recordFailure(env, VENDOR, MODEL, 400);

    const cooledVendors = await loadCooledVendors(env, [VENDOR]);
    expect(cooledVendors.has(VENDOR)).toBe(false);
  });

  it('still cools the model on a real transient (429) — regression guard', async () => {
    await recordFailure(env, VENDOR, MODEL, 429);

    const cooled = await loadCooldowns(env, [{ vendor: VENDOR, model: MODEL }]);
    expect(cooled.has(`${VENDOR}/${MODEL}`)).toBe(true);
  });
});
