import type { TenantRole } from './domain/shared/types';

/** Cloudflare Worker environment bindings for the API worker. */
export interface Env {
  /** Postgres connection string. Set via `wrangler secret put NEON_DATABASE_URL`. */
  NEON_DATABASE_URL: string;
  /** Comma-separated allowed CORS origins, e.g. "https://builderforce.ai" */
  CORS_ORIGINS: string;
  /** "production" | "development" */
  ENVIRONMENT: string;
  /** Secret used to sign JWTs.  Set via `wrangler secret put JWT_SECRET`. */
  JWT_SECRET: string;
  /** OpenRouter API key — drives builderforceLLM (Free plan) and IDE chat. Required for /api/ai/chat.
   *  Set via `wrangler secret put OPENROUTER_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  OPENROUTER_API_KEY?: string;
  /** OpenRouter API key for builderforceLLMPro / builderforceLLMTeams (paid models).
   *  Set via `wrangler secret put OPENROUTER_API_KEY_PRO`. Falls back to OPENROUTER_API_KEY when unset. */
  OPENROUTER_API_KEY_PRO?: string;
  /** Cerebras API key — enables sub-200ms TTFT models in the vendor cascade.
   *  Set via `wrangler secret put CEREBRAS_API_KEY`. */
  CEREBRAS_API_KEY?: string;
  /** Ollama Cloud API key — enables paid managed open-weight models.
   *  Set via `wrangler secret put OLLAMA_API_KEY`. */
  OLLAMA_API_KEY?: string;
  /** NVIDIA NIM API key (build.nvidia.com) — adds free NVIDIA-hosted models to the cascade.
   *  Set via `wrangler secret put NVIDIA_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  NVIDIA_API_KEY?: string;
  /** Google AI (Gemini) API key — powers the gateway's premium fallback. After the
   *  2-attempt free budget is exhausted every cascade falls through to Google AI direct
   *  (`gemini-2.5-flash` / `gemini-2.5-flash-lite`) so callers always see a successful
   *  response. Set via `wrangler secret put GOOGLE_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  GOOGLE_API_KEY?: string;
  /** Anthropic (Claude) API key — the last-resort reliability floor for cloud CODING
   *  runs. When every OpenRouter-routed paid coder is unreachable, the coding cascade
   *  falls back to Claude DIRECTLY on api.anthropic.com (claude-sonnet-4-6 →
   *  claude-opus-4-8), vendor-diverse from OpenRouter. Unbound → the cascade simply
   *  skips the Anthropic floor. Set via `wrangler secret put CLAUDE_API_KEY` (or
   *  api/.env + `npm run secrets:from-env`). */
  CLAUDE_API_KEY?: string;
  /** Cloudflare Workers AI auth token — `cfut_*`. Adds Cloudflare-hosted models
   *  (e.g. `@cf/meta/llama-3-8b-instruct`) to the paid pool. Both this AND
   *  `CLOUDFLARE_ACCOUNT_ID` must be set; either missing → Cloudflare is skipped
   *  by the cascade. Set via `wrangler secret put CLOUDFLARE_AI_API_TOKEN`. */
  CLOUDFLARE_AI_API_TOKEN?: string;
  /** Cloudflare account id (32-char hex). Embedded in the Workers AI URL —
   *  `https://api.cloudflare.com/client/v4/accounts/<id>/ai/run/<model>`. Not a
   *  secret per se, but stored alongside the token in Worker bindings.
   *  Set via `wrangler secret put CLOUDFLARE_ACCOUNT_ID`. */
  CLOUDFLARE_ACCOUNT_ID?: string;

  // ---------------------------------------------------------------------------
  // Image generation (`POST /v1/images/generations`)
  // ---------------------------------------------------------------------------

  /** Together.ai API key — free-tier image-generation vendor. Drives the
   *  primary attempts for `POST /v1/images/generations` (Flux Schnell free,
   *  DreamShaper, etc.) before falling through to the premium FluxAPI fallback.
   *  Set via `wrangler secret put TOGETHER_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  TOGETHER_API_KEY?: string;
  /** FluxAPI (fluxapi.ai) API key — premium image-generation fallback. After the
   *  free Together attempts fail, the proxy falls through to Flux Kontext Pro
   *  here so image-gen callers always see a successful response.
   *  Set via `wrangler secret put FLUX_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  FLUX_API_KEY?: string;

  // ---------------------------------------------------------------------------
  // Embeddings (`POST /v1/embeddings`)
  // ---------------------------------------------------------------------------

  /** Voyage AI API key — embeddings failover. After the primary OpenRouter
   *  embeddings attempts fail (endpoint outage, model removed, rate limit), the
   *  proxy falls through to Voyage (`voyage-3-lite`) so vector workflows keep
   *  working during a single-vendor outage. Optional — when unset, Voyage is
   *  silently skipped in the embeddings cascade.
   *  Set via `wrangler secret put VOYAGE_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  VOYAGE_API_KEY?: string;

  /** R2 bucket for file uploads. */
  UPLOADS?: R2Bucket;

  /** Clone-capable TTS endpoint for server-side voice synthesis (Voice PRD §3.1).
   *  Provider-agnostic: any service that accepts (referenceAudio, text) and
   *  returns audio bytes. When unset, the synthesize route returns an honest 503
   *  ("synthesis provider not configured") instead of faking audio.
   *  Set via `wrangler secret put VOICE_CLONE_TTS_URL`. */
  VOICE_CLONE_TTS_URL?: string;
  /** Bearer key for VOICE_CLONE_TTS_URL. `wrangler secret put VOICE_CLONE_TTS_KEY`. */
  VOICE_CLONE_TTS_KEY?: string;
  /** $/second-of-audio synthesis cost basis for ledger billing, in millicents
   *  per second. Defaults to 5 (≈ $0.05/min). `wrangler secret put VOICE_CLONE_COST_MC_PER_SEC`. */
  VOICE_CLONE_COST_MC_PER_SEC?: string;

  /** Durable Object namespace for per-tenant sliding-window rate limiting.
   *  Bind in wrangler.toml:  [[durable_objects.bindings]]  name = "TENANT_RATE_LIMITER" */
  TENANT_RATE_LIMITER?: DurableObjectNamespace;

  /** Durable Object namespace for collaborative session rooms (poker/retros).
   *  One instance per room (`poker:<id>` / `retro:<id>`); fans out a `changed`
   *  push to connected WebSocket clients after a mutation. Optional: when unset
   *  the surfaces still work (no live push). Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "SESSION_ROOM" class_name = "SessionRoomDO" */
  SESSION_ROOM?: DurableObjectNamespace;

  /** Durable Object namespace for the live standup/planning "ceremony" round-table.
   *  One instance per room (`ceremony:<projectId>`); relays presence, cursor and
   *  `changed` frames between connected clients (peer-to-peer multiplayer).
   *  Optional: when unset the ceremony surface still works (no live multiplayer).
   *  Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "CEREMONY_ROOM" class_name = "CeremonyRoomDO" */
  CEREMONY_ROOM?: DurableObjectNamespace;

  /** Durable Object namespace for the Architect / Digital-Transformation
   *  repo-analysis pipeline. One instance per analysis run (`idFromName(runId)`),
   *  advancing one stage per alarm() tick. Optional: when unset, the
   *  /api/repo-analysis POST returns 503 (feature disabled). Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "ANALYSIS_RUNNER" class_name = "AnalysisRunnerDO" */
  ANALYSIS_RUNNER?: DurableObjectNamespace;

  /** Durable Object running a V2 cloud agent's loop one LLM step per alarm() tick
   *  (the `durable` runtime surface). One instance per execution
   *  (`idFromName('exec:<id>')`). Optional: when unset, durable cloud runs fall
   *  back to the interim Worker `waitUntil` loop. Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "CLOUD_RUNNER" class_name = "CloudRunnerDO" */
  CLOUD_RUNNER?: DurableObjectNamespace;

  /** Cloudflare Container runtime for a "V2 Cloud Agent (Node/Container)" — a
   *  long-lived Node process with a real shell (the `container` runtime surface).
   *  One instance per execution (`idFromName('exec:<id>')`). Optional: when unset
   *  (or the container can't start), a `container`-surface run degrades to the
   *  durable executor so it still runs in the cloud. Backed by AgentContainerDO via
   *  a `[[containers]]` block in wrangler.toml; binding name `AGENT_CONTAINER`. */
  AGENT_CONTAINER?: DurableObjectNamespace;

  /** Internal base URL the Container calls back into for each LLM step / repo
   *  telemetry / PR finalize (the container-op endpoint). Defaults to the public
   *  API origin; override for local/dev. e.g. "https://api.builderforce.ai". */
  INTERNAL_API_BASE_URL?: string;

  /**
   * Optional KV namespace caching API-key → tenant resolutions for ~60s.
   * Without it, every chat-completion call hits the DB to validate `bfk_*` /
   * `clk_*`. With it, the auth lookup short-circuits on cache hit.
   *
   * Provision once:  `npx wrangler kv:namespace create AUTH_CACHE_KV`
   * Then bind in wrangler.toml:
   *   [[kv_namespaces]]  binding = "AUTH_CACHE_KV"  id = "<id from create output>"
   */
  AUTH_CACHE_KV?: KVNamespace;

  /**
   * Optional KV namespace backing the shared (L2) semantic response cache
   * (`/v1/semantic-cache`). Holds, per tenant+namespace partition, a bounded
   * list of {embedding, response} so a paraphrased prompt answered on one
   * surface (web or agent) can be reused by the other. Unbound → the endpoint
   * degrades to "always miss / no-op store" and clients fall back to local-only.
   *
   * Provision once:  `npx wrangler kv:namespace create SEMANTIC_CACHE_KV`
   * Then bind in wrangler.toml:
   *   [[kv_namespaces]]  binding = "SEMANTIC_CACHE_KV"  id = "<id from create output>"
   */
  SEMANTIC_CACHE_KV?: KVNamespace;

  // ---------------------------------------------------------------------------
  // Payment provider (optional — defaults to "manual" if unset)
  // ---------------------------------------------------------------------------

  /** Which payment provider to use: "manual" | "stripe" | "helcim"  Default: "manual" */
  PAYMENT_PROVIDER?: string;
  /** App URL used to build checkout success/cancel redirect URLs (e.g. "https://builderforce.ai") */
  APP_URL?: string;

  // Stripe (required when PAYMENT_PROVIDER=stripe)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Pro plan flat-rate prices */
  STRIPE_PRICE_PRO_MONTHLY?: string;    // price_... for $29/mo
  STRIPE_PRICE_PRO_YEARLY?: string;     // price_... for $290/yr
  /** Teams plan per-seat prices */
  STRIPE_PRICE_TEAMS_MONTHLY?: string;  // price_... for $20/seat/mo
  STRIPE_PRICE_TEAMS_YEARLY?: string;   // price_... for $192/seat/yr
  /** Legacy aliases (still accepted for backwards compatibility) */
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;

  // Helcim (required when PAYMENT_PROVIDER=helcim)
  HELCIM_API_TOKEN?: string;
  HELCIM_WEBHOOK_SECRET?: string;

  // ---------------------------------------------------------------------------
  // OAuth providers (optional — only required for the providers you enable)
  // Set via: wrangler secret put GOOGLE_CLIENT_ID  (etc.)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // GitHub App (optional — required for /api/webhooks/github)
  // ---------------------------------------------------------------------------

  /** Webhook secret configured in the GitHub App or repository webhook settings.
   *  Set via: wrangler secret put GITHUB_WEBHOOK_SECRET */
  GITHUB_WEBHOOK_SECRET?: string;

  /** Shared secret for internal cron endpoints (e.g. GET /api/approvals/escalate).
   *  Set via: wrangler secret put CRON_SECRET */
  CRON_SECRET?: string;

  // ---------------------------------------------------------------------------
  // DevDynamics / Phase 6 (optional — required for integrations feature)
  // ---------------------------------------------------------------------------

  /** Passphrase used to derive the AES-256-GCM key for integration credential encryption.
   *  Set via: wrangler secret put INTEGRATION_ENCRYPTION_SECRET */
  INTEGRATION_ENCRYPTION_SECRET?: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;

  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;

  // ---------------------------------------------------------------------------
  // Notifications (optional — approval alerts + escalation emails)
  // ---------------------------------------------------------------------------

  /** Incoming Slack webhook URL for approval notifications.
   *  Set via: wrangler secret put SLACK_APPROVAL_WEBHOOK_URL */
  SLACK_APPROVAL_WEBHOOK_URL?: string;

  /** Resend API key for email notifications.
   *  Set via: wrangler secret put RESEND_API_KEY */
  RESEND_API_KEY?: string;

  /** From address for notification emails, e.g. "Builderforce <notifications@builderforce.ai>" */
  NOTIFICATION_EMAIL_FROM?: string;

  /** Domain for inbound-email workflow triggers (the addressed inbox lives here),
   *  e.g. "inbound.builderforce.ai". Falls back to that default when unset. */
  INBOUND_EMAIL_DOMAIN?: string;

  /** Optional comma-separated override of LLM vendor-health alert recipients.
   *  When unset, the scheduled() runner emails every user with isSuperadmin=true.
   *  Set via: wrangler secret put LLM_HEALTH_ALERT_RECIPIENTS */
  LLM_HEALTH_ALERT_RECIPIENTS?: string;

  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
}

/** Variables injected into Hono context by the auth middleware. */
export interface Vars {
  userId:   string;
  tenantId: number;
  /**
   * Active segment id (the isolation tier below the tenant). Resolved once per
   * request by the auth middleware via resolveSegment(): a 'single' tenant maps
   * to its default segment; a 'segmented' tenant maps to the end-client segment
   * carried by the token's account/company claims. Business writes/reads scope
   * to this. Optional only because some unauthenticated/agentHost paths skip it.
   */
  segmentId?: string;
  role:     TenantRole;
  sessionId?: string;
  tokenJti?: string;
  /** True when the request is running under an emulation token (read-only). */
  isEmulation?: boolean;
}

/** Combined Hono environment type used across the app. */
export type HonoEnv = { Bindings: Env; Variables: Vars };
