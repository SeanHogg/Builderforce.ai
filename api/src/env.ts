import type { TenantRole } from './domain/shared/types';

/** Cloudflare Worker environment bindings for the API worker. */
export interface Env {
  /** Postgres connection string. Set via `wrangler secret put NEON_DATABASE_URL`. */
  NEON_DATABASE_URL: string;
  /** Operational Postgres connection (logs, audit, telemetry and processing
   * ledgers). When omitted during local/test rollout, the primary connection is
   * used for backwards compatibility. */
  NEON_TRANSACTIONAL_DATABASE_URL?: string;
  /** Comma-separated allowed CORS origins, e.g. "https://builderforce.ai" */
  CORS_ORIGINS: string;
  /** "production" | "development" */
  ENVIRONMENT: string;
  /** Secret used to sign JWTs.  Set via `wrangler secret put JWT_SECRET`. */
  JWT_SECRET: string;
  /** Kill switch for the logged-out guest Brain/Ideas chat. Guests can try the
   *  Brain before signing up (metered per visitor + IP, tiny cap). Set to the
   *  string "false" to hard-disable anonymous gateway traffic; any other value
   *  (or unset) leaves it ON. Toggle via `wrangler secret put GUEST_BRAIN_ENABLED`. */
  GUEST_BRAIN_ENABLED?: string;
  /** Kill switch for the sales-cycle demo accounts (seeded persona tenants entered
   *  from the marketing shell — migration 0360). Set to the string "false" to
   *  disable `POST /api/demo/session` and the nightly reseed; any other value (or
   *  unset) leaves it ON. Toggle via `wrangler secret put DEMO_ACCOUNTS_ENABLED`. */
  DEMO_ACCOUNTS_ENABLED?: string;
  /** Shared secret the deploy workflow sends (header `x-demo-reseed-secret`) to
   *  trigger `POST /api/demo/reseed` after each deploy. Unset = only a superadmin
   *  web token can reseed. Set via `wrangler secret put DEMO_RESEED_SECRET`. */
  DEMO_RESEED_SECRET?: string;
  /** Quality ingest key (bfq_…) for DOGFOODING — the API ships its OWN unhandled
   *  500s to the Product Quality pillar via the public /api/quality-ingest endpoint
   *  (the same SDK path any customer uses). Unbound → self-reporting is skipped.
   *  Set via `wrangler secret put BUILDERFORCE_ERROR_API_KEY`. */
  BUILDERFORCE_ERROR_API_KEY?: string;
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
   *  falls back to Claude DIRECTLY on api.anthropic.com (claude-sonnet-5 →
   *  claude-opus-4-8), vendor-diverse from OpenRouter. Unbound → the cascade simply
   *  skips the Anthropic floor. Set via `wrangler secret put CLAUDE_API_KEY` (or
   *  api/.env + `npm run secrets:from-env`). */
  CLAUDE_API_KEY?: string;
  /** Cloudflare Workers AI auth token — `cfut_*`. Adds Cloudflare-hosted models
   *  (e.g. `@cf/qwen/qwen3-30b-a3b-fp8`) to the paid pool. Both this AND
   *  `CLOUDFLARE_ACCOUNT_ID` must be set; either missing → Cloudflare is skipped
   *  by the cascade. Set via `wrangler secret put CLOUDFLARE_AI_API_TOKEN`. */
  CLOUDFLARE_AI_API_TOKEN?: string;
  /** Cloudflare account id (32-char hex). Embedded in the Workers AI URL —
   *  `https://api.cloudflare.com/client/v4/accounts/<id>/ai/run/<model>`. Stored as
   *  a Worker SECRET (not committed config) so the id isn't exposed in the repo.
   *  Set via `wrangler secret put CLOUDFLARE_ACCOUNT_ID`. */
  CLOUDFLARE_ACCOUNT_ID?: string;

  // ---------------------------------------------------------------------------
  // OpenAI-compatible commercial LLM vendors (the "30+ providers" surface).
  // Each is an optional Bearer-key secret; when bound, that provider's models
  // are reachable via an explicit `<vendor>/<model-id>` pin through the same
  // gateway dispatch/fallback/cooldown machinery. Unbound → the vendor is simply
  // skipped. Set via `wrangler secret put <NAME>` (or api/.env + secrets:from-env).
  // ---------------------------------------------------------------------------
  /** OpenAI — api.openai.com/v1. */
  OPENAI_API_KEY?: string;
  /** Groq — api.groq.com/openai/v1. */
  GROQ_API_KEY?: string;
  /** DeepSeek — api.deepseek.com/v1. */
  DEEPSEEK_API_KEY?: string;
  /** Mistral — api.mistral.ai/v1. */
  MISTRAL_API_KEY?: string;
  /** Fireworks AI — api.fireworks.ai/inference/v1. */
  FIREWORKS_API_KEY?: string;
  /** DeepInfra — api.deepinfra.com/v1/openai. */
  DEEPINFRA_API_KEY?: string;
  /** xAI (Grok) — api.x.ai/v1. */
  XAI_API_KEY?: string;
  /** Perplexity — api.perplexity.ai. */
  PERPLEXITY_API_KEY?: string;
  /** Moonshot AI (Kimi) — api.moonshot.cn/v1. */
  MOONSHOT_API_KEY?: string;
  QWEN_API_KEY?: string;
  /** Hyperbolic — api.hyperbolic.xyz/v1. */
  HYPERBOLIC_API_KEY?: string;
  /** Novita AI — api.novita.ai/v3/openai. */
  NOVITA_API_KEY?: string;
  /** SambaNova Cloud — api.sambanova.ai/v1. */
  SAMBANOVA_API_KEY?: string;
  /** Lepton AI — api.lepton.ai/v1. */
  LEPTON_API_KEY?: string;
  /** Anyscale Endpoints — api.endpoints.anyscale.com/v1. */
  ANYSCALE_API_KEY?: string;
  /** OctoAI — text.octoai.run/v1. */
  OCTOAI_API_KEY?: string;
  /** Featherless AI — api.featherless.ai/v1. */
  FEATHERLESS_API_KEY?: string;
  /** Inference.net — api.inference.net/v1. */
  INFERENCENET_API_KEY?: string;
  /** Targon — api.targon.com/v1. */
  TARGON_API_KEY?: string;
  /** Avian.io — api.avian.io/v1. */
  AVIAN_API_KEY?: string;
  /** Nebius AI Studio — api.studio.nebius.com/v1. */
  NEBIUS_API_KEY?: string;
  /** Baseten — inference.baseten.co/v1. */
  BASETEN_API_KEY?: string;
  /** Lambda Inference — api.lambda.ai/v1. */
  LAMBDA_API_KEY?: string;
  /** Kluster.ai — api.kluster.ai/v1. */
  KLUSTERAI_API_KEY?: string;
  /** Parasail — api.parasail.io/v1. */
  PARASAIL_API_KEY?: string;
  /** nScale — inference.api.nscale.com/v1. */
  NSCALE_API_KEY?: string;
  /** Chutes AI — llm.chutes.ai/v1. */
  CHUTES_API_KEY?: string;
  /** AI21 (Jamba) — api.ai21.com/studio/v1. */
  AI21_API_KEY?: string;
  /** SiliconFlow — api.siliconflow.com/v1. */
  SILICONFLOW_API_KEY?: string;
  /** MiniMax — api.minimax.io/v1. */
  MINIMAX_API_KEY?: string;

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

  /** OPTIONAL operator-wide Brave Search API key — the floor under the cloud agent's
   *  `web_search` tool. Search is metered per query, so the platform funds NO key: the
   *  normal path is a tenant's own BYO key in `integration_credentials`
   *  (provider `brave_search`), which always wins over this. Set this only if you are
   *  self-hosting and want to fund search for every tenant. When neither is configured,
   *  `web.search` is not advertised and the agent keeps fetch-only web access — no tool
   *  that would certainly fail is ever handed to the model.
   *  Set via `wrangler secret put BRAVE_SEARCH_API_KEY`. */
  BRAVE_SEARCH_API_KEY?: string;

  /** R2 bucket for file uploads. */
  UPLOADS?: R2Bucket;

  /** hired.video partner API key (@seanhogg/hired-video-sdk). Provisions job-seeker
   *  accounts for freelancers, uploads/parses resumes, and mints embed tokens for
   *  the embedded profile/resume viewer. When unset the freelance marketplace still
   *  works with the NATIVE R2 resume fallback; the hired.video calls are skipped and
   *  the provider reports `configured=false`. Set via `wrangler secret put HIRED_API_KEY`. */
  HIRED_API_KEY?: string;
  /** Optional override for the hired.video API base URL (defaults to the SDK default).
   *  `wrangler secret put HIRED_API_BASE_URL`. */
  HIRED_API_BASE_URL?: string;

  /** Freelancer payout provider webhook. When set, "Pay" on an approved freelancer
   *  invoice POSTs `{invoiceId, amountCents, currency, freelancerUserId, tenantId}`
   *  here (Bearer PAYOUT_WEBHOOK_KEY) and marks the invoice paid with the returned
   *  reference. Unset = manual "Mark paid" only (no money movement).
   *  `wrangler secret put PAYOUT_WEBHOOK_URL`. */
  PAYOUT_WEBHOOK_URL?: string;
  /** Bearer key for PAYOUT_WEBHOOK_URL. `wrangler secret put PAYOUT_WEBHOOK_KEY`. */
  PAYOUT_WEBHOOK_KEY?: string;

  /** Transactional-email webhook for marketplace notifications (invite/hire/paid/…).
   *  When set, each in-app notification also POSTs `{to, subject, body}` here
   *  (Bearer NOTIFY_EMAIL_KEY). Unset = in-app notifications only.
   *  `wrangler secret put NOTIFY_EMAIL_URL`. */
  NOTIFY_EMAIL_URL?: string;
  /** Bearer key for NOTIFY_EMAIL_URL. `wrangler secret put NOTIFY_EMAIL_KEY`. */
  NOTIFY_EMAIL_KEY?: string;

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

  /** Durable Object: the SINGLE WRITER for a project's self-learning Evermind
   *  model. One instance per project (`idFromName('proj:<tenantId>:<projectId>')`);
   *  serializes concurrent learning pushes, FedAvg-merges weight deltas, and
   *  republishes versioned models to R2 (UPLOADS). Optional: when unset, the
   *  /learn path returns 503 (concurrent learning disabled) and replicas still
   *  read published versions. Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "PROJECT_EVERMIND" class_name = "ProjectEvermindCoordinatorDO" */
  PROJECT_EVERMIND?: DurableObjectNamespace;

  /** Max text-path adaptations (fits) the Evermind coordinator DO runs per alarm —
   *  the per-alarm CPU knob. Overrides the code default (8); lower it if a busy
   *  project's alarm approaches the DO CPU limit. Parsed as an int; invalid → default. */
  EVERMIND_MAX_FITS_PER_ALARM?: string;

  /** Cloudflare Container runtime for a "Cloud Agent (Node/Container)" — a
   *  long-lived Node process with a real shell (the `container` runtime surface).
   *  One instance per execution (`idFromName('exec:<id>')`). Optional: when unset
   *  (or the container can't start), a `container`-surface run degrades to the
   *  durable executor so it still runs in the cloud. Backed by AgentContainerDO via
   *  a `[[containers]]` block in wrangler.toml; binding name `AGENT_CONTAINER`. */
  AGENT_CONTAINER?: DurableObjectNamespace;

  /** Live container-preview ingress (Replit-parity phase 2). When set to `'true'`
   *  the Worker proxies `preview.builderforce.ai/<token>/*` HTTP + WebSocket traffic
   *  through {@link AGENT_CONTAINER} to a dev server the run started inside its
   *  container (the `/__preview__` passthrough in `container/server.mjs`). Default
   *  unset ⇒ the ingress is inert (404), so the feature is fully off until an operator
   *  enables it on a Containers-Paid account. Requires a proxied `preview` DNS record.
   *  Toggle via `wrangler secret put PREVIEW_INGRESS_ENABLED`. */
  PREVIEW_INGRESS_ENABLED?: string;

  /** Cloudflare Container runtime for the Agentic Tester (browser exploration) —
   *  the Playwright runner image (qa-e2e/Dockerfile). The scheduled QA sweep
   *  dispatches `POST /run` to it per queued exploration. One instance per
   *  exploration (`idFromName('qa-exec:<id>')`). Optional: when unset the sweep
   *  only enqueues (a runner must drain the queue externally). Backed by
   *  QaRunnerContainerDO via a `[[containers]]` block; binding `QA_RUNNER_CONTAINER`. */
  QA_RUNNER_CONTAINER?: DurableObjectNamespace;

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
  // Payments — Stripe is the only provider (see infrastructure/payment/index.ts).
  // Absent secrets do NOT break boot; billing routes return 503 until they are set.
  // ---------------------------------------------------------------------------

  /** App URL used to build checkout success/cancel redirect URLs (e.g. "https://builderforce.ai") */
  APP_URL?: string;

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

  // ---------------------------------------------------------------------------
  // OAuth providers (optional — only required for the providers you enable)
  // Set via: wrangler secret put GOOGLE_CLIENT_ID  (etc.)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // GitHub App (optional — required for /api/webhooks/github)
  //
  // When GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY are both set, repo operations
  // authenticate as a GitHub App installation (short-lived, least-privilege,
  // survives the departure of whoever connected the repo) instead of the
  // tenant's stored user PAT. Unset = the pre-App behaviour, unchanged: see
  // resolveRepoAuth in application/repos/githubClient.ts for the fallback order.
  // ---------------------------------------------------------------------------

  /** Webhook secret configured in the GitHub App or repository webhook settings.
   *  Set via: wrangler secret put GITHUB_WEBHOOK_SECRET */
  GITHUB_WEBHOOK_SECRET?: string;

  /** Numeric App ID from the GitHub App's settings page.
   *  Set via: wrangler secret put GITHUB_APP_ID */
  GITHUB_APP_ID?: string;

  /** The App's PEM private key. GitHub issues these in PKCS#1 form
   *  ("BEGIN RSA PRIVATE KEY"); WebCrypto needs PKCS#8, and githubApp.ts
   *  converts transparently, so paste the file exactly as downloaded.
   *  Escaped "\n" sequences are tolerated for secret stores that mangle newlines.
   *  Set via: wrangler secret put GITHUB_APP_PRIVATE_KEY */
  GITHUB_APP_PRIVATE_KEY?: string;

  /** Secret token configured on the GitLab project/group webhook (sent as the
   *  `X-Gitlab-Token` header). Set via: wrangler secret put GITLAB_WEBHOOK_SECRET */
  GITLAB_WEBHOOK_SECRET?: string;

  /** Secret for the Bitbucket repo webhook HMAC (`X-Hub-Signature: sha256=…`).
   *  Set via: wrangler secret put BITBUCKET_WEBHOOK_SECRET */
  BITBUCKET_WEBHOOK_SECRET?: string;

  // ---------------------------------------------------------------------------
  // DevDynamics / Phase 6 (optional — required for integrations feature)
  // ---------------------------------------------------------------------------

  /** Passphrase used to derive the AES-256-GCM key for integration credential encryption.
   *  Set via: wrangler secret put INTEGRATION_ENCRYPTION_SECRET */
  INTEGRATION_ENCRYPTION_SECRET?: string;

  /** Dedicated passphrase for sealing SENSITIVE at-rest credentials — tenant BYO LLM
   *  provider keys + Claude/OpenAI/xAI subscription OAuth token blobs
   *  (`tenant_llm_provider_keys.key_enc`) and (as a follow-up) MFA secrets. Kept SEPARATE
   *  from `JWT_SECRET` on purpose: reusing the JWT signing key as the encryption key meant
   *  one leak both forged sessions AND decrypted every credential, and blocked JWT rotation.
   *  New writes derive an AES-256 key via PBKDF2 (100k) with a per-tenant salt under this
   *  secret (v2 scheme). Falls back to INTEGRATION_ENCRYPTION_SECRET, then JWT_SECRET, so an
   *  operator who hasn't set it yet keeps working — but SET IT to actually separate the keys.
   *  Legacy rows sealed under JWT_SECRET still decrypt (versioned dual-read).
   *  Set via: wrangler secret put CREDENTIAL_ENCRYPTION_SECRET */
  CREDENTIAL_ENCRYPTION_SECRET?: string;

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

  /** Incoming MS Teams webhook URL for incident/on-call notifications (an Incoming
   *  Webhook connector posting MessageCard JSON — the low-effort analog to Slack).
   *  Set via: wrangler secret put TEAMS_WEBHOOK_URL */
  TEAMS_WEBHOOK_URL?: string;

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

  /** Optional TURN relay for meeting media (mesh WebRTC). Without it, calls fall
   *  back to public STUN only, which fails for peers behind symmetric NATs.
   *  TURN_URL may be comma-separated (e.g. "turn:host:3478,turns:host:5349").
   *  Set via: wrangler secret put TURN_URL / TURN_USERNAME / TURN_CREDENTIAL */
  TURN_URL?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;

  /** Optional Cloudflare TURN service — the managed alternative to running coturn.
   *  When both are set, `/api/meetings/ice` mints short-lived TURN credentials per
   *  key (cached) and appends them to the ICE list, so symmetric-NAT peers connect
   *  with no self-hosted relay. Create a TURN key in the Cloudflare Realtime
   *  dashboard, then: wrangler secret put CLOUDFLARE_TURN_KEY_ID /
   *  CLOUDFLARE_TURN_API_TOKEN */
  CLOUDFLARE_TURN_KEY_ID?: string;
  CLOUDFLARE_TURN_API_TOKEN?: string;
}

/**
 * The single resolver for the user-facing app origin used to build links in
 * redirects and emails. APP_URL may hold a comma-separated allow-list (the CORS
 * config shares the var) — the first entry is the canonical origin. Trailing
 * slashes are stripped so callers can always append `/path`.
 */
export function resolveAppBaseUrl(env: { APP_URL?: string }): string {
  return (env.APP_URL ?? 'https://builderforce.ai')
    .split(',')[0]!
    .trim()
    .replace(/\/$/, '');
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
