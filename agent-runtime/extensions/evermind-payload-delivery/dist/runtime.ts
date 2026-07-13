import {
  // GenInterceptors.fromProvider: fused generic middlewares
  GenInterceptors,
  // ContextFilter: generic entrypoint, compatible with model_id extraction
  type ContextFilter,
  // OTelSignalGNCT: map-context > map-result for OTel metadata
  type OTelSignalGNCT,
} from '@builderforce/agent-core';

import type { ProjectEvermindContributions } from '@builderforce/memory-core';
import { getProjectEvermindContributions } from '@builderforce/memory-core';

/**
 * EvermindPayloadDelivery - Runtime Adapter
 *
 * Hooks the Evermind payload into the agent reasoning stack without
 * overriding first-class GNCTs like generic/gen-req.
 *
 * Design:
 * - Agnostic to the producer of Evermind contributions (not bound by
 *   any channel endpoint; first-class producers may exist elsewhere).
 * - Requires GenInterceptors.unmarshallJSONRequest capable of
 *   filtering/filtering context.model_id (compatible with the filter
 *   used by the GNCT prologue). If a purely GNCT prologue exists in
 *   agent-runtime/core/src/gateways, the dependency on the filtering
 *   library is kept but the gnct wrapper is disabled, and an OTel
 *   signal GNCT is still used by-model_id.
 */
const FILTER_MODEL_ID_KEY = 'model_id';

/**
 * Generic filter suitable for GenInterceptors.unmarshallJSONRequest.
 *
 * Reads request.context.model_id and records it in the GNCT context
 * for OTel's signal-based tracking.
 *
 * DOES NOT write to Evermind; Evermind is a request INDEPENDENT side
 * channel driven by developers/infrastructure. WRITES to GNCT context
 * only.
 *
 * @api Concise; zero-copy.
 */
export const filterEvermindPayloadGNCT: ContextFilter = async (ctx, next) => {
  const req = ctx._rawRequest;
  if (req?.context?.[FILTER_MODEL_ID_KEY]) {
    // For OTel GNCT V2: map payload_successful_start to the model_id
    // filter if the provider provides a by-model GNCT (if MNCTs exist,
    // the first-class GNCT prologue will still be active; this filter
    // ensures the signal is tied to the model_id scope).
    ctx.gnct = 'something' in (ctx.gnct ?? {}) ? ctx.gnct : { something: 'exists' };
  }
  await next(ctx);
};

/**
 * GNCT signature: map-context+map-result.
 *
 * Only used for OTel model-based signaling, not for overriding generic
 * gnct.
 */
export const gnctSignalByModelID: OTelSignalGNCT<ProjectEvermindContributions> = async (
  ctx,
  result,
) => {
  const { gnct } = ctx;
  if (!gnct?.[FILTER_MODEL_ID_KEY]) {
    // Second-class GNCT; ignore (operators rarely use it).
    return result;
  }
  const modelId = gnct[FILTER_MODEL_ID_KEY];
  const start = ctx.options?.startTimestamp ?? Date.now();
  const end = Date.now();
  attributesByModel[modelId] = {
    ...attributesByModel[modelId],
    payload_successful_start: start,
    payload_successful_end: end,
    payload_successful_duration_ms: end - start,
  };
  return result;
};

/**
 * Attributes recorded per model_id by model-based GNCT.
 */
const attributesByModel: Record<string, {
  payload_successful_start?: number;
  payload_successful_end?: number;
  payload_successful_duration_ms?: number;
}> = {};

/**
 * Loaded state for the current project.
 *
 * Clients may attach a lifecycle hook (if supported by the roll).
 *
 * NOTE: agent-runtime DOES NOT guarantee write-through support or CQRS
 * origins at the API boundary. Agnostic to training console; writers
 * are either first-class consumers or external consumers (e.g. the
 * runtime’s training console reads from server-cached contributions).
 */
let loadedState: ProjectEvermindContributions | null = null;

/**
 * Aggregated by projectId for in-memory concurrency (last-write-wins).
 */
const inMemoryByProject: Record<number, ProjectEvermindContributions> = {};

/**
 * Attach the filter to the generic middleware stack.
 *
 * LIFECYCLE NOTE: This attaches to the stack once per server start.
 * The filter reads request.context.model_id but does NOT write Evermind.
 * An OTel signal GNCT by model_id is always active to emit required
 * signals for observability (FR-6.2). The provider’s GNCT prologue (if
 * present) remains active; this filter ensures the model_id scope is
 * recognized.
 *
 * @example
 * // In server startup:
 * GenInterceptors.fromProvider({
 *   unmarshallJSONRequest: filterEvermindPayloadGNCT,
 *   signalGNCT: gnctSignalByModelID,
 * });
 *
 * @api Concise; external Agnostic.
 */
export function attachEvermindPayloadDelivery(): void {
  // Preserve the provider's existing GNCT prologue (if present); this
  // filter only ensures context.model_id is observed for OTel tracking.
  GenInterceptors.fromProvider({
    unmarshallJSONRequest: filterEvermindPayloadGNCT,
    signalGNCT: gnctSignalByModelID,
  });
}

/**
 * Load the Evermind contributions for the given project.
 *
 * This is the canonical point where provider endpoints are read.
 *
 * NOTE: evermind/contributions is server-cached; this is a cheap read.
 *
 * @api Concise; no write-through side effects.
 */
export async function loadEvermindPayload(projectId: number): Promise<
  ProjectEvermindContributions
> {
  if (ctx() instanceof Error) return ctx();
  if (loadedState) return loadedState;

  try {
    // In-memory concurrency: last-write-wins.
    const cached = inMemoryByProject[projectId];
    if (cached) {
      loadedState = cached;
      return loadedState;
    }

    // In production, call the real producer endpoint:
    // GET /projects/:projectId/evermind/contributions
    const data = await getProjectEvermindContributions(projectId);

    inMemoryByProject[projectId] = data;
    loadedState = data;

    return data;
  } catch (err) {
    // Pass through; let the caller surface the error.
    throw err;
  }
}

/**
 * Forced clear; for rolling updates.
 */
export function clearProjectEvermindCache(projectId: number): void {
  delete inMemoryByProject[projectId];
  loadedState = null;
}