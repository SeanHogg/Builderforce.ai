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
  /** OpenRouter API key for coderClawLLM proxy.  Set via `wrangler secret put OPENROUTER_API_KEY`. */
  OPENROUTER_API_KEY: string;
  /** OpenRouter API key for coderClawLLMPro proxy.  Set via `wrangler secret put OPENROUTER_API_KEY_PRO`. */
  OPENROUTER_API_KEY_PRO: string;
  /** R2 bucket for file uploads. */
  UPLOADS?: R2Bucket;
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
