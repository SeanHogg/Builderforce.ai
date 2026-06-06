/**
 * Public model catalog for the marketing `/models` browser.
 *
 * We are the proxy: the browser must NEVER call OpenRouter directly. This module
 * fetches OpenRouter's public models list server-side, normalizes it, and serves
 * it through the canonical read-through cache (L1 isolate Map + L2 KV) so every
 * visitor after the first cache fill is network-free and we keep one shared,
 * invalidatable copy. Pricing is passed through verbatim — our Pro plan proxies
 * these models at the same per-token price OpenRouter charges.
 */

import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'openrouter-catalog:v1';
const CACHE_TTL_SECONDS = 60 * 60; // 1h — the catalog changes slowly.

/** Normalized model record returned to the client. */
export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  pricing: {
    /** USD per input token. */
    prompt: number;
    /** USD per output token. */
    completion: number;
    request?: number;
    image?: number;
  };
  modality?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  created?: number;
  tier: 'FREE' | 'STANDARD';
}

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: { prompt?: string; completion?: string; request?: string; image?: string };
  top_provider?: { context_length?: number };
  supported_parameters?: string[];
}

function prettyProvider(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join('-');
}

function deriveProvider(model: OpenRouterModel): string {
  const name = model.name ?? '';
  const colon = name.indexOf(':');
  if (colon > 0) return name.slice(0, colon).trim();
  const slash = model.id.indexOf('/');
  return slash > 0 ? prettyProvider(model.id.slice(0, slash)) : model.id;
}

function num(value: string | undefined): number {
  const n = Number(value ?? '0');
  return Number.isFinite(n) ? n : 0;
}

function normalize(model: OpenRouterModel): CatalogModel {
  const prompt = num(model.pricing?.prompt);
  const completion = num(model.pricing?.completion);
  const isFree = model.id.endsWith(':free') || (prompt === 0 && completion === 0);
  return {
    id: model.id,
    name: model.name ?? model.id,
    provider: deriveProvider(model),
    description: model.description ?? '',
    contextLength: model.context_length ?? model.top_provider?.context_length ?? 0,
    pricing: {
      prompt,
      completion,
      ...(model.pricing?.request != null ? { request: num(model.pricing.request) } : {}),
      ...(model.pricing?.image != null ? { image: num(model.pricing.image) } : {}),
    },
    ...(model.architecture?.modality ? { modality: model.architecture.modality } : {}),
    ...(model.architecture?.input_modalities ? { inputModalities: model.architecture.input_modalities } : {}),
    ...(model.architecture?.output_modalities ? { outputModalities: model.architecture.output_modalities } : {}),
    ...(model.supported_parameters ? { supportedParameters: model.supported_parameters } : {}),
    ...(model.created != null ? { created: model.created } : {}),
    tier: isFree ? 'FREE' : 'STANDARD',
  };
}

async function loadFromOpenRouter(env: Env): Promise<CatalogModel[]> {
  // The /models endpoint is public, but send the key when present so we stay on
  // our authenticated rate-limit bucket rather than the anonymous one.
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.OPENROUTER_API_KEY) headers['Authorization'] = `Bearer ${env.OPENROUTER_API_KEY}`;

  const res = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`);
  const json = (await res.json()) as { data?: OpenRouterModel[] };
  const list = Array.isArray(json.data) ? json.data : [];
  return list.map(normalize);
}

/**
 * Read-through cached catalog. Returns `[]` (never throws) on upstream failure
 * so the page can still render our own Free/Pro records.
 */
export async function getCatalogCached(env: Env): Promise<CatalogModel[]> {
  try {
    return await getOrSetCached(env, CACHE_KEY, () => loadFromOpenRouter(env), {
      kvTtlSeconds: CACHE_TTL_SECONDS,
    });
  } catch {
    return [];
  }
}
