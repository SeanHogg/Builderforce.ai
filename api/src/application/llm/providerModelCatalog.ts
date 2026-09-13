/**
 * Provider MODEL CHOICE — which models a connected BYO account can be pointed at.
 *
 * A connected provider used to contribute ONE hardcoded model to routing
 * (`BYO_FRONTIER_FLAGSHIPS`) plus a few static catalog ids in the picker. That is the
 * wrong unit for a provider whose single key fronts a marketplace: a Qwen Cloud key
 * reaches Qwen, DeepSeek, GLM and Kimi models, and the tenant could reach none of the
 * others. This module answers "what could this account run?" from two sources:
 *
 *   • the provider's PUBLIC catalog — the full list its marketplace shows
 *     (qwencloud.com/models), fetched once and shared by every tenant;
 *   • the tenant's OWN key's `GET /models` — what that credential can actually call
 *     (a Token Plan serves a subset of pay-as-you-go).
 *
 * Merged, each model says whether the key was seen to serve it (`onAccount`), so the
 * picker can lead with what will work without hiding the rest of the catalog. Sources
 * are DATA ({@link PROVIDER_MODEL_SOURCES}) — another provider joins with an entry, not
 * a branch. The tenant's CHOICE is stored by `providerModelSelection`.
 */

import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getModule, type VendorId } from './vendors';
import type { LlmProvider } from './llmProviderCatalog';
import { resolveTenantVendorKeys } from './tenantProviderKeyService';
import { providerAccountModelsCacheKey } from './providerModelCacheKeys';

const SOURCE = 'application/llm/providerModelCatalog.ts';

interface ProviderModelSource {
  /** The gateway vendor that dispatches this provider's api-key models. */
  vendor: VendorId;
  /** The provider's public model list — what its own marketplace renders. */
  publicCatalogUrl: string;
  /** Model ids out of the public list's body. */
  parsePublicCatalog(body: unknown): string[];
  /** Keep only models the gateway can drive: it speaks `/chat/completions`, so an image,
   *  video, speech, embedding or realtime model would fail every turn it was given. */
  isChatModel(id: string): boolean;
}

/** Qwen Cloud ids that are NOT chat-completions models: video (wan, happyhorse), speech
 *  (asr, tts, cosyvoice, fun-asr, voice), image, omni/realtime streaming, translation (mt,
 *  livetranslate), OCR, embeddings and rerankers. Everything else — Qwen text, vision and
 *  coder models, and the DeepSeek / GLM / Kimi models Qwen Cloud also serves — is kept. */
const QWEN_NON_CHAT = /^(?:wan\d|happyhorse|cosyvoice|fun-|z-image|text-embedding|tongyi-)|asr|tts|image|omni|livetranslate|rerank|embedding|realtime|voice|ocr|(?:^|-)mt(?:-|$)/i;

const PROVIDER_MODEL_SOURCES: Partial<Record<LlmProvider, ProviderModelSource>> = {
  qwen: {
    vendor: 'qwen',
    // The model index behind qwencloud.com/models — the marketplace bundle reads this same
    // map: a flat `{ "<model id>": "<internal inference id>" }` object whose keys are every
    // public model id.
    publicCatalogUrl: 'https://alioth-intl.alicdn.com/model-mapping',
    parsePublicCatalog: (body) =>
      body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [],
    isChatModel: (id) => !QWEN_NON_CHAT.test(id),
  },
};

/** A provider's public catalog changes when it ships a model — hours, not seconds. */
const PUBLIC_CATALOG_TTL_SECONDS = 6 * 60 * 60;
/** What a key can call changes with its plan; a key write also invalidates it outright. */
const ACCOUNT_MODELS_TTL_SECONDS = 60 * 60;
const PUBLIC_CATALOG_TIMEOUT_MS = 10_000;

export interface ProviderModelChoice {
  /** The provider's bare model id (`deepseek-v4-flash`). */
  id: string;
  /** Seen in the tenant key's own `/models` — `null` when that list could not be read. */
  onAccount: boolean | null;
  /** Listed in the provider's public catalog. */
  inCatalog: boolean;
}

export interface ProviderModelChoices {
  models: ProviderModelChoice[];
  /** The key's own `/models` was read, so `onAccount` is a real answer rather than `null`. */
  accountChecked: boolean;
}

/** Whether a provider offers a model choice at all — the settings picker's visibility rule. */
export function providerSupportsModelChoice(provider: LlmProvider): boolean {
  return PROVIDER_MODEL_SOURCES[provider] !== undefined;
}

/** What the key is known to serve first, unknown next, known-absent last. */
function availabilityRank(choice: ProviderModelChoice): number {
  return choice.onAccount === true ? 0 : choice.onAccount === null ? 1 : 2;
}

/**
 * Merge the public catalog with the key's own list into ONE chat-only choice list. Pure.
 *
 * A model only the key reports (a plan-exclusive id the catalog omits) is kept — the key
 * is the authority on what it can call. Within an availability band ids sort natural and
 * DESCENDING, so `qwen3.8-*` precedes `qwen3.5-*` and the newest family reads first.
 */
export function mergeProviderModelChoices(
  catalog: readonly string[],
  account: readonly string[] | null,
  isChatModel: (id: string) => boolean,
): ProviderModelChoice[] {
  const catalogIds = new Set(catalog);
  const accountIds = account ? new Set(account) : null;
  return [...new Set([...catalog, ...(account ?? [])])]
    .filter(isChatModel)
    .map((id) => ({ id, onAccount: accountIds ? accountIds.has(id) : null, inCatalog: catalogIds.has(id) }))
    .sort((a, b) => availabilityRank(a) - availabilityRank(b)
      || b.id.localeCompare(a.id, 'en', { numeric: true }));
}

async function loadPublicCatalog(env: Env, provider: LlmProvider, source: ProviderModelSource): Promise<string[]> {
  return getOrSetCached(env, `provider-model-catalog:${provider}:v1`, async () => {
    const res = await fetch(source.publicCatalogUrl, { signal: AbortSignal.timeout(PUBLIC_CATALOG_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${provider} public model catalog returned HTTP ${res.status}`);
    const ids = source.parsePublicCatalog(await res.json());
    // An empty list is a broken fetch, not a provider with no models — never cache it.
    if (ids.length === 0) throw new Error(`${provider} public model catalog was empty`);
    return ids;
  }, { kvTtlSeconds: PUBLIC_CATALOG_TTL_SECONDS });
}

async function loadAccountModels(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  source: ProviderModelSource,
): Promise<string[]> {
  const vendor = getModule(source.vendor);
  if (!vendor.listModels) throw new Error(`${source.vendor} cannot list models`);
  const listModels = vendor.listModels.bind(vendor);
  return getOrSetCached(env, providerAccountModelsCacheKey(tenantId, provider), async () => {
    // Inside the loader so a cache hit never decrypts the credential.
    const apiKey = (await resolveTenantVendorKeys(env, tenantId))[provider];
    if (!apiKey) throw new Error(`${provider} has no api key connected`);
    return listModels(apiKey);
  }, { kvTtlSeconds: ACCOUNT_MODELS_TTL_SECONDS });
}

/**
 * The choice list for one provider on one tenant, or `null` when the provider offers no
 * model choice. Never empty for a supported provider: when neither live source answers,
 * the vendor's static catalog stands in, so the picker always has the models routing
 * already knew about.
 */
export async function listProviderModelChoices(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
): Promise<ProviderModelChoices | null> {
  const source = PROVIDER_MODEL_SOURCES[provider];
  if (!source) return null;
  const [catalog, account] = await Promise.all([
    loadPublicCatalog(env, provider, source).catch((error: unknown) => {
      reportCaughtError(error, { source: SOURCE, operation: 'loadPublicCatalog', level: 'warning', context: { provider } });
      return [] as string[];
    }),
    // An unreadable key list is ordinary (no key yet, a plan without the route) and says
    // nothing about the account's health — degrade to the catalog alone.
    loadAccountModels(env, tenantId, provider, source).catch(() => null),
  ]);
  const known = catalog.length > 0 || account
    ? catalog
    : getModule(source.vendor).catalog.map((entry) => entry.id);
  return {
    models: mergeProviderModelChoices(known, account, source.isChatModel),
    accountChecked: account !== null,
  };
}
