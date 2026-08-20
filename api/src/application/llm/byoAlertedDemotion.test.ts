/**
 * A KNOWN-BROKEN BYO account must stop LEADING the seed.
 *
 * The failure this covers: a workspace connects two providers, one of them returns
 * 401, and every subsequent request still leads with the dead one — burning an
 * upstream attempt and failing over — until the owner notices. Routing already had
 * the slot (`byoAutoSeedModels`'s `demotedVendors`), but the only feed into it was
 * a VENDOR-GLOBAL 5xx streak, which cannot speak for one owner's account.
 *
 * DEMOTE, NEVER REMOVE is the load-bearing half: a `capacity` alert self-heals when
 * the billing period rolls over, and removing the vendor would silently move the
 * funding source from the tenant's own account to our shared pool.
 */

import { describe, it, expect } from 'vitest';
import { byoAutoSeedModels } from './modelPool';
import { providerForVendor, byoVendorIdFor, PROVIDER_VENDOR_MAP } from './llmProviderCatalog';
import { pickCloudModel } from './LlmProxyService';
import { vendorForModel } from './vendors';

describe('provider catalog leaf (cycle break)', () => {
  it('maps every vendor id back to the provider that owns it', () => {
    for (const provider of Object.keys(PROVIDER_VENDOR_MAP) as Array<keyof typeof PROVIDER_VENDOR_MAP>) {
      expect(providerForVendor(PROVIDER_VENDOR_MAP[provider].vendorId)).toBe(provider);
    }
    // The OAuth-only dispatch vendors have no row of their own, and are exactly the
    // ones a naive inverse would drop — which would leave a connected ChatGPT or
    // SuperGrok subscription unmatched by its own provider's alert.
    expect(providerForVendor(byoVendorIdFor('openai', 'oauth'))).toBe('openai');
    expect(providerForVendor(byoVendorIdFor('xai', 'oauth'))).toBe('xai');
  });

  it('returns null for an operator-pool vendor no tenant can own', () => {
    expect(providerForVendor('openrouter')).toBeNull();
    expect(providerForVendor('cloudflare')).toBeNull();
  });
});

describe('byoAutoSeedModels — alerted vendors are demoted, not dropped', () => {
  const connected = new Set(['anthropic', 'googleai']);

  it('leads with the healthy account when the other is alerted', () => {
    const healthy = byoAutoSeedModels(connected, { agentic: true });
    expect(healthy.length).toBeGreaterThan(1);

    const leadVendor = vendorForModel(healthy[0]!);
    const demoted = byoAutoSeedModels(connected, {
      agentic: true,
      demotedVendors: new Set([leadVendor]),
    });
    expect(vendorForModel(demoted[0]!)).not.toBe(leadVendor);
  });

  it('keeps the alerted vendor IN the seed — a capacity alert self-heals', () => {
    const all = byoAutoSeedModels(connected, { agentic: true });
    const leadVendor = vendorForModel(all[0]!);
    const demoted = byoAutoSeedModels(connected, {
      agentic: true,
      demotedVendors: new Set([leadVendor]),
    });
    // Same models, different order. Removal would change the funding source.
    expect([...demoted].sort()).toEqual([...all].sort());
    expect(demoted.map(vendorForModel)).toContain(leadVendor);
  });

  it('outranks the tenant\'s own precedence — a preferred-but-broken account still yields', () => {
    const all = byoAutoSeedModels(connected, { agentic: true });
    const preferred = vendorForModel(all[0]!);
    const other = all.map(vendorForModel).find((v) => v !== preferred)!;
    // Owner ranked `preferred` first, but we know it is returning 401 right now.
    const seed = byoAutoSeedModels(connected, {
      agentic: true,
      vendorPriority: [preferred, other],
      demotedVendors: new Set([preferred]),
    });
    expect(vendorForModel(seed[0]!)).toBe(other);
  });
});

describe('pickCloudModel — the cloud pin honours the same health signal', () => {
  const connected = new Set(['anthropic', 'googleai']);

  it('does not lock turn 1 onto an account we already know returned 401', () => {
    const healthy = pickCloudModel(undefined, 'free', false, { byoVendors: connected });
    const leadVendor = vendorForModel(healthy.model);

    const demoted = pickCloudModel(undefined, 'free', false, {
      byoVendors: connected,
      byoAlertedVendors: [leadVendor],
    });
    // A cloud run locks onto whatever the seed resolves on turn 1, so leading with a
    // dead account costs the WHOLE run, not one attempt.
    expect(vendorForModel(demoted.model)).not.toBe(leadVendor);
    expect(demoted.strict).toBe(false);
  });
});

describe('pickCloudModel — superadmin', () => {
  it('lets a free-plan superadmin pin a model instead of silently auto-routing', () => {
    const pinned = 'anthropic/claude-sonnet-5';
    // Without the flag: a free plan with no override and no BYO cannot choose, so the
    // pin is dropped and the run auto-routes — with no paywall shown anywhere, because
    // a cloud run never passes the gateway's premium gate.
    expect(pickCloudModel(pinned, 'free', false, {})).not.toEqual({ model: pinned, strict: true });
    expect(pickCloudModel(pinned, 'free', false, { isSuperadmin: true }))
      .toEqual({ model: pinned, strict: true });
  });

  it('does not change routing for an ordinary free-plan run', () => {
    const pinned = 'anthropic/claude-sonnet-5';
    expect(pickCloudModel(pinned, 'free', false, { isSuperadmin: false }))
      .not.toEqual({ model: pinned, strict: true });
  });
});
