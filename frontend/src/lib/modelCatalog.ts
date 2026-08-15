/**
 * Model catalog for the logged-out `/models` browser.
 *
 * The catalog comes from OUR gateway — `GET /llm/v1/catalog` — which proxies and
 * caches OpenRouter's public list server-side. The browser never calls OpenRouter
 * directly; we surface the same models at the same per-token price our Pro plan
 * proxies them for. Our two products (Builderforce.ai Free + Pro) are static
 * marketing records prepended as the first two entries.
 *
 * A module-level in-flight promise dedupes concurrent/remount fetches per tab.
 * The real read-through cache (L1 Map + L2 KV + edge) lives behind the gateway
 * route, so there is no client-side TTL store to drift.
 */

import { BUILDERFORCE_PRODUCT_NAME } from '@seanhogg/builderforce-brain-ui';
import { BRAND } from './content';
import { apiRequest } from './apiClient';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

export type ModelTier = 'FREE' | 'PRO' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

export interface ModelPricing {
  /** USD per input token. */
  prompt: number;
  /** USD per output token. */
  completion: number;
  /** USD per request (flat), when the vendor charges one. */
  request?: number;
  /** USD per image input, when applicable. */
  image?: number;
}

export interface ModelRecord {
  id: string;
  name: string;
  /** Vendor / brand, derived from the model id or display name. */
  provider: string;
  description: string;
  /** Max context window in tokens. 0 = unknown / not applicable. */
  contextLength: number;
  /** Overrides the numeric context for display (e.g. auto-routed pools). */
  contextLabel?: string;
  pricing: ModelPricing;
  /** e.g. "text->text", "text+image->text". */
  modality?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  /** Gateway-advertised tunable params (tools, reasoning, …). */
  supportedParameters?: string[];
  /** Unix seconds the model was added upstream. */
  created?: number;
  /** True for our own Builderforce.ai products. */
  isBuilderforce?: boolean;
  /** Coarse plan/cost tier for badges + sorting. */
  tier?: ModelTier;
  /** Short badge label ("Free", "Pro"). */
  badge?: string;
  /** CTA destination for Builderforce records. */
  ctaHref?: string;
  /** True when the Free/Pro cascade actually routes this id (vs an upstream id
   *  we list but don't serve) — drives the "Routable" chip + filter [1305]. */
  routable?: boolean;
  /** Which pool routes it when routable: 'free' | 'pro'. */
  pool?: 'free' | 'pro';
}

/** Shape returned by `GET /llm/v1/catalog` (see api modelCatalog.ts). */
interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  pricing: ModelPricing;
  modality?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  created?: number;
  tier: 'FREE' | 'STANDARD';
  routable?: boolean;
  pool?: 'free' | 'pro';
}

// ---------------------------------------------------------------------------
// Our own products — always the first two cards.
// ---------------------------------------------------------------------------

export const BUILDERFORCE_MODELS: ModelRecord[] = [
  {
    id: 'builderforce/free',
    // The SHARED product name — the same words the composer, the `/` menu and every
    // reply's provenance chip use for a routed turn, so the catalog page a visitor
    // reads and the label they later see in the app are one string.
    name: BUILDERFORCE_PRODUCT_NAME.free,
    provider: BRAND.legalName,
    description:
      'Our free, smart-routed model. One OpenAI-compatible endpoint that cascades across a curated pool of free open-weight models (Llama, Qwen, Gemma, DeepSeek, Nemotron and more) with automatic failover — no per-token cost, no card required. Includes 10K tokens/day.',
    contextLength: 0,
    contextLabel: 'Auto-routed',
    pricing: { prompt: 0, completion: 0 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: ['tools', 'tool_choice', 'temperature', 'top_p', 'max_tokens'],
    isBuilderforce: true,
    tier: 'FREE',
    badge: 'Free',
    ctaHref: '/register',
  },
  {
    id: 'builderforce/pro',
    name: BUILDERFORCE_PRODUCT_NAME.pro,
    provider: BRAND.legalName,
    description:
      'Our paid, frontier-grade routing. The same single endpoint cascades across premium coding models (Claude Sonnet, GPT-4.1, Gemini 2.5 Pro, Qwen 3.5 and more) with prompt caching, vendor-diverse failover and a 1M tokens/day budget. Every model is proxied at the same per-token price the upstream charges.',
    contextLength: 0,
    contextLabel: 'Auto-routed',
    pricing: { prompt: 0, completion: 0 },
    modality: 'text+image->text',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportedParameters: ['tools', 'tool_choice', 'reasoning', 'temperature', 'top_p', 'max_tokens'],
    isBuilderforce: true,
    tier: 'PRO',
    badge: 'Pro',
    ctaHref: '/pricing?upgrade=pro',
  },
];

// ---------------------------------------------------------------------------
// Catalog fetch (via our gateway)
// ---------------------------------------------------------------------------

function toRecord(m: CatalogModel): ModelRecord {
  return {
    ...m,
    tier: m.tier,
    ...(m.tier === 'FREE' ? { badge: 'Free' } : {}),
  };
}

// Per-tab dedupe so concurrent callers / page remounts share one request.
const CATALOG_CACHE_KEY = 'model-catalog:public';

async function fetchCatalog(): Promise<ModelRecord[]> {
  const json = await apiRequest<{ data?: CatalogModel[] }>('/llm/v1/catalog', {
    auth: 'none',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(json.data) ? json.data.map(toRecord) : [];
}

/**
 * Return the full catalog: Builderforce Free + Pro first, then every gateway
 * model. Never rejects — on failure it still returns the two Builderforce
 * records so the page is useful.
 */
export async function getModelCatalog(): Promise<ModelRecord[]> {
  try {
    return [...BUILDERFORCE_MODELS, ...(await getOrSetClientCached(CATALOG_CACHE_KEY, () => fetchCatalog()))];
  } catch {
    return [...BUILDERFORCE_MODELS];
  }
}

/**
 * Is `record` a PREMIUM model — one of the paid OpenRouter models a tenant unlocks
 * with billing details + a validated card, billed at OpenRouter cost + a flat 1¢/request?
 *
 * Mirrors the server's `isPremiumModelSelection`: a PAID model that the plan's own
 * pool does NOT already route. The gateway marks pool membership on every catalog
 * record (`pool: 'free' | 'pro'`), so "no pool + costs money" is exactly the premium
 * long tail — the curated in-plan coders (`pool: 'pro'`) are already free to pick on
 * a paid plan and must not be surcharged. One definition, so the picker can never
 * offer something the gateway would reject (or vice versa).
 */
export function isPremiumModel(record: ModelRecord): boolean {
  if (record.isBuilderforce) return false;
  if (record.pool) return false; // already routed by the free/pro plan pool
  return record.pricing.prompt > 0 || record.pricing.completion > 0;
}

/**
 * Every PREMIUM model, cheapest-first (input price), for the model picker's premium
 * group. Reuses the cached `/llm/v1/catalog` fetch — the premium list is deliberately
 * NOT a second endpoint, so there is one catalog source and one dedupe.
 */
export async function getPremiumModelCatalog(): Promise<ModelRecord[]> {
  const all = await getModelCatalog();
  return all
    .filter(isPremiumModel)
    .sort((a, b) => (a.pricing.prompt + a.pricing.completion) - (b.pricing.prompt + b.pricing.completion));
}

// ---------------------------------------------------------------------------
// Display formatters (shared by cards, detail panel, and compare table)
// ---------------------------------------------------------------------------

/** Format a per-token USD price as a per-1M-tokens string. */
export function formatPricePerMillion(perToken: number): string {
  if (perToken <= 0) return 'Free';
  const perMillion = perToken * 1_000_000;
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}`;
  return `$${perMillion.toFixed(2)}`;
}

/**
 * Test a model against optional USD-per-million-token price ceilings.
 * Catalog prices are stored per token, while every marketplace price is shown
 * per 1M tokens; keeping the conversion here prevents the filter UI from
 * accidentally comparing values expressed in different units.
 */
export function modelMatchesPriceLimits(
  record: ModelRecord,
  maxInputPerMillion?: number,
  maxOutputPerMillion?: number,
): boolean {
  const inputPerMillion = record.pricing.prompt * 1_000_000;
  const outputPerMillion = record.pricing.completion * 1_000_000;
  return (
    (maxInputPerMillion === undefined || inputPerMillion <= maxInputPerMillion) &&
    (maxOutputPerMillion === undefined || outputPerMillion <= maxOutputPerMillion)
  );
}

/** Format a context-window token count as "128K" / "1M". */
export function formatContext(record: ModelRecord): string {
  if (record.contextLabel) return record.contextLabel;
  const n = record.contextLength;
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Free / Paid / our-product badge color. */
export function tierColor(record: ModelRecord): string {
  if (record.tier === 'PRO') return 'var(--coral-bright)';
  if (record.tier === 'FREE') return 'var(--success)';
  return 'var(--accent)';
}
