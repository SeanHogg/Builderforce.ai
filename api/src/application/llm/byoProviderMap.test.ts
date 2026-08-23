/**
 * The BYO usage backfill reads the provider mapping and the premium surcharge from
 * TypeScript SOURCE, because `scripts/*.mjs` runs unbuilt and cannot import the app.
 * This is the guard that makes that reading trustworthy: it asserts the derived
 * values equal what the modules actually export.
 *
 * Without it the derivation is a parser nobody exercises — and a parser that silently
 * returns nothing produces a backfill that reports "nothing to do" and looks like a
 * clean run. That is the exact failure the hand-written map it replaced already had
 * once: `normalizeByoProvider`'s old copy had lost `xai-oauth`, so SuperGrok-funded
 * rows were stamped with a provider matching no credential and vanished from the
 * tenant's own breakdown.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadByoModelInference } from '../../../scripts/lib/byoProviderMap.mjs';
import { numericConstant } from '../../../scripts/lib/tsSource.mjs';
import { SUPPORTED_PROVIDERS, byoVendorIdFor, providerForVendor } from './llmProviderCatalog';
import type { ProviderAuthType } from './llmProviderCatalog';
import { PREMIUM_REQUEST_SURCHARGE_MILLICENTS } from './usageLedger';
import { getCatalog, vendorForModel } from './vendors/registry';

const inference = loadByoModelInference();
const AUTH_TYPES: ProviderAuthType[] = ['api_key', 'oauth'];

describe('BYO backfill — derived provider inference', () => {
  it('derives exactly what providerForVendor answers', () => {
    expect(inference.providerByVendor.size).toBeGreaterThan(0);
    for (const [vendorId, provider] of inference.providerByVendor) {
      expect(providerForVendor(vendorId)).toBe(provider);
    }
  });

  it('covers every vendor id a connected credential can dispatch on', () => {
    // Completeness, not just correctness: a provider MISSING from the derived map is
    // silent — its tenants simply stay over-charged — so every (provider, authType)
    // pair the catalog can produce has to round-trip.
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const authType of AUTH_TYPES) {
        expect(inference.providerByVendor.get(byoVendorIdFor(provider, authType))).toBe(provider);
      }
    }
  });

  it('attributes a direct/<vendor>/ pin to the provider whose key served it', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const vendorId = byoVendorIdFor(provider, 'api_key');
      // Only assert for vendors the router genuinely reaches this way — the bespoke
      // ones (anthropic) have no `direct/` prefix registered at all.
      if (vendorForModel(`direct/${vendorId}/probe`) !== vendorId) continue;
      expect(inference.providerForModel(`direct/${vendorId}/probe`)).toBe(provider);
    }
  });

  it('matches the standalone prefixes the router actually registers', () => {
    expect(inference.standalonePrefixes.length).toBeGreaterThan(0);
    for (const [prefix, provider] of inference.standalonePrefixes) {
      expect(providerForVendor(vendorForModel(`${prefix}probe`))).toBe(provider);
    }
  });

  it('never attributes an OpenRouter <org>/<slug> id to the tenant', () => {
    // The one error this path must not make. `anthropic/claude-…` on OpenRouter is
    // served by OUR key; zeroing it would refund spend we really funded.
    expect(inference.providerForModel('anthropic/claude-3-haiku')).toBeNull();
    expect(inference.providerForModel('openrouter/anthropic/claude-3-haiku')).toBeNull();
    expect(inference.providerForModel('google/gemini-2.5-flash-lite')).toBeNull();
    expect(inference.providerForModel('minimaxai/minimax-m3')).toBeNull();

    const standalone = new Set(inference.standalonePrefixes.map(([prefix]) => prefix));
    for (const vendorId of inference.providerByVendor.keys()) {
      if (standalone.has(`${vendorId}/`)) continue;
      expect(inference.providerForModel(`${vendorId}/some-slug`)).toBeNull();
    }
  });

  it('draws every bare model family from a real catalog id attributed the same way', () => {
    expect(inference.modelFamilies.length).toBeGreaterThan(0);
    for (const [family, provider] of inference.modelFamilies) {
      const entry = getCatalog().find((m) => m.id.startsWith(family) && !m.id.includes('/'));
      expect(entry, `no catalog id behind derived family "${family}"`).toBeDefined();
      expect(providerForVendor(entry!.vendor)).toBe(provider);
      expect(inference.providerForModel(entry!.id)).toBe(provider);
    }
  });

  it('still attributes model ids the catalog has since retired', () => {
    // The reason families exist rather than exact catalog ids: this reads HISTORY.
    // `claude-sonnet-4-6` is gone from the catalog but names thousands of ledger rows,
    // and exact matching would leave every one of those tenants charged.
    expect(inference.providerForModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(inference.providerForModel('claude-3-5-sonnet-20241022')).toBe('anthropic');
  });

  it('leaves an unattributable id alone rather than guessing', () => {
    for (const id of ['', '   ', 'unknown', '@cf/qwen/qwen3-30b-a3b-fp8', 'nvidia/nemotron-mini-4b-instruct', 'direct/groq/llama-3.3-70b-versatile']) {
      expect(inference.providerForModel(id)).toBeNull();
    }
    expect(inference.providerForModel(null)).toBeNull();
    expect(inference.providerForModel(undefined)).toBeNull();
  });
});

describe('BYO backfill — derived premium surcharge', () => {
  it('reads the same surcharge the ledger applies', () => {
    // The backfill re-derives `cost_usd_millicents` the way
    // `computeRecordedCostMillicents` would: zero token cost, surcharge PRESERVED on a
    // premium row. A drift here would silently refund a fee the tenant genuinely owes.
    const source = readFileSync(resolve(__dirname, 'usageLedger.ts'), 'utf8');
    expect(numericConstant(source, 'PREMIUM_REQUEST_SURCHARGE_MILLICENTS', 'usageLedger.ts'))
      .toBe(PREMIUM_REQUEST_SURCHARGE_MILLICENTS);
  });
});
