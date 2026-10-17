/**
 * Who FUNDS a call, and with which credential — the BYO / subscription half of the
 * gateway, split out of `LlmProxyService.ts`.
 *
 * One instance per proxy. It answers the questions every other gateway step asks:
 * which vendors the tenant serves from their OWN account (cooldown scope, BYO chain
 * boundary), whether a result was tenant-funded (`byoFunded`, overflow metering),
 * whether BYO is a strict execution boundary, which premium fallback is appended, and
 * the vendor env (operator keys overlaid with the tenant's own) handed to dispatch.
 */

import {
  passthroughVendorKeys,
  vendorForModel,
  type VendorEnv,
  type VendorId,
} from './vendors';
import { CODING_PREMIUM_FALLBACK_MODELS, PREMIUM_FALLBACK_MODELS } from './modelPool';
import { PROVIDER_VENDOR_MAP, byoVendorIdsFromCredentials, type TenantVendorKeys } from './tenantProviderKeyService';
import { bareModelId } from './openRouterConnectionService';
import type { ProxyResult } from './proxyTypes';
import type { ProxyConfig } from './proxyConfig';

export class ProxyFunding {
  private readonly cfg: ProxyConfig;

  constructor(cfg: ProxyConfig) {
    this.cfg = cfg;
    // Mark every vendor a BYO key overrides as tenant-funded up front, so any
    // resolution landing on that vendor this request is stamped byo (cost 0,
    // on-prem/VSIX exempt). vendorEnv() applies the matching key override.
    for (const provider of Object.keys(cfg.tenantVendorKeys) as Array<keyof TenantVendorKeys>) {
      if (cfg.tenantVendorKeys[provider]) this.tenantFundedVendors.add(PROVIDER_VENDOR_MAP[provider].vendorId as VendorId);
    }
  }

  /** True when this result was served by the tenant's connected Claude SUBSCRIPTION
   *  (the `anthropic` vendor with an OAuth token bound) — so it's free to us and
   *  must NOT be metered as paid-overflow. The vendor only ever uses OAuth when the
   *  token is present, so vendor=anthropic + token bound ⇒ subscription-funded. */
  isSubscriptionFunded(result: ProxyResult): boolean {
    return (this.cfg.anthropicOAuthToken != null && result.resolvedVendor === 'anthropic')
      || (this.cfg.openaiCodexAuth != null && result.resolvedVendor === 'openai-codex')
      || (this.cfg.xaiOAuthToken != null && result.resolvedVendor === 'xai-oauth');
  }

  /** Gateway vendor ids the tenant can serve from their OWN connected account this
   *  request — a BYO api-key (any provider) OR a connected subscription (Anthropic /
   *  ChatGPT-Codex / SuperGrok) on its OAuth vendor. Derived through the SHARED
   *  {@link byoVendorIdsFromCredentials} so the ids the gateway SEEDS
   *  ({@link byoAutoSeedModels}) can never disagree with the ids the BYO boundary
   *  filter in {@link buildCandidateChain} keeps. */
  get connectedByoVendors(): Set<string> {
    // Memoized: the credentials are fixed for this instance's lifetime, and this set is
    // read per-candidate by the BYO chain filter and per-attempt by the cooldown scope
    // check — rebuilding it in those loops was pure waste.
    this.connectedByoVendorsMemo ??= byoVendorIdsFromCredentials({
      anthropicOAuthToken: this.cfg.anthropicOAuthToken,
      openaiCodexAuth: this.cfg.openaiCodexAuth,
      xaiOAuthToken: this.cfg.xaiOAuthToken,
      vendorKeys: this.cfg.tenantVendorKeys,
    });
    return this.connectedByoVendorsMemo;
  }

  private connectedByoVendorsMemo?: Set<string>;

  /**
   * Cooldown SCOPE — is this vendor served by the tenant's OWN credential this request?
   *
   * The cooldown store is keyed globally (`cooldown:<vendor>:<model>`, see
   * cooldownStore.ts), which is exactly right for the operator's SHARED keys: one 429 on
   * our OpenRouter key really does mean the next request should skip that model. It is
   * wrong in BOTH directions once the call rides a tenant's own account:
   *
   *   - READ: a bench written by our shared key — or by another tenant's lapsed
   *     subscription — says nothing about THIS owner's account. Gating on it hides a
   *     healthy credential, and on the strict-pin path turns it into a hard 503 that the
   *     caller reads as "your provider is unavailable" (which is how a green Integrations
   *     card could sit next to a failing Test connection).
   *   - WRITE: an owner's own 401 would bench that model for our shared key AND for every
   *     other tenant, so one expired token starves the pool for everybody.
   *
   * So a vendor the tenant can serve themselves is exempt from the cooldown keyspace
   * entirely. Its failure signal lives in two stores that ARE tenant-scoped:
   * `vendorHealth` (governs BYO seed ORDER) and `providerAuthAlerts` (drives the
   * "reconnect this account" prompt + the daily BYO credential probe's email). This is
   * the same rule the non-strict path already applied via its BYO probe backstop —
   * stated once, here, so strict dispatch, chain composition and cooldown writes agree.
   */
  isOwnerServedVendor(vendor: string): boolean {
    return this.connectedByoVendors.has(vendor);
  }

  /** Model-specific ownership is required for OpenRouter: one registration may
   * use the tenant's key while another uses the managed key, even in one chain. */
  isOwnerServedModel(model: string): boolean {
    return this.isOwnerServedVendor(vendorForModel(model))
      || (vendorForModel(model) === 'openrouter' && !!this.cfg.openRouterModelKeys[bareModelId(model)]);
  }

  /** Vendors whose call was served with a tenant's OWN BYO credential this
   *  request (populated by {@link vendorEnv} when it overlays a per-tenant key on
   *  the operator env). Combined with the Anthropic-subscription case, this is the
   *  full "the tenant funded it" signal for any provider. */
  private readonly tenantFundedVendors = new Set<VendorId>();

  /** True when the tenant's OWN provider credential served the call — a connected
   *  Claude subscription OR a BYO vendor key (OpenAI/Google/Anthropic). The single
   *  source of truth for ProxyResult.byoFunded, generalizing isSubscriptionFunded
   *  across every provider. */
  isTenantFunded(result: ProxyResult): boolean {
    return this.isSubscriptionFunded(result)
      || this.tenantFundedVendors.has(result.resolvedVendor)
      || this.isOwnerServedModel(result.resolvedModel);
  }

  /** BYO is strict when configured OR when at least one credential resolved. */
  get byoStrict(): boolean {
    return !this.cfg.allowGatewayAuto && (this.cfg.byoRequired || this.connectedByoVendors.size > 0);
  }

  /** The premium fallback chain appended to every cascade — empty when the tenant
   *  has exhausted its paid-overflow cap, so the chain composer won't fall through
   *  to a funded model. A CODING run uses the coding-capable chain (paid coders)
   *  so it never resolves onto a general non-coder. Single source for both the
   *  cooldown-prefetch and the chain. */
  get premiumFallback(): readonly string[] {
    // A usable connected credential makes this a BYO-strict request. Never append
    // BuilderForce-funded models behind the owner's account: an upstream failure
    // must stay inside the owner's connected providers or surface honestly.
    if (this.cfg.disablePaidOverflow || this.byoStrict) return [];
    return this.cfg.codingOnly ? CODING_PREMIUM_FALLBACK_MODELS : PREMIUM_FALLBACK_MODELS;
  }

  /** Synthesize the env passed to vendors — picks the Pro OpenRouter key when applicable. */
  vendorEnv(): VendorEnv {
    return {
      OPENROUTER_API_KEY: this.cfg.isPro
        ? (this.cfg.env.OPENROUTER_API_KEY_PRO ?? this.cfg.env.OPENROUTER_API_KEY ?? null)
        : (this.cfg.env.OPENROUTER_API_KEY ?? null),
      OPENROUTER_MODEL_KEYS: this.cfg.openRouterModelKeys,
      OPENAI_CODEX_AUTH: this.cfg.openaiCodexAuth ? JSON.stringify(this.cfg.openaiCodexAuth) : null,
      XAI_OAUTH_TOKEN: this.cfg.xaiOAuthToken,
      CEREBRAS_API_KEY:         this.cfg.env.CEREBRAS_API_KEY         ?? null,
      NVIDIA_API_KEY:           this.cfg.env.NVIDIA_API_KEY           ?? null,
      OLLAMA_API_KEY:           this.cfg.env.OLLAMA_API_KEY           ?? null,
      // A tenant BYO Google key overrides the operator key for the `googleai`
      // vendor (marked tenant-funded in the constructor → byo, $0 to us).
      GOOGLE_API_KEY:           this.cfg.tenantVendorKeys.google      ?? this.cfg.env.GOOGLE_API_KEY ?? null,
      // Direct-Anthropic floor key. Flows through creditedVendorEnv() too (which
      // spreads this) so the coding backstop can reach Claude regardless of plan.
      // A tenant BYO Anthropic api-key overrides it (the subscription/OAuth path
      // is separate, via CLAUDE_OAUTH_TOKEN below).
      CLAUDE_API_KEY:           this.cfg.tenantVendorKeys.anthropic   ?? this.cfg.env.CLAUDE_API_KEY ?? null,
      // A connected tenant's Claude subscription token — when present the anthropic
      // vendor prefers it over CLAUDE_API_KEY (tenant-funded, $0 to us). Spread into
      // creditedVendorEnv() too, so a backstop landing on Claude also uses it.
      CLAUDE_OAUTH_TOKEN:       this.cfg.anthropicOAuthToken         ?? null,
      CLOUDFLARE_AI_API_TOKEN:  this.cfg.env.CLOUDFLARE_AI_API_TOKEN  ?? null,
      CLOUDFLARE_ACCOUNT_ID:    this.cfg.env.CLOUDFLARE_ACCOUNT_ID    ?? null,
      // OpenAI-compatible commercial vendor keys (openai / groq / deepseek / …).
      // Passed straight through so an explicit `<vendor>/<id>` pin (e.g. from the
      // dataset wizard or model picker) reaches the vendor via the SAME dispatch
      // machinery. Each is autoRoute:false, so an unbound key just means that
      // vendor is skipped — it never affects the default FREE/PRO cascade. The
      // list is derived from `OPENAI_COMPATIBLE_VENDOR_KEYS` so it can't drift
      // from the registered vendors.
      ...passthroughVendorKeys(this.cfg.env),
      // A tenant BYO OpenAI key overrides the operator OpenAI key (spread above)
      // for the `openai` vendor — marked tenant-funded → byo, $0 to us.
      ...(this.cfg.tenantVendorKeys.openai ? { OPENAI_API_KEY: this.cfg.tenantVendorKeys.openai } : {}),
      ...(this.cfg.tenantVendorKeys.kimi ? { KIMI_CODE_API_KEY: this.cfg.tenantVendorKeys.kimi } : {}),
      ...(this.cfg.tenantVendorKeys.moonshot ? { MOONSHOT_API_KEY: this.cfg.tenantVendorKeys.moonshot } : {}),
      ...(this.cfg.tenantVendorKeys.qwen ? { QWEN_API_KEY: this.cfg.tenantVendorKeys.qwen } : {}),
      ...(this.cfg.tenantVendorKeys.minimax ? { MINIMAX_API_KEY: this.cfg.tenantVendorKeys.minimax } : {}),
      ...(this.cfg.tenantVendorKeys.xai ? { XAI_API_KEY: this.cfg.tenantVendorKeys.xai } : {}),
      // A tenant BYO Meta AI key powers the `meta` vendor (MUSE models). There is
      // NO operator-level Meta key — this is the ONLY source. When absent the meta
      // vendor no-key-skips at dispatch, same as any other unbound vendor.
      ...(this.cfg.tenantVendorKeys.meta ? { META_API_KEY: this.cfg.tenantVendorKeys.meta } : {}),
      // A tenant BYO Ollama Cloud key overrides the operator OLLAMA_API_KEY (set
      // above) for the `ollama` vendor — tenant-funded → byo, $0 to us.
      ...(this.cfg.tenantVendorKeys.ollama ? { OLLAMA_API_KEY: this.cfg.tenantVendorKeys.ollama } : {}),
      // A tenant's self-hosted Ollama connection powers the `ollama-local` vendor.
      // There is NO operator-level equivalent — this is the ONLY source. Absent →
      // the vendor no-key-skips at dispatch, same as `meta`.
      ...(this.cfg.tenantVendorKeys['ollama-local'] ? { OLLAMA_LOCAL_CONFIG: this.cfg.tenantVendorKeys['ollama-local'] } : {}),
    };
  }

  /**
   * Vendor env that forces the *credited* (Pro) OpenRouter key regardless of the
   * proxy's plan, so the guaranteed backstop can reach paid models even when the
   * request itself came in on the free key. Falls back to the standard key when
   * no Pro key is bound (single-key deployments still get a backstop attempt).
   */
  creditedVendorEnv(): VendorEnv {
    return {
      ...this.vendorEnv(),
      OPENROUTER_API_KEY: this.cfg.env.OPENROUTER_API_KEY_PRO ?? this.cfg.env.OPENROUTER_API_KEY ?? null,
    };
  }
}
