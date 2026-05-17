/**
 * Vendor registry — single source of truth for which vendor owns which model,
 * how to classify a model's tier, and how to walk a multi-vendor cascade.
 *
 * Adding a new vendor: import its `VendorModule` and add it to `MODULES`. The
 * catalog/tier/cascade behavior is derived automatically from the module.
 */

import { cerebrasModule } from './cerebras';
import { nvidiaModule } from './nvidia';
import { ollamaModule } from './ollama';
import { openRouterModule } from './openrouter';
import {
  VendorRetryableError,
  isEmptyChatResponse,
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
 * (highest variance, broadest coverage). This order propagates into:
 *   - `modelsByTier(...)` → the FREE/PRO pool composition in LlmProxyService
 *   - `getCrossVendorFallbacks(...)` → the cross-vendor tail of each chain
 * Drives both Pool composition and Pool ordering with one source of truth.
 */
const MODULES: ReadonlyArray<VendorModule> = [cerebrasModule, ollamaModule, nvidiaModule, openRouterModule];

const MODULES_BY_ID: Record<VendorId, VendorModule> = {
  openrouter: openRouterModule,
  cerebras:   cerebrasModule,
  nvidia:     nvidiaModule,
  ollama:     ollamaModule,
};

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

/**
 * Cross-vendor fallback chain — each vendor's `fallbackModel`, but only for
 * vendors that have an API key configured in this env. Used to extend a
 * primary chain with a final last-resort run across providers.
 */
export function getCrossVendorFallbacks(env: VendorEnv): string[] {
  return MODULES
    .filter((mod) => !!mod.apiKeyFrom(env))
    .map((mod) => mod.fallbackModel);
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

// ---------------------------------------------------------------------------
// Dispatch — walk a model chain across vendors
// ---------------------------------------------------------------------------

type DispatchBody = Omit<VendorCallParams, 'apiKey' | 'model'>;

export interface DispatchAttempt {
  model: string;
  vendor: VendorId;
  status: number;
  error: string;
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

/** Walk a model chain non-streaming. Throws if every model in the chain fails. */
export async function dispatchVendor(params: DispatchParams): Promise<DispatchResult> {
  const { env, modelChain, ...rest } = params;
  if (modelChain.length === 0) {
    throw new Error('dispatchVendor: modelChain is empty');
  }

  const attempts: DispatchAttempt[] = [];
  const skippedNoKey: string[] = [];

  for (const model of modelChain) {
    const { vendorId, vendorModel } = resolveVendorAndModel(model);
    const mod = MODULES_BY_ID[vendorId];
    const apiKey = mod.apiKeyFrom(env);
    if (!apiKey) {
      skippedNoKey.push(`${vendorId}:${model}`);
      continue;
    }

    try {
      const result = await mod.call({ ...rest, apiKey, model: vendorModel });
      // Empty-but-200 detection. Some free-tier upstreams accept a request,
      // burn 10–20s, then return `choices[0].message.content === ""` with no
      // error code. Treat as retryable so the cascade advances and the model
      // gets cooled via the `embedded` classification (5 min).
      if (isEmptyChatResponse(result)) {
        throw new VendorRetryableError(
          vendorId,
          vendorModel,
          502,
          `embedded:empty: upstream returned 200 OK with no content for ${vendorId}/${vendorModel}`,
        );
      }
      // `modelUsed` echoes what the caller asked for (with prefix preserved).
      return { ...result, modelUsed: model, vendorUsed: vendorId, attempts };
    } catch (err) {
      if (err instanceof VendorRetryableError) {
        attempts.push({ model, vendor: vendorId, status: err.status, error: err.message });
        console.warn(
          `[vendors] ${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)`,
        );
        continue;
      }
      throw err; // VendorFatalError (or anything else) — bubble up
    }
  }

  throw new CascadeExhaustedError('json', attempts, skippedNoKey);
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
 * Walk a model chain in streaming mode. Skips vendors that don't implement
 * `callStream` (e.g. Ollama). Throws if every streaming-capable model fails.
 */
export async function dispatchVendorStream(params: DispatchParams): Promise<StreamDispatchResult> {
  const { env, modelChain, ...rest } = params;
  if (modelChain.length === 0) {
    throw new Error('dispatchVendorStream: modelChain is empty');
  }

  const attempts: DispatchAttempt[] = [];
  const skippedNoKey: string[] = [];
  const skippedNoStream: string[] = [];

  for (const model of modelChain) {
    const { vendorId, vendorModel } = resolveVendorAndModel(model);
    const mod = MODULES_BY_ID[vendorId];
    if (!mod.callStream) {
      skippedNoStream.push(`${vendorId}:${model}`);
      continue;
    }
    const apiKey = mod.apiKeyFrom(env);
    if (!apiKey) {
      skippedNoKey.push(`${vendorId}:${model}`);
      continue;
    }

    try {
      const result = await mod.callStream({ ...rest, apiKey, model: vendorModel });
      return { ...result, modelUsed: model, vendorUsed: vendorId, attempts };
    } catch (err) {
      if (err instanceof VendorRetryableError) {
        attempts.push({ model, vendor: vendorId, status: err.status, error: err.message });
        console.warn(
          `[vendors] stream ${vendorId}/${model} returned ${err.status}; trying next in chain (${attempts.length}/${modelChain.length} failed)`,
        );
        continue;
      }
      throw err;
    }
  }

  throw new CascadeExhaustedError('stream', attempts, skippedNoKey, skippedNoStream);
}
