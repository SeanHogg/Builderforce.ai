import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anthropicOutputCap } from './vendors/anthropic';
import { CODEX_AUTH_MARKER } from './vendors/openaiCodex';
import {
  DEMOTE_STREAK_THRESHOLD,
  _resetMemoryVendorHealth,
  isUpstreamFaultStatus,
  loadDemotedVendors,
  recordVendorUpstreamFault,
  recordVendorUpstreamSuccess,
} from './vendors/vendorHealth';
import {
  _resetMemoryProviderAuthAlerts,
  authAlertsFromFailovers,
  loadProviderAuthAlert,
  clearProviderAuthAlert,
  providerForVendor,
  recordProviderAuthAlerts,
} from './providerAuthAlerts';
import { byoAutoSeedModels } from './LlmProxyService';

// ---------------------------------------------------------------------------
// Coverage for four gateway gaps, exercised through the PURE seams so no live
// upstream, KV binding, or Worker runtime is needed:
//
//   1. openai-codex 401/403 is an AUTH class that surfaces as a reconnect prompt
//      (rather than dissolving into an anonymous retryable failure).
//   2. A vendor on a 5xx streak is DEMOTED in the BYO seed order — and demotion is
//      an ordering signal only, never a removal, and never triggered by the
//      cost/quota statuses the cooldown store owns.
//   4. The Anthropic output cap is raised on the STREAMING path only.
//
// (Gap 3 — Evermind inheritance — is a route projection + UI affordance with no
// pure unit to isolate; it is covered by the `inherited` field flowing from
// `contributionsCore`.)
// ---------------------------------------------------------------------------

/** No KV bound — every store falls back to its per-isolate map, which is exactly
 *  the path this suite wants to exercise. */
const env = {} as { AUTH_CACHE_KV?: KVNamespace };

beforeEach(() => {
  _resetMemoryVendorHealth();
  _resetMemoryProviderAuthAlerts();
});
afterEach(() => {
  _resetMemoryVendorHealth();
  _resetMemoryProviderAuthAlerts();
});

// ---------------------------------------------------------------------------
// Gap 1 — Codex entitlement failures reach the operator
// ---------------------------------------------------------------------------

describe('provider auth alerts', () => {
  it('maps a connectable vendor to the provider card an operator manages it from', () => {
    // The OAuth-only dispatch vendors are the whole point: a ChatGPT subscription
    // dispatches as `openai-codex` but is managed under the `openai` card.
    expect(providerForVendor('openai-codex')).toBe('openai');
    expect(providerForVendor('xai-oauth')).toBe('xai');
    expect(providerForVendor('anthropic')).toBe('anthropic');
    // An operator-pool vendor is NOT connectable — there is nothing for a tenant to
    // reconnect, so it must never raise a prompt.
    expect(providerForVendor('openrouter')).toBeNull();
  });

  it('classifies a Codex 403 as an ENTITLEMENT problem, not a bad credential', () => {
    const [alert] = authAlertsFromFailovers([
      { vendor: 'openai-codex', code: 403, kind: 'auth', detail: `${CODEX_AUTH_MARKER} (upstream 403): forbidden` },
    ]);
    expect(alert).toMatchObject({ provider: 'openai', reason: 'not_entitled', status: 403, vendor: 'openai-codex' });
  });

  it('classifies a 401 as a rejected credential (reconnect the same account)', () => {
    const [alert] = authAlertsFromFailovers([
      { vendor: 'anthropic', code: 401, kind: 'auth', detail: 'auth 401: token expired' },
    ]);
    expect(alert).toMatchObject({ provider: 'anthropic', reason: 'rejected', status: 401 });
  });

  it('ignores non-auth failures — a 429 or 502 must never prompt a reconnect', () => {
    expect(authAlertsFromFailovers([
      { vendor: 'openai-codex', code: 429, kind: 'rate_limit' },
      { vendor: 'meta', code: 502, kind: 'server_error' },
      { vendor: 'anthropic', code: 400, kind: 'client_error' },
    ])).toEqual([]);
  });

  it('ignores auth failures on vendors a tenant cannot connect', () => {
    expect(authAlertsFromFailovers([{ vendor: 'openrouter', code: 401, kind: 'auth' }])).toEqual([]);
  });

  it('keeps the FIRST auth failure per provider — the highest-precedence account', () => {
    const alerts = authAlertsFromFailovers([
      { vendor: 'openai-codex', code: 403, kind: 'auth' },
      { vendor: 'openai', code: 401, kind: 'auth' },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.vendor).toBe('openai-codex');
  });

  it('round-trips an alert through the store and clears it on reconnect', async () => {
    await recordProviderAuthAlerts(env, 7, [{ vendor: 'openai-codex', code: 403, kind: 'auth' }]);
    expect(await loadProviderAuthAlert(env, 7, 'openai')).toMatchObject({ reason: 'not_entitled' });
    // Scoped per tenant — one tenant's lapsed plan says nothing about another's.
    expect(await loadProviderAuthAlert(env, 8, 'openai')).toBeNull();
    await clearProviderAuthAlert(env, 7, 'openai');
    expect(await loadProviderAuthAlert(env, 7, 'openai')).toBeNull();
  });

  it('writes nothing when a cascade had no auth failures', async () => {
    await recordProviderAuthAlerts(env, 7, [{ vendor: 'meta', code: 502, kind: 'server_error' }]);
    expect(await loadProviderAuthAlert(env, 7, 'meta')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — 5xx streak demotes a vendor out of the BYO seed LEAD
// ---------------------------------------------------------------------------

describe('vendor upstream health', () => {
  it('counts only 5xx — the cost/quota statuses belong to the cooldown store', () => {
    expect(isUpstreamFaultStatus(502)).toBe(true);
    expect(isUpstreamFaultStatus(500)).toBe(true);
    expect(isUpstreamFaultStatus(429)).toBe(false); // rate limit — cooldown's business
    expect(isUpstreamFaultStatus(408)).toBe(false); // our own timeout, not their fault
    expect(isUpstreamFaultStatus(403)).toBe(false); // auth — cooldown's business
  });

  it('demotes only after a sustained streak, so a single blip does not flap the order', async () => {
    for (let i = 1; i < DEMOTE_STREAK_THRESHOLD; i += 1) {
      await recordVendorUpstreamFault(env, 'meta', 502);
      expect(await loadDemotedVendors(env, ['meta'])).toEqual(new Set());
    }
    await recordVendorUpstreamFault(env, 'meta', 502);
    expect(await loadDemotedVendors(env, ['meta'])).toEqual(new Set(['meta']));
  });

  it('a non-5xx failure never contributes to the streak', async () => {
    for (let i = 0; i < DEMOTE_STREAK_THRESHOLD + 2; i += 1) {
      await recordVendorUpstreamFault(env, 'meta', 429);
    }
    expect(await loadDemotedVendors(env, ['meta'])).toEqual(new Set());
  });

  it('a success clears the streak immediately — recovery is not on a timer', async () => {
    for (let i = 0; i < DEMOTE_STREAK_THRESHOLD; i += 1) await recordVendorUpstreamFault(env, 'meta', 502);
    expect(await loadDemotedVendors(env, ['meta'])).toEqual(new Set(['meta']));
    await recordVendorUpstreamSuccess(env, 'meta');
    expect(await loadDemotedVendors(env, ['meta'])).toEqual(new Set());
  });

  it('issues no lookups when nothing is connected', async () => {
    expect(await loadDemotedVendors(env, [])).toEqual(new Set());
  });
});

describe('byoAutoSeedModels demotion', () => {
  const connected = new Set(['meta', 'anthropic']);
  const priority = ['meta', 'anthropic'];

  it('honours tenant precedence when every vendor is healthy', () => {
    const seed = byoAutoSeedModels(connected, { agentic: true, vendorPriority: priority });
    expect(seed[0]).toContain('meta');
  });

  it('demotes a 5xx-streaking vendor BEHIND its healthy peers, overriding precedence', () => {
    const seed = byoAutoSeedModels(connected, {
      agentic: true,
      vendorPriority: priority,
      demotedVendors: new Set(['meta']),
    });
    // Meta no longer leads — the cascade stops paying a full vendor timeout on it
    // before reaching the account it would otherwise have used second.
    expect(seed[0]).not.toContain('meta');
    // …but it is NOT dropped. This is an ordering signal, not a gate.
    expect(seed.some((m) => m.includes('meta'))).toBe(true);
  });

  it('still leads with a demoted vendor when it is the ONLY connected account', () => {
    const seed = byoAutoSeedModels(new Set(['meta']), {
      agentic: true,
      demotedVendors: new Set(['meta']),
    });
    expect(seed).toHaveLength(1);
    expect(seed[0]).toContain('meta');
  });
});

// ---------------------------------------------------------------------------
// Gap 4 — Anthropic output cap is surface-dependent
// ---------------------------------------------------------------------------

describe('anthropicOutputCap', () => {
  it('keeps the non-streaming ceiling conservative so one turn fits the vendor timeout', () => {
    expect(anthropicOutputCap(200_000, false)).toBe(32_000);
    expect(anthropicOutputCap(64_000, false)).toBe(32_000);
  });

  it('raises the STREAMING ceiling to the model maximum', () => {
    // The 32K cap existed only for the non-streaming request timeout; a streaming
    // request returns headers on the first event, so long coding turns are safe.
    expect(anthropicOutputCap(64_000, true)).toBe(64_000);
    expect(anthropicOutputCap(200_000, true)).toBe(128_000);
  });

  it('passes a caller value through untouched when it is under both ceilings', () => {
    expect(anthropicOutputCap(8_000, false)).toBe(8_000);
    expect(anthropicOutputCap(8_000, true)).toBe(8_000);
  });

  it('defaults when the caller set nothing, and never emits a non-positive cap', () => {
    expect(anthropicOutputCap(undefined, false)).toBe(16_000);
    expect(anthropicOutputCap(undefined, true)).toBe(16_000);
    expect(anthropicOutputCap(0, false)).toBe(1);
    expect(anthropicOutputCap(-5, true)).toBe(1);
  });
});
