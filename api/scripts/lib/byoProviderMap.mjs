/**
 * "Which BYO provider does this HISTORICAL `llm_usage_log.model` belong to?" —
 * derived from the TypeScript that already owns the answer, never re-typed beside it.
 *
 * ── WHY DERIVED ────────────────────────────────────────────────────────────────
 * `backfill-byo-usage.mjs` used to carry a hand-written `PROVIDER_BY_VENDOR` literal
 * with a comment admitting it mirrored `application/llm/llmProviderCatalog.ts`. That
 * is the same duplication `normalizeByoProvider` was already burned by once: the old
 * hand-listed copy there had lost `xai-oauth`, so every SuperGrok-funded row was
 * stamped with a provider that matched no credential and dropped out of the tenant's
 * own breakdown. A backfill that rewrites BILLING must not be able to drift that way —
 * a provider missing from the copy does not error, it silently leaves those tenants
 * over-charged.
 *
 * Three facts are read, from the two modules that declare them:
 *   • `llmProviderCatalog.ts` → `PROVIDER_VENDOR_MAP` + the OAuth aliases in
 *     `byoVendorIdFor` — the vendor→provider inverse, exactly `providerForVendor`.
 *   • `vendors/registry.ts`   → `VENDOR_PREFIXES` — which explicit `<vendor>/` routing
 *     prefixes exist, so `googleai/…` / `openai-codex/…` / `xai-oauth/…` are matched
 *     without hand-listing them.
 *   • `vendors/*.ts`          → each single-vendor module's `CATALOG`, for the BARE
 *     model ids that carry no prefix at all (`claude-…`, `gemini-…`).
 *
 * ── WHAT IS DELIBERATELY *NOT* MATCHED ─────────────────────────────────────────
 * An OpenRouter `<org>/<slug>` id. `anthropic/claude-…` on OpenRouter is served by
 * OUR key, not the tenant's, and the `direct/` routing namespace exists precisely
 * because a bare `<provider>/` prefix would collide with it (see the comment on
 * `VENDOR_PREFIXES`). Attributing one to the tenant would zero spend we really funded,
 * which is the one error this whole path must not make.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockAfter } from './tsSource.mjs';

const LLM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'application', 'llm');
const VENDORS_DIR = resolve(LLM_DIR, 'vendors');

const read = (path) => readFileSync(path, 'utf8');

/**
 * Gateway vendor id → BYO provider. The lexical twin of `providerForVendor`: the
 * `PROVIDER_VENDOR_MAP` entries plus the OAuth-only vendor ids that `byoVendorIdFor`
 * returns and which have no row of their own in that map.
 */
function loadProviderByVendor() {
  const source = read(resolve(LLM_DIR, 'llmProviderCatalog.ts'));
  const byVendor = new Map();

  const mapBlock = blockAfter(source, /export const PROVIDER_VENDOR_MAP[^=]*=\s*/, '{', '}', 'PROVIDER_VENDOR_MAP');
  for (const [, provider, vendorId] of mapBlock.matchAll(/(\w+)\s*:\s*\{[^}]*?vendorId:\s*'([^']+)'/g)) {
    byVendor.set(vendorId, provider);
  }
  if (byVendor.size === 0) throw new Error('byoProviderMap: PROVIDER_VENDOR_MAP parsed to nothing');

  // `if (provider === 'openai') return 'openai-codex';` — the subscription vendors.
  const oauthBlock = blockAfter(source, /export function byoVendorIdFor[^{]*/, '{', '}', 'byoVendorIdFor');
  for (const [, provider, vendorId] of oauthBlock.matchAll(/provider\s*===\s*'([^']+)'\s*\)\s*return\s*'([^']+)'/g)) {
    byVendor.set(vendorId, provider);
  }
  return byVendor;
}

/**
 * Explicit routing prefixes that resolve to a tenant-ownable vendor, longest first so
 * `direct/openai/` can never be shadowed by a shorter match. Read from the literal
 * entries of `VENDOR_PREFIXES`; the spread that derives `direct/<vendor>/` for every
 * OpenAI-compatible module is covered structurally by {@link providerForDirectPrefix}
 * instead, since its members are not literals in that array.
 */
function loadStandalonePrefixes(providerByVendor) {
  const block = blockAfter(read(resolve(VENDORS_DIR, 'registry.ts')), /const VENDOR_PREFIXES[^=]*=\s*/, '[', ']', 'VENDOR_PREFIXES');
  const prefixes = [];
  for (const [, prefix, vendorId] of block.matchAll(/\{\s*prefix:\s*'([^']+)'\s*,\s*vendor:\s*'([^']+)'\s*\}/g)) {
    const provider = providerByVendor.get(vendorId);
    if (provider && !prefix.startsWith('direct/')) prefixes.push([prefix, provider]);
  }
  return prefixes.sort((a, b) => b[0].length - a[0].length);
}

/**
 * BARE model-id FAMILIES (`claude-`, `gemini-`) → provider.
 *
 * A family rather than the exact catalog ids on purpose: this reads HISTORY. The
 * catalog holds today's three `claude-*` ids, while the rows being corrected name
 * `claude-sonnet-4-6` and everything else that has since been retired — exact-id
 * matching would silently skip every one of them and leave those tenants charged.
 *
 * A family is only taken from a module that declares exactly ONE tenant-ownable
 * vendor, so the many-vendor `openaiCompatibleVendors.ts` contributes none (its
 * vendors are `autoRoute: false` and reachable only through the `direct/<vendor>/`
 * prefix, which is matched exactly). Any family claimed by two different providers is
 * dropped as ambiguous rather than guessed at.
 */
function loadModelFamilies(providerByVendor) {
  const claims = new Map(); // family → Set<provider>
  for (const name of readdirSync(VENDORS_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const source = read(resolve(VENDORS_DIR, name));

    const vendors = new Set(
      [...source.matchAll(/\bid:\s*'([^']+)'/g)]
        .map(([, id]) => id)
        .filter((id) => providerByVendor.has(id)),
    );
    if (vendors.size !== 1) continue;
    const provider = providerByVendor.get([...vendors][0]);

    let catalog;
    try {
      catalog = blockAfter(source, /const CATALOG[^=]*=\s*/, '[', ']', name);
    } catch { continue; } // a vendor module with no literal catalog contributes nothing
    for (const [, modelId] of catalog.matchAll(/\bid:\s*'([^']+)'/g)) {
      // `claude-sonnet-5` → `claude-`. Ids that are not a plain lowercase family stem
      // (`@cf/…`, `anthropic.claude-…`, `llama3.1-8b`) yield nothing, which is right:
      // they are namespaced ids that the prefix rules already handle or that belong to
      // a vendor no tenant can own.
      const family = /^([a-z][a-z0-9]*-)/.exec(modelId);
      if (!family) continue;
      const claimed = claims.get(family[1]) ?? new Set();
      claimed.add(provider);
      claims.set(family[1], claimed);
    }
  }
  return [...claims]
    .filter(([, providers]) => providers.size === 1)
    .map(([family, providers]) => [family, [...providers][0]])
    .sort((a, b) => b[0].length - a[0].length);
}

/** `direct/<vendor>/<model>` → the provider that owns `<vendor>`. */
function providerForDirectPrefix(providerByVendor, id) {
  const rest = id.slice('direct/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return providerByVendor.get(rest.slice(0, slash)) ?? null;
}

/**
 * The inference, and the data it was derived from so a caller can SHOW its work —
 * a backfill that rewrites billing should be able to print which rule matched.
 */
export function loadByoModelInference() {
  const providerByVendor = loadProviderByVendor();
  const standalonePrefixes = loadStandalonePrefixes(providerByVendor);
  const modelFamilies = loadModelFamilies(providerByVendor);

  /** The BYO provider a recorded model id belongs to, or `null` when unattributable. */
  function providerForModel(model) {
    const id = String(model ?? '').trim();
    if (!id) return null;
    if (id.startsWith('direct/')) return providerForDirectPrefix(providerByVendor, id);
    for (const [prefix, provider] of standalonePrefixes) {
      if (id.startsWith(prefix)) return provider;
    }
    // Only AFTER the prefix rules, and only for an id carrying no namespace at all —
    // `anthropic/claude-3-haiku` is OpenRouter's slug for a call we funded.
    if (id.includes('/')) return null;
    for (const [family, provider] of modelFamilies) {
      if (id.startsWith(family)) return provider;
    }
    return null;
  }

  return { providerByVendor, standalonePrefixes, modelFamilies, providerForModel };
}
