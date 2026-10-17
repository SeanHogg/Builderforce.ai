/**
 * The gateway's model catalogue, read the ONE way every client reads it.
 *
 *   GET /llm/v1/models   — plan pool, free subset, BYO surface, entitlements
 *   GET /api/llm/models  — the tenant's named LLM configs (`tenant_model:<slug>`)
 *   GET /llm/v1/catalog  — the paid OpenRouter catalog, ONLY when entitled
 *
 * Two layers. The RULES (`gatewayPlanIsPaid`, `gatewayCanChooseModel`,
 * `gatewayModelIdentity`, `gatewayPlanModels`) are pure and shared by every reader —
 * the web's `useLlmModels`, the VS Code host's QuickPick, and the loader below — so
 * "may this viewer pin a model" is decided once, against the same older-payload
 * fallback everywhere. The LOADER (`loadGatewayModelOptions`) builds the `/` menu's
 * `ChatModelOptions` over any authenticated JSON GET, and is what the VS Code webview
 * and Rovr's side panel mount; it caches per key for the life of the page.
 */
import { premiumCostLabel, type ChatModelOptions } from './modelChoice';
import { productForPlan, type ModelIdentityContext } from './modelIdentity';

/** The subset of `GET /llm/v1/models` a client consumes. Every field is optional so an
 *  older gateway degrades instead of breaking the picker. */
export interface GatewayModelSurface {
  /** `configured: true` payloads list the pool as status rows (`model`); the shared
   *  funding / failover selectors read it as `id` — {@link loadGatewayModelOptions}
   *  normalizes it to carry both. */
  data?: Array<{ id?: string; model?: string }>;
  /** `configured: false` payloads list the pool as bare ids. */
  models?: string[];
  freeModels?: string[];
  /** The curated tool-calling / coding subset of the pool. */
  codingModels?: string[];
  teacherModels?: string[];
  byo?: { providers?: string[]; models?: Array<{ id?: string; vendor?: string }> };
  canUsePremiumModels?: boolean;
  canChooseModel?: boolean;
  canUseFrontierModels?: boolean;
  /** The tenant's resolved plan ('free' | 'pro' | 'teams'). */
  effectivePlan?: string;
  /** A premium override lifts a free plan onto the paid product. */
  premium?: boolean;
}

/** True when the tenant's turns are funded by a paid plan (or a premium override). */
export function gatewayPlanIsPaid(surface: Pick<GatewayModelSurface, 'premium' | 'effectivePlan'>): boolean {
  return surface.premium === true || (surface.effectivePlan ?? 'free') !== 'free';
}

/**
 * May the tenant pin a model at all? The server sends `canChooseModel` (its alias for
 * frontier access); an older payload that omits it falls back to every grant that
 * implies choice — a paid plan, frontier or premium access, or a connected provider.
 */
export function gatewayCanChooseModel(surface: GatewayModelSurface): boolean {
  if (typeof surface.canChooseModel === 'boolean') return surface.canChooseModel;
  return gatewayPlanIsPaid(surface)
    || surface.canUseFrontierModels === true
    || surface.canUsePremiumModels === true
    || (surface.byo?.providers?.length ?? 0) > 0
    || (surface.byo?.models?.length ?? 0) > 0;
}

/** Who is reading: the routing product funding their turns, and whether a pin is accepted. */
export function gatewayModelIdentity(surface: GatewayModelSurface): ModelIdentityContext {
  return { product: productForPlan(gatewayPlanIsPaid(surface)), canChoose: gatewayCanChooseModel(surface) };
}

/** The plan pool's model ids, whichever payload shape carried them. */
export function gatewayPlanModels(surface: GatewayModelSurface): string[] {
  if (surface.models) return surface.models.filter((id): id is string => typeof id === 'string' && !!id);
  return (surface.data ?? []).map((row) => row.model ?? row.id).filter((id): id is string => !!id);
}

/** An authenticated JSON GET against the gateway (`<T>(path) => Promise<T>`). */
export type GatewayJsonRequest = <T>(path: string) => Promise<T>;

export interface GatewayModelOptions {
  /** The surface, `data` normalized to `{ id }` rows for the funding / failover selectors. */
  surface: GatewayModelSurface;
  /** Everything the `/` menu can offer, grouped by who pays. */
  options: ChatModelOptions;
  identity: ModelIdentityContext;
}

/** The shape a host shows while the catalogue is unreadable: Auto only, choice-less. */
export const EMPTY_GATEWAY_MODEL_OPTIONS: GatewayModelOptions = {
  surface: {},
  options: { byo: [], free: [], plan: [], paid: [] },
  identity: { product: 'free', canChoose: false },
};

interface CatalogModel {
  id?: string;
  pricing?: { prompt?: number; completion?: number };
  /** Set when the free/pro pool already routes the id — those are NOT premium. */
  pool?: 'free' | 'pro';
  supportedParameters?: string[];
}

let cache: { key: string; value: Promise<GatewayModelOptions> } | undefined;

/** Drop the cached catalogue (sign-in / sign-out / workspace switch). */
export function invalidateGatewayModelOptions(): void {
  cache = undefined;
}

/**
 * The `/` menu's gateway models, cached per `cacheKey` (the gateway base URL) for the
 * life of the page — a slow-changing surface a host must not re-fetch on every repaint.
 * A failure is not cached (a later read retries) and resolves to
 * {@link EMPTY_GATEWAY_MODEL_OPTIONS}.
 */
export function loadGatewayModelOptions(
  request: GatewayJsonRequest,
  cacheKey: string,
  labels: { paidCostDetail: string },
): Promise<GatewayModelOptions> {
  if (cache?.key === cacheKey) return cache.value;
  const value = fetchGatewayModelOptions(request, labels).catch(() => {
    cache = undefined;
    return EMPTY_GATEWAY_MODEL_OPTIONS;
  });
  cache = { key: cacheKey, value };
  return value;
}

async function fetchGatewayModelOptions(request: GatewayJsonRequest, labels: { paidCostDetail: string }): Promise<GatewayModelOptions> {
  const raw = await request<GatewayModelSurface>('/llm/v1/models');
  const plan = gatewayPlanModels(raw);
  const byo = (raw.byo?.models ?? [])
    .filter((m): m is { id: string; vendor?: string } => typeof m?.id === 'string')
    .map((m) => ({ id: m.id, vendor: m.vendor ?? '' }));

  // Both extras are optional: a failure in either leaves the list poorer, never broken.
  const [configured, paid] = await Promise.all([
    request<{ models?: Array<{ ref?: string; name?: string }> }>('/api/llm/models')
      .then((r) => (r.models ?? [])
        .filter((m): m is { ref: string; name?: string } => typeof m?.ref === 'string' && !!m.ref)
        .map((m) => ({ id: m.ref, label: m.name?.trim() || m.ref })))
      .catch(() => []),
    raw.canUsePremiumModels === true ? premiumCatalog(request, labels.paidCostDetail).catch(() => []) : Promise.resolve([]),
  ]);

  return {
    surface: { ...raw, data: plan.map((id) => ({ id })) },
    options: { configured, byo, free: raw.freeModels ?? [], plan, paid },
    identity: gatewayModelIdentity(raw),
  };
}

/**
 * Paid OpenRouter models the plan pool does not already route: priced, unpooled and
 * TOOL-CAPABLE (the chosen model drives the tool loop on every turn), cheapest first.
 */
async function premiumCatalog(request: GatewayJsonRequest, costTemplate: string): Promise<Array<{ id: string; cost: string }>> {
  const json = await request<{ data?: CatalogModel[] }>('/llm/v1/catalog');
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
