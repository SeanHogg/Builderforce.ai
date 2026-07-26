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
import { isServableText } from '../textCoherence';

export const evermindModule: VendorModule = {
  id: 'evermind',
  // Dynamic per-tenant models — not a static catalog. Reached via explicit pin.
  catalog: [],
  // Never auto-selected into the FREE/PRO failover pools.
  autoRoute: false,
  // The SSM generates raw text — it has NO function-calling machinery and cannot
  // emit structured `tool_calls`. Declared here (the one place callers read via
  // `modelSupportsTools`) so no surface pins Evermind onto a tool-driven run.
  supportsTools: false,
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
    // Tool-bearing request: REFUSE rather than answer in prose. Ignoring `tools`
    // here is what let a pinned Evermind run an agent loop that could never call a
    // tool — every turn came back as narration ("I'll call builtin_…") while zero
    // work happened. A 400 `VendorFatalError` advances the cascade (registry
    // `dispatchInternal` treats 400/422 as "try the next candidate"), so a soft pin
    // lands on a tool-capable model; a HARD pin surfaces this message instead of
    // silently doing nothing. Callers should not get here — `modelSupportsTools`
    // is the up-front gate — so this is the backstop that makes the contract real.
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      throw new VendorFatalError(
        'evermind',
        400,
        'Evermind has no tool-calling: it generates text and cannot emit tool_calls. '
        + 'Run tool-driven work on a tool-capable model (the project Evermind still learns from the run).',
      );
    }
    // `params.model` has already had the `evermind/` prefix stripped by dispatch,
    // leaving the R2 ref of the published artifact.
    const ref = params.model;
    const gen = await evermindGenerate(store, ref, params.messages, {
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    // Coherence gate on the RAW PIN too. This vendor used to return whatever the head
    // produced, unfiltered — the gate + auto-quarantine only existed on the opt-in
    // project-serve path, so a deliberate `evermind/<ref>` pin was the one door through
    // which an under-trained head could still answer a user in gibberish. It is now
    // closed: a degraded head refuses rather than serves, on EVERY path.
    //
    // 400 (not 500) because that is what the registry's `dispatchInternal` treats as
    // "this candidate can't do it — try the next": a SOFT pin therefore cascades to a
    // real model, while a HARD pin (`modelStrict`) surfaces this explanation instead of
    // gibberish. The last user message is passed as context so a jargon-dense but
    // legitimate answer isn't mis-accused.
    const lastUser = [...params.messages].reverse().find((m) => m['role'] === 'user');
    const context = typeof lastUser?.['content'] === 'string' ? (lastUser['content'] as string) : undefined;
    const verdict = isServableText(gen.content, { ...(context ? { context } : {}) });
    if (!verdict.coherent) {
      throw new VendorFatalError(
        'evermind',
        400,
        `Evermind produced incoherent output and refused to serve it: ${verdict.detail}. `
        + 'Retrain or re-seed this model past the coherence bar (Project Evermind → Test bench), '
        + 'or run this request on a different model.',
      );
    }
    return {
      raw: buildEvermindCompletion(gen, `evermind/${ref}`),
      content: gen.content,
      usage: gen.usage,
    };
  },
};
