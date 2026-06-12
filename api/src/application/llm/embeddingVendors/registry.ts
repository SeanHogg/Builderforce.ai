/**
 * Embeddings-vendor registry — single source of truth for which vendor owns
 * which embedding model and how to walk the failover cascade. Mirrors the chat
 * `vendors/registry.ts` and image `imageVendors/registry.ts` shapes so future
 * shared tooling (admin UI, health probes) can iterate all three surfaces
 * uniformly.
 *
 * Adding a new embeddings vendor: add to `MODULES` below and the registry
 * derives the rest.
 */

import { openRouterEmbeddingModule } from './openrouter';
import { voyageEmbeddingModule } from './voyage';
import {
  VendorRetryableError,
  type EmbeddingGenParams,
  type EmbeddingGenResult,
  type EmbeddingVendorEnv,
  type EmbeddingVendorId,
  type EmbeddingVendorModelEntry,
  type EmbeddingVendorModule,
} from './types';

/**
 * Vendor priority — OpenRouter primary (broadest model coverage incl. the free
 * Nemotron default), Voyage failover. This is the order the dispatcher walks
 * the cascade when no caller-pinned, vendor-prefixed model forces a vendor.
 */
const MODULES: ReadonlyArray<EmbeddingVendorModule> = [openRouterEmbeddingModule, voyageEmbeddingModule];

/** First vendor in priority order — the cascade's primary and the fallback
 *  primary when a bare/unknown model id can't be attributed to a vendor. */
const PRIMARY_VENDOR: EmbeddingVendorId = openRouterEmbeddingModule.id;

const MODULES_BY_ID: Record<EmbeddingVendorId, EmbeddingVendorModule> = {
  openrouter: openRouterEmbeddingModule,
  voyage:     voyageEmbeddingModule,
};

const INDEX: Map<string, { vendor: EmbeddingVendorId; entry: EmbeddingVendorModelEntry }> = new Map();
for (const mod of MODULES) {
  for (const entry of mod.catalog) {
    INDEX.set(entry.id, { vendor: mod.id, entry });
  }
}

const VENDOR_PREFIXES: ReadonlyArray<{ prefix: string; vendor: EmbeddingVendorId }> = [
  { prefix: 'openrouter/', vendor: 'openrouter' },
  { prefix: 'voyage/',     vendor: 'voyage' },
];

/**
 * Parse an explicit vendor-prefixed model id (`voyage/voyage-3-lite`). Returns
 * `null` for bare ids — the dispatcher then runs the full cascade and lets each
 * vendor pick its own model. NOTE: OpenRouter model ids are themselves slash-
 * namespaced (`openai/text-embedding-3-small`), so we only treat the literal
 * `openrouter/` / `voyage/` prefixes as vendor selectors.
 */
export function parseEmbeddingVendorPrefix(modelId: string): { vendor: EmbeddingVendorId; modelId: string } | null {
  for (const { prefix, vendor } of VENDOR_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      return { vendor, modelId: modelId.slice(prefix.length) };
    }
  }
  return null;
}

export function embeddingVendorKeyBound(env: EmbeddingVendorEnv, vendor: EmbeddingVendorId): boolean {
  return !!MODULES_BY_ID[vendor].apiKeyFrom(env);
}

export function getEmbeddingModule(id: EmbeddingVendorId): EmbeddingVendorModule {
  return MODULES_BY_ID[id];
}

export function getEmbeddingCatalog(): ReadonlyArray<EmbeddingVendorModelEntry & { vendor: EmbeddingVendorId }> {
  return MODULES.flatMap((mod) => mod.catalog.map((entry) => ({ ...entry, vendor: mod.id })));
}

// ---------------------------------------------------------------------------
// Dispatch — walk the embeddings vendor cascade with failover
// ---------------------------------------------------------------------------

type EmbeddingDispatchBody = Omit<EmbeddingGenParams, 'apiKey' | 'model'>;

export interface EmbeddingDispatchAttempt {
  vendor: EmbeddingVendorId;
  model: string;
  status: number;
  error: string;
}

/**
 * Thrown when every vendor in the embeddings cascade fails. Carries the
 * structured `attempts[]` so the route can surface per-vendor failure detail
 * in the error envelope.
 */
export class EmbeddingCascadeExhaustedError extends Error {
  public readonly attempts: ReadonlyArray<EmbeddingDispatchAttempt>;
  public readonly skippedNoKey: ReadonlyArray<string>;
  constructor(
    attempts: ReadonlyArray<EmbeddingDispatchAttempt>,
    skippedNoKey: ReadonlyArray<string>,
  ) {
    const summary = attempts.map((a) => `${a.vendor}/${a.model}=${a.status}`).join(', ');
    const noKey = skippedNoKey.length > 0 ? ` (skipped no-key: ${skippedNoKey.join(', ')})` : '';
    super(`Embeddings vendor cascade exhausted (${attempts.length} attempts: ${summary})${noKey}`);
    this.name = 'EmbeddingCascadeExhaustedError';
    this.attempts = attempts;
    this.skippedNoKey = skippedNoKey;
  }
}

export interface EmbeddingDispatchParams extends EmbeddingDispatchBody {
  env: EmbeddingVendorEnv;
  /** Caller-pinned model id (may be vendor-prefixed). When omitted, each vendor
   *  in the cascade uses its own `defaultModel`. */
  model?: string;
}

export interface EmbeddingDispatchResult extends EmbeddingGenResult {
  vendorUsed: EmbeddingVendorId;
  attempts: EmbeddingDispatchAttempt[];
}

/**
 * Build the ordered list of `{ vendor, model }` candidates for a dispatch.
 *
 *   - A `voyage/`- or `openrouter/`-prefixed model PINS that vendor (no failover
 *     to other vendors — the caller explicitly chose one).
 *   - A bare model id that belongs to a known vendor's catalog routes to that
 *     vendor first, then the remaining vendors use their own `defaultModel`.
 *   - No model (or an unknown bare id) → full cascade, each vendor on its
 *     `defaultModel` (with the unknown id passed through to the primary so
 *     a still-valid OpenRouter model the catalog doesn't list keeps working).
 *
 * Exported for unit testing the candidate-resolution logic in isolation.
 */
export function resolveEmbeddingCandidates(model?: string): Array<{ vendor: EmbeddingVendorId; model: string }> {
  const prefix = model ? parseEmbeddingVendorPrefix(model) : null;
  if (prefix) {
    // Explicit vendor pin — single vendor, no cross-vendor failover.
    const mod = MODULES_BY_ID[prefix.vendor];
    return [{ vendor: prefix.vendor, model: prefix.modelId || mod.defaultModel }];
  }

  const known = model ? INDEX.get(model) : undefined;
  const primaryVendor = known?.vendor ?? PRIMARY_VENDOR;

  const ordered: Array<{ vendor: EmbeddingVendorId; model: string }> = [];
  // Primary vendor uses the pinned model when given, else its default.
  ordered.push({ vendor: primaryVendor, model: model ?? MODULES_BY_ID[primaryVendor].defaultModel });
  // Remaining vendors fail over on their own default model.
  for (const mod of MODULES) {
    if (mod.id === primaryVendor) continue;
    ordered.push({ vendor: mod.id, model: mod.defaultModel });
  }
  return ordered;
}

/**
 * Walk the embeddings cascade with failover. Tries OpenRouter first (or the
 * caller-pinned vendor), and on a retryable failure (outage, 5xx, rate limit,
 * auth, empty-200) advances to the next vendor that has a key bound. Throws
 * `EmbeddingCascadeExhaustedError` only when every candidate fails;
 * `VendorFatalError` (400 bad payload) bubbles immediately — failover won't help.
 */
export async function dispatchEmbeddingVendor(params: EmbeddingDispatchParams): Promise<EmbeddingDispatchResult> {
  const { env, model, ...rest } = params;
  const candidates = resolveEmbeddingCandidates(model);

  const attempts: EmbeddingDispatchAttempt[] = [];
  const skippedNoKey: string[] = [];

  for (const { vendor, model: candidateModel } of candidates) {
    const mod = MODULES_BY_ID[vendor];
    const apiKey = mod.apiKeyFrom(env);
    if (!apiKey) {
      skippedNoKey.push(`${vendor}:${candidateModel}`);
      continue;
    }

    try {
      const result = await mod.embed({ ...rest, apiKey, model: candidateModel });
      return { ...result, vendorUsed: vendor, attempts };
    } catch (err) {
      if (err instanceof VendorRetryableError) {
        attempts.push({ vendor, model: candidateModel, status: err.status, error: err.message });
        console.warn(
          `[embeddingVendors] ${vendor}/${candidateModel} returned ${err.status}; failing over (${attempts.length}/${candidates.length} failed)`,
        );
        continue;
      }
      throw err; // VendorFatalError bubbles
    }
  }

  throw new EmbeddingCascadeExhaustedError(attempts, skippedNoKey);
}
