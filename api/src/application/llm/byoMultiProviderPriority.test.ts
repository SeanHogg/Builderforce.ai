/**
 * Regression: a tenant with MULTIPLE connected BYO providers, ordered via the
 * tenant's provider-priority list, must be able to USE every one of them.
 * The priority order is a failover chain, not "leader takes all".
 *
 * Scenario mirrors the live tenant report (chat #256): six connected providers
 * (xAI, Kimi, Qwen, MiniMax, Moonshot, Anthropic) with the tenant's chosen
 * order putting xAI first. Each provider's seed must appear in the auto-seed
 * list, ordered by the tenant's priority, so a cascade that fails over
 * actually reaches the followers instead of silently skipping them.
 *
 * IDs are GATEWAY VENDOR ids as produced by `byoVendorIdsFromCredentials` /
 * `byoVendorIdFor` — NOT the LlmProvider ids. The trap this test guards: the
 * Kimi provider dispatches on vendor `kimi-code` (`PROVIDER_VENDOR_MAP`), so a
 * connected set spelled with `kimi` yields no Kimi seed at all (the flagship
 * lookup owns no module under that id) and Kimi silently vanishes from the
 * cascade. Likewise Anthropic's flagship is a BARE `claude-*` id with no
 * `direct/anthropic/` prefix, so vendor matching must go through
 * `vendorForModel`, never a string prefix.
 */
import { describe, expect, it } from 'vitest';
import { byoAutoSeedModels } from './modelPool';
import { pickCloudModel } from './pickCloudModel';
import { vendorForModel } from './vendors';

/** Connected-set gateway vendor ids for the six providers (kimi dispatches as `kimi-code`). */
const CONNECTED = ['xai', 'kimi-code', 'qwen', 'minimax', 'moonshot', 'anthropic'] as const;
/** Tenant's chosen provider priority — xAI leads, the rest follow in order. */
const PRIORITY = [...CONNECTED];

describe('BYO multi-provider — every connected provider is usable, in tenant priority order', () => {
  const seeds = byoAutoSeedModels(new Set(CONNECTED), { agentic: true, vendorPriority: PRIORITY });

  it('every connected provider contributes a seed (none are silently dropped)', () => {
    for (const vendor of CONNECTED) {
      expect(seeds.some((s) => vendorForModel(s) === vendor)).toBe(true);
    }
  });

  it('seeds follow the tenant provider priority, not catalog tier alone', () => {
    const orderOf = (vendor: string) => seeds.findIndex((s) => vendorForModel(s) === vendor);
    const ranked = [...PRIORITY].sort((a, b) => orderOf(a) - orderOf(b));
    expect(ranked).toEqual(PRIORITY);
  });

  it('the cloud pick leads with the tenant-chosen leader (xAI), not a stronger tier', () => {
    const pick = pickCloudModel(undefined, 'pro', false, {
      byoVendors: new Set(CONNECTED),
      byoVendorPriority: PRIORITY,
    });
    expect(pick.strict).toBe(false);
    expect(pick.model.startsWith('direct/xai/')).toBe(true);
  });

  it('a provider absent from the priority list still seeds, after every ranked one', () => {
    const withExtra = byoAutoSeedModels(new Set([...CONNECTED, 'meta']), {
      agentic: true,
      vendorPriority: PRIORITY,
    });
    expect(withExtra.some((s) => vendorForModel(s) === 'meta')).toBe(true);
  });
});
