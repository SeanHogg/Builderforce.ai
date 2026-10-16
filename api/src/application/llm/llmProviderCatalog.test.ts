import { describe, expect, it } from 'vitest';
import { LLM_PROVIDERS } from '@builderforce/model-catalog';
import {
  BYO_VENDOR_IDS,
  PROVIDER_VENDOR_MAP,
  SUPPORTED_PROVIDERS,
  byoVendorIdFor,
  isSupportedProvider,
  providerForVendor,
} from './llmProviderCatalog';

describe('BYO provider catalog — gateway view of the shared provider list', () => {
  it('supports exactly the shared provider vocabulary, with a vendor row for each', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(LLM_PROVIDERS);
    expect(Object.keys(PROVIDER_VENDOR_MAP).sort()).toEqual([...LLM_PROVIDERS].sort());
    expect(isSupportedProvider('freetoken')).toBe(true);
    expect(isSupportedProvider('openrouter')).toBe(false);
  });

  it('lists every vendor a connected account can dispatch on, subscriptions included', () => {
    expect(BYO_VENDOR_IDS).toEqual(expect.arrayContaining([
      'anthropic', 'openai', 'openai-codex', 'googleai', 'meta', 'kimi-code', 'moonshot',
      'qwen', 'minimax', 'xai', 'xai-oauth', 'ollama', 'ollama-local', 'freetoken',
    ]));
    expect(new Set(BYO_VENDOR_IDS).size).toBe(BYO_VENDOR_IDS.length);
  });

  it('inverts every vendor id back to the provider that owns it', () => {
    for (const vendorId of BYO_VENDOR_IDS) {
      const provider = providerForVendor(vendorId);
      expect(provider).not.toBeNull();
      expect([byoVendorIdFor(provider!, 'api_key'), byoVendorIdFor(provider!, 'oauth')]).toContain(vendorId);
    }
    expect(providerForVendor('openrouter')).toBeNull();
  });
});
