/**
 * Model catalog + pool status surfaces.
 *
 * GET /v1/catalog — PUBLIC model catalog for the marketing /models page
 * GET /v1/models  — the caller's pool status, pickers and frontier/premium access
 * GET /v1/health  — per-model availability for the free/pro pools
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import {
  llmProxyForPlan,
  productNameForPlan,
  modelPoolForPlan,
  codingModelsForPlan,
  FREE_MODEL_POOL,
  PRO_MODEL_POOL,
} from '../../../application/llm/LlmProxyService';
import { PREMIUM_REQUEST_SURCHARGE_MILLICENTS } from '../../../application/llm/usageLedger';
import { allVendorFlagships } from '../../../application/llm/vendors';
import { getCatalogCached } from '../../../application/llm/modelCatalog';
import { FREE_IMAGE_MODEL_POOL, PAID_IMAGE_MODEL_POOL } from '../../../application/llm/ImageProxyService';
import { toTenantPlan } from '../../../application/tenant/featureEntitlements';
import {
  listTenantProviderKeys,
  byoVendorIdFor,
  type ProviderKeySummary,
} from '../../../application/llm/tenantProviderKeyService';
import { connectionModelRefs, listOpenRouterConnections } from '../../../application/llm/openRouterConnectionService';
import { byoModelsFor } from '../../../application/llm/byoModelRouting';
import { listProviderModelSelections } from '../../../application/llm/providerModelSelection';
import { evaluateFrontierAccess, evaluatePremiumModelAccess } from '../../../domain/tenant/planFeatures';
import { requireTenantAccess, type TenantAccess } from './access';

export function mountModelsRoutes(router: Hono<HonoEnv>): void {
  // No auth: this is the same OpenRouter catalog we proxy, served through the
  // read-through cache so the browser never calls OpenRouter directly and we
  // keep one shared, invalidatable copy. Pricing is OpenRouter's verbatim —
  // our Pro plan proxies these models at the same per-token price.
  router.get('/v1/catalog', async (c) => {
    const data = await getCatalogCached(c.env);
    // Cache at the edge too — the payload is identical for every visitor.
    c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return c.json({ object: 'list', data });
  });

  router.get('/v1/models', async (c) => {
    let access: TenantAccess | null = null;
    try {
      access = await requireTenantAccess(c);
    } catch {
      access = null;
    }

    const effectivePlan = access?.effectivePlan ?? 'free';
    const premiumOverride = access?.premiumOverride === true;
    const productName = productNameForPlan(effectivePlan, premiumOverride);
    // Premium override implies the Pro key path (same as in /v1/chat/completions).
    const isPro = premiumOverride || effectivePlan !== 'free';

    // Curated coding/tool-calling models the tenant's plan can actually reach —
    // the list a cloud-agent run should pick from (free tenants see only the free
    // coding models, Pro tenants also see the premium ones).
    const codingModels = codingModelsForPlan(effectivePlan, premiumOverride);
    // Stable funding category for searchable pickers. A paid tenant's `models`
    // contains both free and plan-funded entries, so clients cannot infer FREE
    // from the effective plan alone.
    const freeModels = modelPoolForPlan('free', false);

    // BYO: the tenant's connected providers drive an additional pinnable model set
    // (their own account serves them, $0 to us). Connecting a provider ALSO unlocks
    // model choice on the free plan — "LLM choices are based on the connected
    // providers." Resolved only for an authenticated tenant.
    // Keep the SUMMARIES (not just provider ids): a subscription-connected provider
    // serves a different model route than an api-key one, and only the summary carries
    // the auth type that decides which.
    const [byoProviderRows, openRouterConnections, modelSelections] = access
      ? await Promise.all([
          listTenantProviderKeys(c.env, access.tenantId),
          listOpenRouterConnections(c.env, access.tenantId),
          // A provider's selected models (1165) replace its static defaults in the picker,
          // so the list offers exactly what routing will try. Advisory: unreadable → defaults.
          listProviderModelSelections(c.env, access.tenantId).catch(() => ({})),
        ])
      : [[] as ProviderKeySummary[], [], {}];
    // Preserve the ONE mixed provider/connection precedence in the picker payload.
    // Appending every OpenRouter registration after every direct provider made the
    // prompt order disagree with the priority drawer whenever a connection was #1.
    const providerModels = byoModelsFor(byoProviderRows, modelSelections);
    const groups = [
      ...byoProviderRows.map((row) => ({
        priority: row.priority,
        tie: `provider:${row.provider}`,
        models: providerModels.filter((model) => {
          const vendor = byoVendorIdFor(row.provider, row.authType);
          return model.vendor === vendor;
        }),
      })),
      ...openRouterConnections.map((connection) => ({
        priority: connection.priority,
        tie: `openrouter:${connection.id}`,
        models: connectionModelRefs([connection]).map((id) => ({ id, vendor: 'openrouter', tier: 'REGISTERED' })),
      })),
    ].sort((a, b) => {
      const ar = a.priority ?? Number.POSITIVE_INFINITY;
      const br = b.priority ?? Number.POSITIVE_INFINITY;
      return ar === br ? a.tie.localeCompare(b.tie) : ar - br;
    });
    const byoModels = groups.flatMap((group) => group.models);
    // The wire shape stays a plain provider-id list (what every client reads).
    const byoProviders: string[] = [
      ...byoProviderRows.map((d) => d.provider),
      ...(openRouterConnections.length ? ['openrouter'] : []),
    ];
    // THE single frontier-access rule (superadmin || premium override || connected BYO
    // account || paid plan) — shared with every backend gate via evaluateFrontierAccess,
    // so the client's model-choice / frontier-teacher unlock matches the server exactly.
    // `access.isSuperadmin` is the DB-resolved flag (requireTenantAccess), so a superadmin
    // unlocks frontier even without a premium override or a connected account.
    const canUseFrontierModels = evaluateFrontierAccess({
      effectivePlan: toTenantPlan(effectivePlan),
      premiumOverride,
      isSuperadmin: access?.isSuperadmin === true,
      hasConnectedByoFrontier: byoProviders.length > 0,
    }).entitled;
    // `canChooseModel` is an alias kept for existing clients; it IS frontier access.
    const canChooseModel = canUseFrontierModels;

    // PREMIUM (any-paid-OpenRouter) selection — a STRICTER, separate rule from frontier
    // access: billing details and a validated card (superadmin / override bypass). The premium
    // model LIST is deliberately NOT inlined here: it is the whole paid OpenRouter
    // catalog (hundreds of ids) and is already served, read-through + edge cached, by
    // `GET /v1/catalog`. The picker loads it from there and filters, so this payload
    // stays bounded and there is one catalog source.
    const premiumAccess = evaluatePremiumModelAccess({
      effectivePlan: toTenantPlan(effectivePlan),
      premiumOverride,
      isSuperadmin: access?.isSuperadmin === true,
      cardValidated: access?.cardValidated === true,
    });
    // NOTE: the key is `premiumInfo`, NOT `premium` — `premium: true` is already the
    // superadmin premium-OVERRIDE flag on this payload (clients read `res.premium ===
    // true` to derive isPaid), so reusing it here would silently break that.
    const premiumInfo = {
      canUsePremiumModels: premiumAccess.entitled,
      premiumInfo: {
        entitled: premiumAccess.entitled,
        reason: premiumAccess.reason,
        ...(premiumAccess.unlock ? { unlock: premiumAccess.unlock } : {}),
        cardValidationStatus: access?.cardValidationStatus ?? 'none',
        /** Flat per-request surcharge on top of OpenRouter's own token price. */
        surchargeMillicents: PREMIUM_REQUEST_SURCHARGE_MILLICENTS,
      },
    };

    // Frontier TEACHER options — the models eligible to distil into an Evermind. A
    // connected BYO account means teaching with THEIR OWN frontier models (a BYO-Anthropic
    // tenant teaches with Opus/Sonnet on their account, NOT a free `@cf/*`/qwen coder), so
    // their BYO models lead. The platform's premium coders are added ONLY when the PLATFORM
    // funds frontier (paid / override / superadmin) — a free BYO tenant must not teach on
    // our premium pool for free. Empty when the tenant has no frontier access at all.
    const platformFundsFrontier = premiumOverride || effectivePlan !== 'free' || access?.isSuperadmin === true;
    const teacherModels = canUseFrontierModels
      ? Array.from(new Set([
          ...byoModels.map((m) => m.id),
          ...(platformFundsFrontier ? codingModelsForPlan(effectivePlan === 'free' ? 'pro' : effectivePlan, true) : []),
        ]))
      : [];

    // Each vendor's CURRENT flagship ids (`{ anthropic: { agentic, chat }, … }`), read from
    // the vendor catalogs. A consumer pins a ROLE through this ("Anthropic's agentic
    // flagship") instead of copying a version string that goes stale on the next release.
    const flagships = Object.fromEntries(
      allVendorFlagships().map(({ vendor, agentic, chat }) => [vendor, { agentic, chat }]),
    );

    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey && !openRouterConnections.some((connection) => connection.hasKey)) {
      return c.json({
        configured: false,
        product: productName,
        effectivePlan,
        ...(premiumOverride ? { premium: true } : {}),
        models: modelPoolForPlan(effectivePlan, premiumOverride),
        freeModels,
        codingModels,
        teacherModels,
        canChooseModel,
        canUseFrontierModels,
        ...premiumInfo,
        byo: { providers: byoProviders, models: byoModels },
        flagships,
      });
    }

    const service = llmProxyForPlan(c.env, effectivePlan, premiumOverride);
    return c.json({
      configured: true,
      object: 'list',
      product: productName,
      effectivePlan,
      ...(premiumOverride ? { premium: true } : {}),
      data: await service.status(),
      freeModels,
      codingModels,
      teacherModels,
      canChooseModel,
      canUseFrontierModels,
      ...premiumInfo,
      byo: { providers: byoProviders, models: byoModels },
      flagships,
    });
  });

  router.get('/v1/health', async (c) => {
    // Per-model availability/cooldown for each pool, mirroring /v1/models'
    // `status()` shape (LlmModelStatus[]). The observability UI renders these
    // as the free/pro pool tabs, so the contract is `free`/`pro` arrays +
    // `timestamp` — NOT bare pool counts. Global pools, so no tenant needed.
    const [free, pro] = await Promise.all([
      llmProxyForPlan(c.env, 'free').status(),
      llmProxyForPlan(c.env, 'pro').status(),
    ]);
    return c.json({
      status: 'ok',
      service: 'builderforceLLM',
      free,
      pro,
      timestamp: new Date().toISOString(),
      // Retained for any non-UI consumer of the historical shape.
      pool: FREE_MODEL_POOL.length,
      proPool: PRO_MODEL_POOL.length,
      imagePool: FREE_IMAGE_MODEL_POOL.length,
      imageProPool: PAID_IMAGE_MODEL_POOL.length,
    });
  });
}
