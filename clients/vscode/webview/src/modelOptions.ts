/**
 * The composer's model surface, read straight from the gateway by the webview.
 *
 * Model choice used to be a chip that punted to a VS Code QuickPick in the host —
 * so the panel could show WHICH model was in force but never WHICH ONES EXIST,
 * and the list lived in a second implementation (`pickModel` in extension.ts).
 * The `/` menu now offers the same list the web composer does, built from the
 * same three endpoints the host's picker reads:
 *
 *   GET /llm/v1/models   — plan pool, free subset, BYO surface, entitlements
 *   GET /api/llm/models  — the tenant's named LLM configs (`tenant_model:<slug>`)
 *   GET /llm/v1/catalog  — the paid OpenRouter catalog, ONLY when entitled
 *
 * Module-level promise cache keyed by base URL: the host re-posts `init` on every
 * project / model / auth change, and this slow-changing surface must not be
 * re-fetched on each of those repaints. `invalidateModelSurface()` drops it.
 */

import { premiumCostLabel, productForPlan, type ChatModelOptions, type ModelIdentityContext, type PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from './authedFetch';

/** The subset of `GET /llm/v1/models` this webview consumes. Also feeds the shared
 *  `classifyModelFunding` / `nextFallbackModel` selectors (hence `data`/`codingModels`). */
export interface ModelSurface {
  data?: Array<{ id?: string }>;
  models?: string[];
  freeModels?: string[];
  /** The curated tool-calling / coding subset of the pool — what a tool-call
   *  failover should draw from first (see nextFallbackModel). */
  codingModels?: string[];
  byo?: { providers?: string[]; models?: Array<{ id?: string; vendor?: string }> };
  canUsePremiumModels?: boolean;
  canChooseModel?: boolean;
  canUseFrontierModels?: boolean;
  /** The tenant's resolved plan ('free' | 'pro' | 'teams') — names the routing product
   *  the composer and the provenance chip show ("Builderforce Free" / "… PRO"). */
  effectivePlan?: string;
  /** A premium override lifts a free plan onto the paid product. */
  premium?: boolean;
}

export interface ComposerModelSurface {
  /** The raw surface, for the funding classifier + tool-call failover selector. */
  surface: ModelSurface;
  /** Everything the `/` menu can offer, grouped by who pays. */
  options: ChatModelOptions;
  /** Who is reading: the routing product funding their turns, and whether the gateway
   *  would accept a pin. Drives BOTH the menu's list and every model name shown. */
  identity: ModelIdentityContext;
}

interface CatalogModel {
  id?: string;
  pricing?: { prompt?: number; completion?: number };
  /** Set when the free/pro pool already routes the id — those are NOT premium. */
  pool?: 'free' | 'pro';
  supportedParameters?: string[];
}

const EMPTY: ComposerModelSurface = {
  surface: {},
  options: { byo: [], free: [], plan: [], paid: [] },
  identity: { product: 'free', canChoose: false },
};

let cache: { key: string; value: Promise<ComposerModelSurface> } | undefined;

/** Drop the cached surface (sign-out / workspace switch), so the next read refetches. */
export function invalidateModelSurface(): void {
  cache = undefined;
}

export function loadComposerModels(
  apiReq: AuthedFetch,
  baseUrl: string,
  labels: Pick<PromptOptionsLabels, 'paidCostDetail'>,
): Promise<ComposerModelSurface> {
  if (cache?.key === baseUrl) return cache.value;
  const value = fetchSurface(apiReq, labels).catch(() => {
    // A transient failure must not poison the cache — allow a later retry, and
    // leave the menu on its "auto only" degraded shape in the meantime.
    cache = undefined;
    return EMPTY;
  });
  cache = { key: baseUrl, value };
  return value;
}

async function fetchSurface(
  apiReq: AuthedFetch,
  labels: Pick<PromptOptionsLabels, 'paidCostDetail'>,
): Promise<ComposerModelSurface> {
  const surface = await apiReq<ModelSurface>('/llm/v1/models');
  const plan = surface.models ?? (surface.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
  const byo = (surface.byo?.models ?? [])
    .filter((m): m is { id: string; vendor?: string } => typeof m?.id === 'string')
    .map((m) => ({ id: m.id, vendor: m.vendor ?? '' }));
  const canUsePremiumModels = surface.canUsePremiumModels === true;
  // Tolerant of an older gateway that omits the flags: model choice degrades to
  // whatever premium/frontier access says (the host picker's own fallback).
  const canChooseModel = surface.canChooseModel
    ?? (surface.canUseFrontierModels === true || canUsePremiumModels || byo.length > 0);

  // Both extras are optional: a failure in either leaves the list poorer, never broken.
  const [configured, paid] = await Promise.all([
    apiReq<{ models?: Array<{ ref?: string; name?: string }> }>('/api/llm/models')
      .then((r) => (r.models ?? [])
        .filter((m): m is { ref: string; name?: string } => typeof m?.ref === 'string' && !!m.ref)
        .map((m) => ({ id: m.ref, label: m.name?.trim() || m.ref })))
      .catch(() => []),
    canUsePremiumModels ? premiumCatalog(apiReq, labels.paidCostDetail).catch(() => []) : Promise.resolve([]),
  ]);

  return {
    surface,
    options: {
      configured,
      byo,
      free: surface.freeModels ?? [],
      plan,
      paid,
    },
    identity: {
      product: productForPlan(surface.premium === true || (surface.effectivePlan ?? 'free') !== 'free'),
      canChoose: canChooseModel,
    },
  };
}

/**
 * Paid OpenRouter models the plan pool does not already route — mirrors the host
 * picker's `getPremiumCatalog`: priced, unpooled, and TOOL-CAPABLE (the chosen
 * model drives the Brain's tool loop on every turn), cheapest first.
 */
async function premiumCatalog(apiReq: AuthedFetch, costTemplate: string): Promise<Array<{ id: string; cost: string }>> {
  const json = await apiReq<{ data?: CatalogModel[] }>('/llm/v1/catalog');
  return (json.data ?? [])
    .filter((m) => !!m.id && !m.pool
      && ((m.pricing?.prompt ?? 0) > 0 || (m.pricing?.completion ?? 0) > 0)
      && (m.supportedParameters?.includes('tools') ?? false))
    .sort((a, b) => ((a.pricing?.prompt ?? 0) + (a.pricing?.completion ?? 0))
      - ((b.pricing?.prompt ?? 0) + (b.pricing?.completion ?? 0)))
    .map((m) => ({
      id: m.id as string,
      cost: premiumCostLabel({ prompt: m.pricing?.prompt ?? 0, completion: m.pricing?.completion ?? 0 }, costTemplate),
    }));
}
