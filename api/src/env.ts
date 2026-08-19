import type { TenantRole } from './domain/shared/types';
import type { Db } from './infrastructure/database/connection';
import type { MachineSubject } from './infrastructure/auth/machineSubject';

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
  /** Operator-wide emergency halt for every autonomous agent run. The workspace
   * switch remains tenant-owned; this is the platform incident-response fence. */
  AGENT_EXECUTION_ENABLED?: string;
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
  /** Cloudflare Browser Rendering token — scoped `Browser Rendering:Edit`. Powers the
   *  live-page CAPTURE behind `/api/creative/screenshot` (a redesign's "before" shot).
   *  Falls back to {@link CLOUDFLARE_AI_API_TOKEN} when a single account-wide token
   *  carries both scopes; with neither bound, capture reports itself unconfigured and
   *  the canvas relays that reason rather than inventing a limitation. Set via
   *  `wrangler secret put CLOUDFLARE_BROWSER_API_TOKEN`. */
  CLOUDFLARE_BROWSER_API_TOKEN?: string;

  // ---------------------------------------------------------------------------
  // OpenAI-compatible commercial LLM vendors (the "30+ providers" surface).
  // Each is an optional Bearer-key secret; when bound, that provider's models
  // are reachable via an explicit `<vendor>/<model-id>` pin through the same
  // gateway dispatch/fallback/cooldown machinery. Unbound → the vendor is simply
  // skipped. Set via `wrangler secret put <NAME>` (or api/.env + secrets:from-env).
  // ---------------------------------------------------------------------------
  /** OpenAI — api.openai.com/v1. Also powers the workflow builder's
   *  `transcribe-audio` node (Whisper's `/v1/audio/transcriptions`
   *  `/translations`) — a plain multipart REST call, not a chat-completion
   *  vendor dispatch, so it reads this key directly rather than through the
   *  gateway. Operator-funded only; no per-tenant BYO path for Whisper today. */
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
  /** Moonshot AI (Kimi) Open Platform — api.moonshot.ai/v1 (international); a key
   *  issued by the China platform resolves to api.moonshot.cn/v1 automatically. */
  MOONSHOT_API_KEY?: string;
  /** Kimi Code subscription API — api.kimi.com/coding/v1. */
  KIMI_CODE_API_KEY?: string;
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
  /** Cohere — api.cohere.com/compatibility/v1 (Command R/R+/A). */
  COHERE_API_KEY?: string;
  /** Azure OpenAI resource key — see `AZURE_OPENAI_ENDPOINT` below. */
  AZURE_OPENAI_API_KEY?: string;
  /** Azure OpenAI's FULL chat-completions URL for the configured deployment,
   *  including `?api-version=…`, e.g. `https://my-resource.openai.azure.com/
   *  openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview`.
   *  ONE operator-configured deployment, not a per-tenant multi-resource system —
   *  see `application/llm/vendors/azureOpenai.ts`. */
  AZURE_OPENAI_ENDPOINT?: string;
  /** Amazon Bedrock — ONE operator-configured AWS credential/region, SigV4-signed
   *  (see `application/llm/vendors/amazonBedrock.ts` + `awsSigV4.ts`). */
  AWS_BEDROCK_ACCESS_KEY_ID?: string;
  AWS_BEDROCK_SECRET_ACCESS_KEY?: string;
  /** e.g. `us-east-1`. */
  AWS_BEDROCK_REGION?: string;

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

  /** Optional stock-image providers used by Canvas image search. */
  UNSPLASH_ACCESS_KEY?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;

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

  /** OPTIONAL operator-funded Tavily key — a SECOND tier in the search-backing
   *  precedence in `webSearchCredential.ts`, used only when the tenant has no BYO
   *  search key of their own (Tavily/Exa/Linkup, in `integration_credentials`, which
   *  always wins). Unlike SEARXNG_URL below, this is a real per-query cost the
   *  operator is choosing to absorb on every uncredentialed tenant's behalf — set it
   *  only if that shared quota is an accepted tradeoff for this deployment.
   *  Set via `wrangler secret put TAVILY_API_KEY` (or api/.env + `npm run secrets:from-env`). */
  TAVILY_API_KEY?: string;

  /** OPTIONAL origin of a SearXNG instance YOU run, e.g. `https://search.internal` or
   *  `http://searxng:8080` — the THIRD tier of the search-backing precedence in
   *  `webSearchCredential.ts` (beneath a tenant's own BYO key and TAVILY_API_KEY
   *  above). Unmetered and free to run, which is why it sits below the funded
   *  operator key rather than above it; beneath it sits the keyless encyclopedic
   *  vendor that needs nothing at all.
   *
   *  This is the recommended way to give every tenant and every logged-out visitor real
   *  OPEN-WEB search: no vendor account, no per-query meter, and no third party learning
   *  what your users research. The instance must enable `formats: [json]` in its
   *  settings.yml, or it will answer API requests with a 403.
   *
   *  A PRIVATE address is expected and allowed here — this is operator configuration,
   *  not an untrusted URL, so it is deliberately exempt from the egress policy that
   *  guards model- and index-supplied URLs. Search works without it, just against a
   *  narrower index, and the tool result says which it used.
   *  Set via `wrangler secret put SEARXNG_URL` (or api/.env + `npm run secrets:from-env`). */
  SEARXNG_URL?: string;

  /** R2 bucket for file uploads. */
  UPLOADS?: R2Bucket;

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

  /** Durable Object namespace for a SHARED logged-out guest session — the free
   *  chat a visitor can invite other people into. One instance per room
   *  (`guestroom:<code>`); owns the room's COMBINED turn allowance, its bounded
   *  transcript, and the relay for both presence and the camera meeting's WebRTC
   *  signaling. Optional: when unset, guest chat still works solo (rooms return
   *  503 and the invite affordance is hidden). Bind in wrangler.toml:
   *    [[durable_objects.bindings]] name = "GUEST_ROOM" class_name = "GuestRoomDO" */
  GUEST_ROOM?: DurableObjectNamespace;

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

  /** Cloudflare Container runtime for the Stage Sandbox — the disposable
   *  headless-Chromium runner behind marketplace Stage checks (Playwright image
   *  at api/stage-sandbox). Dispatched once per Stage press per unique build
   *  (`idFromName('stage-sandbox:<runId>')`). Optional: when unset,
   *  `dispatchStageSandbox` returns false and the run row is marked `error`
   *  (fails open — publish proceeds with a `sandbox.unavailable` warn, exactly
   *  as every environment without this binding behaved before it existed).
   *  Backed by StageSandboxContainerDO via a `[[containers]]` block; binding
   *  `STAGE_SANDBOX_CONTAINER`. */
  STAGE_SANDBOX_CONTAINER?: DurableObjectNamespace;

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
   * Optional override (milliseconds) for the KV cron work-gate's floor interval —
   * how long an idle platform may go without an unconditional Postgres fan-out.
   * Unset → 30 min (see `application/runtime/cronWorkSignal.ts`). Clamped to
   * [5 min, 6 h]; a non-numeric value falls back to the default.
   *
   * This is a COST dial, not a correctness one: shorter = more idle Neon wake-ups
   * (~48/day at 30 min) and tighter worst-case staleness; longer = cheaper compute.
   * Set via `wrangler secret put CRON_FLOOR_INTERVAL_MS` or a `[vars]` entry.
   */
  CRON_FLOOR_INTERVAL_MS?: string;

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

  /**
   * Canonical public origin of THIS API, used to build addresses handed to third
   * parties — a project's webhook ingress URL, and the gateway URL baked into a
   * generated Worker. It cannot be derived from the request: the same worker is
   * reachable as `api.builderforce.ai` AND as `builderforce.ai/gateway/*`, and a
   * webhook URL pasted into Twilio's console must not depend on which one the
   * user happened to be on when they copied it. Defaults to the api subdomain.
   */
  API_ORIGIN?: string;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * The platform's cut of a marketplace sale, in basis points. 1500 = 15%.
   *
   * A take rate is deployment policy, not tenant data: a white-labelled install
   * charges what its operator decided, and every seller on one deployment is on
   * the same terms. It is read once per sale by `platformTakeRateBps()` and is
   * stamped onto the order line, so changing it never re-prices a past sale.
   */
  MARKETPLACE_TAKE_RATE_BPS?: string;
  /** Lifetime seller earnings, in cents, before the take rate applies at all.
   *  Defaults to $200,000 — free until it is material, then generous, which is
   *  the shape monday.com / Square / Atlassian all use. */
  MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS?: string;
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
  // Payout destinations (optional — the `payouts` port, one key pair per OAuth
  // provider). A `fields` provider (bank account, Wise) needs nothing here: the
  // earner supplies the whole credential, so it is connectable on every install.
  // ---------------------------------------------------------------------------
  /** Stripe Connect OAuth client id (`ca_…`). The SECRET half is
   *  `STRIPE_SECRET_KEY`, which Connect reuses — Stripe issues no second secret. */
  STRIPE_CONNECT_CLIENT_ID?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;

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

  /** Static SendPulse API key used only when Resend exhausts its daily/monthly quota.
   *  Set via: wrangler secret put SENDPULSE_API_KEY */
  SENDPULSE_API_KEY?: string;

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

  /** Cloudflare for SaaS — custom domains on published sites.
   *
   *  A tenant's own hostname (`shop.example.com`) lives on a zone we do not
   *  control, so serving it over HTTPS needs a certificate issued through
   *  Cloudflare for SaaS custom hostnames. OWNERSHIP verification does not need
   *  these (it resolves a TXT record over DNS-over-HTTPS); only the certificate
   *  does. When either is unset the domain flow still runs and still verifies,
   *  but parks at `pending_certificate` with that reason stated — see
   *  application/ide/customDomain.ts.
   *
   *  `CLOUDFLARE_ZONE_ID` is the builderforce.ai zone id (dashboard → Overview).
   *  The token needs the `Zone → SSL and Certificates → Edit` permission on that
   *  zone: wrangler secret put CLOUDFLARE_SAAS_API_TOKEN */
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_SAAS_API_TOKEN?: string;

  /** Salt for the one-way hash of a site visitor's IP (`site_records.ip_hash`,
   *  daily visitor counting). Falls back to JWT_SECRET so the feature works
   *  un-provisioned; set a dedicated value so rotating it cannot invalidate
   *  sessions: wrangler secret put SITE_VISITOR_SALT */
  SITE_VISITOR_SALT?: string;

  /** Origin baked into marketing-email tracking links (open pixel, click
   *  redirect, unsubscribe). MUST be stable forever — links already delivered
   *  keep resolving against it. Defaults to `https://builderforce.ai/gateway`,
   *  the same-origin gateway path corporate networks reliably allow. Override
   *  only for a separate deployment: wrangler secret put CAMPAIGN_TRACKING_ORIGIN */
  CAMPAIGN_TRACKING_ORIGIN?: string;
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

/**
 * The canonical public origin of THIS API — the one to hand to a third party.
 *
 * Deliberately NOT derived from the incoming request. The worker answers on both
 * `api.builderforce.ai` and `builderforce.ai/gateway/*`, so building a webhook
 * URL from `c.req.url` would produce a different address depending on which host
 * the user's browser happened to be on, and a URL already pasted into a provider
 * console would keep working while the one shown in the UI quietly changed.
 * Falls back to the api subdomain of the configured app origin.
 */
export function resolveApiOrigin(env: { API_ORIGIN?: string; APP_URL?: string }): string {
  if (env.API_ORIGIN) return env.API_ORIGIN.split(',')[0]!.trim().replace(/\/$/, '');
  const app = resolveAppBaseUrl(env);
  try {
    const url = new URL(app);
    return url.hostname.startsWith('api.') ? url.origin : `${url.protocol}//api.${url.hostname.replace(/^www\./, '')}`;
  } catch {
    return 'https://api.builderforce.ai';
  }
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
  /**
   * Set when the caller authenticated with a MACHINE token (`agentHost:*` /
   * `embed:*`) rather than as a person — see {@link MachineSubject}.
   *
   * `userId` still carries the raw subject because every tenant-scoped read needs a
   * subject; this is what lets a WRITE that records authorship tell the two apart.
   * Without it an on-prem agent host PATCHing a ticket was recorded as a human whose
   * user id was the literal string `agentHost:5`.
   */
  machineActor?: MachineSubject;
  /**
   * The cloud agent this request acts as (`JwtPayload.agt`) — set when a cloud agent
   * replays a platform route in-process to perform a tool call. Read by
   * {@link requestActor} so the write is credited to the agent.
   */
  agentActorRef?: string;
  /** Server-signed client surface from JwtPayload.src. */
  clientSurface?: 'vscode';
  /** True when the request is running under an emulation token (read-only). */
  isEmulation?: boolean;
  /**
   * The request's database handle, built once by the auth middleware.
   *
   * Downstream middleware (e.g. `requirePermission`) reads this instead of
   * calling `buildDatabase` again — one connection per request rather than one
   * per consumer, and it keeps those middlewares free of an infrastructure
   * import. Absent on unauthenticated paths, so callers must fall back.
   */
  db?: Db;
}

/** Combined Hono environment type used across the app. */
export type HonoEnv = { Bindings: Env; Variables: Vars };
