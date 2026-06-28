/**
 * Vendor registry — single source of truth for which vendor owns which model,
 * how to classify a model's tier, and how to walk a multi-vendor cascade.
 *
 * Adding a new vendor: import its `VendorModule` and add it to `MODULES`. The
 * catalog/tier/cascade behavior is derived automatically from the module.
 */

import { anthropicModule } from './anthropic';
import { cerebrasModule } from './cerebras';
import { cloudflareModule } from './cloudflare';
import { evermindModule } from './evermind';
import { googleAiModule } from './googleai';
import { nvidiaModule } from './nvidia';
import { ollamaModule } from './ollama';
import { openRouterModule } from './openrouter';
import { openAICompatibleModules, openAICompatibleModulesById } from './openaiCompatibleVendors';
import { registerSchemaDialectResolver } from '../jsonSchemaSanitize';
import {
  VendorRetryableError,
  VendorFatalError,
  VendorSchemaError,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
  isEmptyChatResponse,
  SCHEMA_TOO_COMPLEX_REASON,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorId,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

/**
 * Vendor priority for the cascade — fastest TTFT first, so that when keys are
 * bound for multiple vendors the free pool naturally lands sub-200ms Cerebras
 * entries at the top, Ollama Cloud next, NVIDIA NIM, then OpenRouter free
 * (highest variance, broadest coverage). `googleai` is intentionally last:
 * its catalog is all PREMIUM-tier and serves only as the proxy's last-resort
 * paid fallback, not as part of the free rotation. This order propagates into:
 *   - `modelsByTier(...)` → the FREE/PRO pool composition in LlmProxyService
 *   - `getCrossVendorFallbacks(...)` → the cross-vendor tail of each chain
 * Drives both Pool composition and Pool ordering with one source of truth.
 */
// `anthropicModule` sits last: it is `autoRoute: false` (never part of the FREE/PRO
// rotation), reachable only via the curated coding fallback chain or an explicit
// pin, so its position here does not affect auto-pool ordering.
// The OpenAI-compatible commercial vendors (openai/groq/deepseek/…) sit at the
// TAIL: every one is `autoRoute: false`, so their position never affects the
// auto-selected FREE/PRO pool ordering above — they only matter when a caller
// pins `<vendor>/<id>` explicitly. Appending them here brings the live, wired
// vendor count to 30+ (the "30+ model providers" marketing claim) without
// touching the tuned free/paid cascade. See openaiCompatibleVendors.ts.
const MODULES: ReadonlyArray<VendorModule> = [
  cerebrasModule, ollamaModule, nvidiaModule, cloudflareModule, openRouterModule, googleAiModule, anthropicModule,
  // `evermind` is autoRoute:false (explicit `evermind/<ref>` pin only), so its
  // position never affects the auto-selected FREE/PRO pool ordering.
  evermindModule,
  ...openAICompatibleModules,
];

const MODULES_BY_ID: Record<VendorId, VendorModule> = {
  // Factory-built OpenAI-compatible commercial vendors first (spread, keyed by id);
  // the bespoke modules below are distinct ids, so nothing is overwritten.
  ...(openAICompatibleModulesById as Record<VendorId, VendorModule>),
  openrouter: openRouterModule,
  cerebras:   cerebrasModule,
  nvidia:     nvidiaModule,
  ollama:     ollamaModule,
  googleai:   googleAiModule,
  cloudflare: cloudflareModule,
  anthropic:  anthropicModule,
  evermind:   evermindModule,
};

/** Wire the JSON-Schema sanitizer to read each vendor's `schemaDialect` from
 *  the registry (metadata-driven strip sets, no hardcoded vendor-id list).
 *  Done at module-init to avoid a circular import (the sanitizer is imported by
 *  the vendor modules themselves). Unknown ids resolve to no strip set. */
registerSchemaDialectResolver((vendorId: string): readonly string[] => {
  const mod = (MODULES_BY_ID as Record<string, VendorModule | undefined>)[vendorId];
  return mod?.schemaDialect?.stripKeywords ?? [];
});

/** Used when a model id isn't in any vendor's catalog (treats as OpenRouter). */
const DEFAULT_VENDOR: VendorId = 'openrouter';

const INDEX: Map<string, { vendor: VendorId; entry: VendorModelEntry }> = new Map();
for (const mod of MODULES) {
  for (const entry of mod.catalog) {
    INDEX.set(entry.id, { vendor: mod.id, entry });
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const VENDOR_PREFIXES: ReadonlyArray<{ prefix: string; vendor: VendorId }> = [
  { prefix: 'openrouter/', vendor: 'openrouter' },
  { prefix: 'cerebras/',   vendor: 'cerebras' },
  { prefix: 'nim/',        vendor: 'nvidia' },
  { prefix: 'ollama/',     vendor: 'ollama' },
  { prefix: 'googleai/',   vendor: 'googleai' },
  // Our own model: `evermind/<r2-ref>` routes to the in-Worker EvermindLM. The
  // ref may itself contain `/` (it's an R2 key prefix) — parseVendorPrefix takes
  // everything after `evermind/` as the model id, which is exactly the ref.
  { prefix: 'evermind/',   vendor: 'evermind' },
  // Cloudflare model ids natively start with `@cf/...` so they're
  // self-identifying without a `cloudflare/` URL-style prefix. We still accept
  // `cloudflare/@cf/...` for symmetry with the other vendors — callers who
  // prefer the explicit form can use it; bare `@cf/...` resolves via catalog.
  { prefix: 'cloudflare/', vendor: 'cloudflare' },
  // Explicit `direct/<vendor>/<model-id>` routing for every factory-built
  // OpenAI-compatible commercial vendor (`direct/openai/gpt-4o`,
  // `direct/groq/llama-3.3-70b-versatile`, `direct/deepseek/deepseek-chat`, …).
  //
  // The `direct/` namespace is REQUIRED to avoid a collision: a bare provider
  // prefix like `openai/` or `mistral/` would hijack OpenRouter's `<org>/<slug>`
  // model id namespace (`openai/gpt-oss-120b:free`, `mistralai/...`) and silently
  // re-route an OpenRouter model to the direct vendor. `direct/<vendor>/...` can
  // never collide with an OpenRouter slug. These vendors are autoRoute:false, so a
  // prefix pin is the ONLY way to reach them — exactly what the dataset wizard /
  // model picker passes through.
  //
  // Derived from the module list so the prefix set can never drift from the
  // registered vendors.
  ...openAICompatibleModules.map((m) => ({ prefix: `direct/${m.id}/`, vendor: m.id })),
];

/**
 * Parse an explicit vendor-prefixed model id.
 *
 * Caller may pass `openrouter/anthropic/claude-3-haiku`, `cerebras/llama3.1-8b`,
 * or `ollama/gpt-oss:120b` to route the request to a specific vendor without
 * relying on catalog membership. Returns `null` for bare ids — callers should
 * fall back to catalog lookup via `vendorForModel`.
 */
export function parseVendorPrefix(modelId: string): { vendor: VendorId; modelId: string } | null {
  for (const { prefix, vendor } of VENDOR_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      return { vendor, modelId: modelId.slice(prefix.length) };
    }
  }
  return null;
}

export function vendorForModel(modelId: string): VendorId {
  const prefix = parseVendorPrefix(modelId);
  if (prefix) return prefix.vendor;
  return INDEX.get(modelId)?.vendor ?? DEFAULT_VENDOR;
}

/**
 * Whether the given vendor has an API key bound in this env. Centralised here
 * so neither the proxy nor the admin route has to repeat the per-vendor
 * `env.<NAME>_API_KEY` conditional — each vendor module owns its key-lookup.
 */
export function vendorKeyBound(env: VendorEnv, vendor: VendorId): boolean {
  return !!MODULES_BY_ID[vendor].apiKeyFrom(env);
}

export function tierForModel(modelId: string): AiModelTier {
  const vendorId = vendorForModel(modelId);
  return MODULES_BY_ID[vendorId].tierFor(modelId);
}

export function catalogEntry(modelId: string): (VendorModelEntry & { vendor: VendorId }) | null {
  const hit = INDEX.get(modelId);
  if (!hit) return null;
  return { ...hit.entry, vendor: hit.vendor };
}

export function getCatalog(): ReadonlyArray<VendorModelEntry & { vendor: VendorId }> {
  return MODULES.flatMap((mod) =>
    mod.catalog.map((entry) => ({ ...entry, vendor: mod.id })),
  );
}

export function getModule(id: VendorId): VendorModule {
  return MODULES_BY_ID[id];
}

/** All registered vendor ids, in registry order (cerebras → ollama → nvidia → openrouter). */
export function getAllVendorIds(): VendorId[] {
  return MODULES.map((m) => m.id);
}

/**
 * All catalog model ids of a given tier, in registry order. Used to compose
 * Free vs Pro pools without hard-coding model lists.
 */
export function modelsByTier(...tiers: AiModelTier[]): string[] {
  const set = new Set(tiers);
  return MODULES.flatMap((mod) =>
    mod.catalog.filter((m) => set.has(m.tier)).map((m) => m.id),
  );
}

/** Whether a vendor's models may be auto-selected into a failover pool. A vendor
 *  is auto-routable unless it opts out (`autoRoute: false`) — e.g. Ollama, which
 *  must only run when a caller explicitly pins `ollama/<id>`. */
export function vendorAutoRoutes(vendor: VendorId): boolean {
  return MODULES_BY_ID[vendor].autoRoute !== false;
}

/**
 * Like {@link modelsByTier}, but EXCLUDES vendors that opt out of auto-routing
 * (`autoRoute: false`). This is the composer for the gateway's auto-selected
 * FREE/PRO pools: a non-auto-route vendor (Ollama) stays in the catalog — and so
 * remains reachable via an explicit `ollama/<id>` pin — but can never be the model
 * a cascade silently falls onto. Keeping this separate from `modelsByTier` leaves
 * the "all models of a tier" query (catalog/admin) honest.
 */
export function autoRoutableModelsByTier(...tiers: AiModelTier[]): string[] {
  const set = new Set(tiers);
  return MODULES.filter((mod) => mod.autoRoute !== false).flatMap((mod) =>
    mod.catalog.filter((m) => set.has(m.tier)).map((m) => m.id),
  );
}

// ---------------------------------------------------------------------------
// Dispatch — walk a model chain across vendors
// ---------------------------------------------------------------------------

type DispatchBody = Omit<VendorCallParams, 'apiKey' | 'model'>;

export interface DispatchAttempt {
  model: string;
  vendor: VendorId;
  status: number;
  error: string;
  /** Wall-clock time spent on this attempt, ms (diagnostic tracing). */
  durationMs?: number;
  /** Coarse failure class — rate_limit | timeout | auth | server_error |
   *  client_error | schema | network (diagnostic tracing). Derived from status +
   *  error, except `schema` which is set explicitly for a {@link VendorSchemaError}. */
  kind?: string;
  /** Stable machine-readable cause slug when one applies (e.g. `schema_too_complex`).
   *  Lets consumers branch on structured data instead of regex-sniffing the message. */
  reason?: string;
  /** The REAL upstream HTTP status before the gateway normalized it into its own
   *  class (e.g. a Gemini schema 400 normalized to the 422 request-error class is
   *  recorded here as `400`). Absent when `status` already IS the upstream status. */
  upstreamStatus?: number;
}

/**
 * Coarse failure class for one attempt — populates `DispatchAttempt.kind` and,
 * rolled up, the trace's `classification`. Mirrors the buckets a consumer sees
 * in the failover breakdown. Derived from HTTP status, with an error-text
 * fallback for the status-0 (network / thrown-before-response) case so timeouts
 * stay distinguishable from generic network failures.
 */
export function kindForStatus(status: number, error?: string): string {
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  if (error && /timed?\s*out|timeout|aborted/i.test(error)) return 'timeout';
  return 'network';
}

/**
 * Thrown when every candidate in the cascade fails. Carries the structured
 * `attempts[]` so the orchestrator can record per-vendor cooldowns *before*
 * surfacing the 429 to the caller — without this the dispatcher's failure
 * record is lost in `Error.message`.
 */
export class CascadeExhaustedError extends Error {
  public readonly attempts: ReadonlyArray<DispatchAttempt>;
  public readonly skippedNoKey: ReadonlyArray<string>;
  public readonly skippedNoStream: ReadonlyArray<string>;
  constructor(
    kind: 'json' | 'stream',
    attempts: ReadonlyArray<DispatchAttempt>,
    skippedNoKey: ReadonlyArray<string>,
    skippedNoStream: ReadonlyArray<string> = [],
  ) {
    const summary = attempts.map((a) => `${a.vendor}/${a.model}=${a.status}`).join(', ');
    const noKey = skippedNoKey.length    > 0 ? ` (skipped no-key: ${skippedNoKey.join(', ')})` : '';
    const noStr = skippedNoStream.length > 0 ? ` (skipped no-stream: ${skippedNoStream.join(', ')})` : '';
    const head  = kind === 'stream' ? 'AI streaming vendor cascade exhausted' : 'AI vendor cascade exhausted';
    super(`${head} (${attempts.length} attempts: ${summary})${noKey}${noStr}`);
    this.name = 'CascadeExhaustedError';
    this.attempts = attempts;
    this.skippedNoKey = skippedNoKey;
    this.skippedNoStream = skippedNoStream;
  }
}

export interface DispatchParams extends DispatchBody {
  env: VendorEnv;
  modelChain: string[];
}

export interface DispatchResult extends VendorCallResult {
  modelUsed: string;
  vendorUsed: VendorId;
  attempts: DispatchAttempt[];
}

export interface StreamDispatchResult extends VendorStreamResult {
  modelUsed: string;
  vendorUsed: VendorId;
  attempts: DispatchAttempt[];
}

/**
 * Resolve a model id to its vendor + the un-prefixed id the vendor expects.
 *   - `openrouter/<x>` → vendor=openrouter, vendorModel=`<x>`
 *   - `cerebras/<x>`   → vendor=cerebras,   vendorModel=`<x>`
 *   - `ollama/<x>`     → vendor=ollama,     vendorModel=`<x>`
 *   - bare ids         → catalog lookup, vendorModel = the bare id
 */
function resolveVendorAndModel(model: string): { vendorId: VendorId; vendorModel: string } {
  const prefix = parseVendorPrefix(model);
  if (prefix) return { vendorId: prefix.vendor, vendorModel: prefix.modelId };
  return { vendorId: vendorForModel(model), vendorModel: model };
}

/**
 * Per-surface configuration for {@link dispatchInternal}. The JSON and streaming
 * dispatchers differ ONLY in these four points — the chain walk, key/skip
 * handling, error classification, cooldown-relevant `attempts[]`, and
 * exhaustion error are identical and live once below.
 */
interface SurfaceConfig<R extends VendorCallResult | VendorStreamResult> {
  /** Tags the {@link CascadeExhaustedError} and toggles its no-stream list. */
  kind: 'json' | 'stream';
  /** Function name for the empty-chain guard message. */
  fnName: string;
  /** Log prefix (`''` for JSON, `'stream '` for streaming). */
  logTag: string;
  /** False → vendor doesn't support this surface; the model is skipped+recorded. */
  supports: (mod: VendorModule) => boolean;
  /** The vendor call for this surface (`mod.call` vs `mod.callStream`). */
  invoke: (mod: VendorModule, params: VendorCallParams) => Promise<R>;
  /** Post-success validation; may throw VendorRetryableError (empty-200 check). */
  validate?: (result: R, vendorId: VendorId, vendorModel: string) => void;
}

/**
 * Shared cascade walk for both the JSON and streaming surfaces. Resolves each
 * model to its vendor, skips no-key (and, per `supports`, no-surface) vendors,
 * invokes the call, and on `VendorRetryableError` advances to the next model —
 * recording every attempt so the proxy can apply per-vendor cooldowns before
 * surfacing exhaustion. Subrequest-exhaustion and request-abort short-circuit
 * the chain; any other error bubbles up (fatal).
 */
async function dispatchInternal<R extends VendorCallResult | VendorStreamResult>(
  params: DispatchParams,
  cfg: SurfaceConfig<R>,
): Promise<R & { modelUsed: string; vendorUsed: VendorId; attempts: DispatchAttempt[] }> {
  const { env, modelChain, ...rest } = params;
  if (modelChain.length === 0) {
    throw new Error(`${cfg.fnName}: modelChain is empty`);
  }

  const attempts: DispatchAttempt[] = [];
  const skippedNoKey: string[] = [];
  const skippedNoStream: string[] = [];

  for (const model of modelChain) {
    const { vendorId, vendorModel } = resolveVendorAndModel(model);
    const mod = MODULES_BY_ID[vendorId];
    if (!cfg.supports(mod)) {
      skippedNoStream.push(`${vendorId}:${model}`);
      continue;
    }
    const apiKey = mod.apiKeyFrom(env);
    if (!apiKey) {
      skippedNoKey.push(`${vendorId}:${model}`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await cfg.invoke(mod, { ...rest, apiKey, model: vendorModel });
      cfg.validate?.(result, vendorId, vendorModel);
      // `modelUsed` echoes what the caller asked for (with prefix preserved).
      return { ...result, modelUsed: model, vendorUsed: vendorId, attempts };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      // Worker hit Cloudflare's per-invocation subrequest cap — every future
      // fetch from this isolate is guaranteed to throw the same thing. Stop the
      // cascade and bubble up so the proxy surfaces a distinct 503 envelope
      // WITHOUT writing more cooldown KV entries (themselves more subrequests).
      if (err instanceof WorkerSubrequestExhaustedError) {
        attempts.push({ model, vendor: vendorId, status: 0, error: err.message, durationMs, kind: 'network' });
        throw err;
      }
      // Caller cancelled mid-run — stop the cascade (don't fail over and spend more).
      if (err instanceof RequestAbortedError) {
        attempts.push({ model, vendor: vendorId, status: 0, error: err.message, durationMs, kind: 'aborted' });
        throw err;
      }
      // Schema-too-complex: the upstream rejected the json_schema as too complex
      // for ITS constrained-decoding engine. A different vendor may accept the
      // same schema, so CASCADE — but normalize to the 422 request-error class
      // (so it writes NO cooldown; the model is healthy) and tag `kind: 'schema'`
      // + the real upstream status. If EVERY candidate rejects it, the proxy
      // surfaces a terminal `schema_too_complex` 4xx instead of a 429.
      if (err instanceof VendorSchemaError) {
        attempts.push({
          model, vendor: vendorId, status: 422, error: err.message, durationMs,
          kind: 'schema', reason: SCHEMA_TOO_COMPLEX_REASON, upstreamStatus: err.status,
        });
        console.warn(
          `[vendors] ${cfg.logTag}${vendorId}/${model} rejected json_schema as too complex (upstream ${err.status}); trying next vendor (${attempts.length}/${modelChain.length})`,
        );
        continue;
      }
      if (err instanceof VendorRetryableError) {
        attempts.push({ model, vendor: vendorId, status: err.status, error: err.message, durationMs, kind: kindForStatus(err.status, err.message) });
        console.warn(
          `[vendors] ${cfg.logTag}${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)`,
        );
        continue;
      }
      // Request-error (400/422) VendorFatalError: the payload is bad for THIS
      // vendor, but vendors differ on schema dialects — one may reject a tool/
      // json-schema another accepts. Advance the cascade instead of bubbling out
      // [1488]; if EVERY candidate request-errors, CascadeExhaustedError carries
      // these attempts and the proxy's exhaustedResponse surfaces a real 4xx (not
      // a misleading 429). recordFailure no-ops request_error, so no model cools.
      if (err instanceof VendorFatalError && (err.status === 400 || err.status === 422)) {
        attempts.push({ model, vendor: vendorId, status: err.status, error: err.message, durationMs, kind: kindForStatus(err.status, err.message) });
        console.warn(
          `[vendors] ${cfg.logTag}${vendorId}/${model} returned ${err.status} (request error); trying next vendor (${attempts.length}/${modelChain.length})`,
        );
        continue;
      }
      throw err; // other VendorFatalError (or anything else) — bubble up
    }
  }

  throw new CascadeExhaustedError(cfg.kind, attempts, skippedNoKey, skippedNoStream);
}

/** Walk a model chain non-streaming. Throws if every model in the chain fails. */
export function dispatchVendor(params: DispatchParams): Promise<DispatchResult> {
  return dispatchInternal<VendorCallResult>(params, {
    kind: 'json',
    fnName: 'dispatchVendor',
    logTag: '',
    supports: () => true, // every vendor implements the non-streaming `call`
    invoke: (mod, p) => mod.call(p),
    // Empty-but-200 detection. Some free-tier upstreams accept a request, burn
    // 10–20s, then return `choices[0].message.content === ""` with no error
    // code. Treat as retryable so the cascade advances and the model gets cooled
    // via the `embedded` classification (5 min).
    validate: (result, vendorId, vendorModel) => {
      if (isEmptyChatResponse(result)) {
        throw new VendorRetryableError(
          vendorId,
          vendorModel,
          502,
          `embedded:empty: upstream returned 200 OK with no content for ${vendorId}/${vendorModel}`,
        );
      }
    },
  });
}

/**
 * Walk a model chain in streaming mode. Skips vendors that don't implement
 * `callStream` (e.g. Ollama). Throws if every streaming-capable model fails.
 */
export function dispatchVendorStream(params: DispatchParams): Promise<StreamDispatchResult> {
  return dispatchInternal<VendorStreamResult>(params, {
    kind: 'stream',
    fnName: 'dispatchVendorStream',
    logTag: 'stream ',
    supports: (mod) => !!mod.callStream,
    invoke: (mod, p) => mod.callStream!(p),
  });
}
