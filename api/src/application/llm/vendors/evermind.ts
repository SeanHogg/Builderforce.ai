/**
 * Evermind vendor — the gateway's OWN generation backend.
 *
 * Unlike every other vendor (which POSTs to an external `/chat/completions`),
 * this one runs in-process: it loads a tenant's published `.evermind` artifact
 * from R2 and runs the builderforce-memory EvermindLM on-CPU inside the Worker.
 * This is what turns "use our own LLM" from aspiration into routed traffic — a
 * request pinned to `evermind/<ref>` is served by Evermind, not Claude/GPT.
 *
 * Reached ONLY via an explicit `evermind/<ref>` pin (autoRoute:false), so it
 * never silently joins the FREE/PRO failover pools. The publish flow points a
 * tenant model's base at `evermind/<ref>`; the gateway hard-pins it.
 *
 * The heavy lifting (load, generate, response shape) lives in the shared
 * ../evermindRuntime so the Studio test endpoint and this vendor stay DRY.
 */

import {
  VendorFatalError,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModule,
} from './types';
import { evermindGenerate, buildEvermindCompletion } from '../evermindRuntime';

export const evermindModule: VendorModule = {
  id: 'evermind',
  // Dynamic per-tenant models — not a static catalog. Reached via explicit pin.
  catalog: [],
  // Never auto-selected into the FREE/PRO failover pools.
  autoRoute: false,
  // No external key. A non-empty sentinel makes the gateway's key-bound gate pass
  // (the "key" is local compute, not a credential).
  apiKeyFrom: () => 'local',
  tierFor: (): AiModelTier => 'STANDARD',

  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const store = params.uploads;
    if (!store) {
      // The dispatch path didn't thread the R2 binding — a server misconfig, not
      // a retryable upstream error. Surface it as fatal (no cooldown, no failover).
      throw new VendorFatalError('evermind', 500, 'R2 artifact store not bound; cannot load .evermind model');
    }
    // `params.model` has already had the `evermind/` prefix stripped by dispatch,
    // leaving the R2 ref of the published artifact.
    const ref = params.model;
    const gen = await evermindGenerate(store, ref, params.messages, {
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    return {
      raw: buildEvermindCompletion(gen, `evermind/${ref}`),
      content: gen.content,
      usage: gen.usage,
    };
  },
};
