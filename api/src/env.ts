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
  /** OpenRouter API key for IDE chat and LLM proxy. Required for /api/ai/chat. Set via wrangler secret put OPENROUTER_API_KEY or api/.env + npm run secrets:from-env */
  OPENROUTER_API_KEY?: string;
  /** OpenRouter API key for coderClawLLMPro proxy.  Set via `wrangler secret put OPENROUTER_API_KEY_PRO`. */
  OPENROUTER_API_KEY_PRO?: string;
  /** R2 bucket for file uploads. */
  UPLOADS?: R2Bucket;

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

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;

  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;

  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
}

/** Variables injected into Hono context by the auth middleware. */
export interface Vars {
  userId:   string;
  tenantId: number;
  role:     TenantRole;
  sessionId?: string;
  tokenJti?: string;
}

/** Combined Hono environment type used across the app. */
export type HonoEnv = { Bindings: Env; Variables: Vars };
