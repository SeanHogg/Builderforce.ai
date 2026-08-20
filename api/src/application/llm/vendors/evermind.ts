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
 *
 * TOOL CALLING is real here, via constrained decoding (../evermindToolCall): the JSON
 * is assembled from the tool's own schema and the head is consulted only for the
 * leaves — which tool (a scored vote), which enum, what string. Structural validity is
 * therefore guaranteed by construction. This vendor used to refuse tools outright on
 * the grounds that "the SSM has no function-calling", which conflated the ARCHITECTURE
 * with the DECODING STRATEGY: a raw-text head absolutely can emit a well-formed call
 * when it is never asked to spell the punctuation.
 *
 * Two contracts it still REFUSES rather than fakes, because silently doing the wrong
 * thing is worse than an error the caller can route around:
 *   - a GUESSED tool call (the head scored its top choice no better than the runner-up,
 *     so the call is structurally perfect and semantically a coin flip), and
 *   - incoherent output (an under-trained head must not answer a user in gibberish).
 * Both throw a 400 `VendorFatalError`, which the registry treats as "try the next
 * candidate": a soft pin cascades to a real model, a hard pin surfaces the reason.
 */

import {
  VendorFatalError,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorStreamResult,
  type VendorModule,
} from './types';
import { evermindGenerate, evermindGenerateWithTools, buildEvermindCompletion } from '../evermindRuntime';
import { isServableText } from '../textCoherence';
import {
  normalizeEvermindTools,
  resolveEvermindToolChoice,
  evermindToolChoiceMinMargin,
  logToolChoiceMargin,
} from '../evermindToolCall';
import { pseudoStreamFromCall } from './pseudoStream';

/**
 * Coherence gate on the RAW PIN. This vendor used to return whatever the head
 * produced, unfiltered — the gate + auto-quarantine only existed on the opt-in
 * project-serve path, so a deliberate `evermind/<ref>` pin was the one door through
 * which an under-trained head could still answer a user in gibberish. It is now
 * closed: a degraded head refuses rather than serves, on EVERY path — which since
 * tool calling landed means BOTH prose exits (the tool-less turn and the `auto` turn
 * where the head chose to answer instead of calling), hence the shared helper.
 *
 * 400 (not 500) because that is what the registry's `dispatchInternal` treats as
 * "this candidate can't do it — try the next": a SOFT pin therefore cascades to a
 * real model, while a HARD pin (`modelStrict`) surfaces this explanation instead of
 * gibberish. The last user message is passed as context so a jargon-dense but
 * legitimate answer isn't mis-accused.
 */
function assertServable(content: string, messages: Array<Record<string, unknown>>): void {
  const lastUser = [...messages].reverse().find((m) => m['role'] === 'user');
  const context = typeof lastUser?.['content'] === 'string' ? (lastUser['content'] as string) : undefined;
  const verdict = isServableText(content, { ...(context ? { context } : {}) });
  if (verdict.coherent) return;
  throw new VendorFatalError(
    'evermind',
    400,
    `Evermind produced incoherent output and refused to serve it: ${verdict.detail}. `
    + 'Retrain or re-seed this model past the coherence bar (Project Evermind → Test bench), '
    + 'or run this request on a different model.',
  );
}

export const evermindModule: VendorModule = {
  id: 'evermind',
  // Dynamic per-tenant models — not a static catalog. Reached via explicit pin.
  catalog: [],
  // Never auto-selected into the FREE/PRO failover pools.
  autoRoute: false,
  // Evermind CAN tool-call: `../evermindToolCall` assembles the JSON from the tool's
  // schema and samples only the leaves, so a raw-text head still emits a well-formed
  // `tool_calls`. Declared true (the one place callers read via `modelSupportsTools`)
  // so a tool-driven run may legitimately be pinned here. Whether a PARTICULAR head is
  // good enough to drive that run is a per-request measurement, not a static flag —
  // see the confidence gate in `call`.
  supportsTools: true,
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

    // ── Tool-bearing request ────────────────────────────────────────────────
    // Served, not refused. The head picks the tool and fills the arguments; the
    // JSON structure comes from the schema, so what comes back is always a
    // well-formed call rather than narration about one.
    const tools = normalizeEvermindTools(params.tools);
    const choice = resolveEvermindToolChoice(params.toolChoice, tools);
    if (tools.length > 0 && choice.mode !== 'none') {
      const planned = await evermindGenerateWithTools(store, ref, params.messages, tools, choice, {
        maxTokens: params.maxTokens,
        temperature: params.temperature,
      });
      if (planned.call) {
        // CONFIDENCE GATE. A structurally valid call chosen at random is the exact
        // failure the old blanket refusal was protecting against — an agent loop
        // that edits files for no reason is worse than one that cascades to a real
        // model. `margin` is the separation between the winning candidate and the
        // runner-up across the whole plan (tool vote AND every scored argument); at
        // ~0 the head has no preference and is guessing. 400 so a soft pin cascades
        // and a hard pin surfaces the reason, matching the coherence gate below.
        const bar = params.toolChoiceMinMargin ?? evermindToolChoiceMinMargin();
        const refused = planned.margin < bar;
        // Log EVERY decision, not just the refusals — the bar can only be calibrated
        // against the separation between the margins that were right and the ones
        // that were wrong, and refusals alone are half that picture.
        logToolChoiceMargin({ margin: planned.margin, bar, tool: planned.call.name, candidates: tools.length, refused });
        if (refused) {
          throw new VendorFatalError(
            'evermind',
            400,
            `Evermind refused a guessed tool call: it ranked "${planned.call.name}" no higher than the alternatives `
            + `(margin ${planned.margin.toFixed(4)} < ${bar}). This head is not trained enough to choose `
            + 'tools reliably — run tool-driven work on a tool-capable model (the project Evermind still learns from the run).',
          );
        }
        // The call rides in `raw` (the OpenAI completion), exactly as every HTTP
        // vendor returns it — there is no separate tool-call channel on
        // `VendorCallResult`, and inventing one here would break the shared readers.
        return {
          raw: buildEvermindCompletion({ content: '', usage: planned.usage }, `evermind/${ref}`, Date.now(), planned.call),
          content: '',
          usage: planned.usage,
        };
      }
      // `auto` and the head chose prose: fall through to the SAME coherence gate a
      // tool-less turn gets, rather than returning ungated text on the tools path.
      assertServable(planned.content, params.messages);
      return {
        raw: buildEvermindCompletion({ content: planned.content, usage: planned.usage }, `evermind/${ref}`),
        content: planned.content,
        usage: planned.usage,
      };
    }

    const gen = await evermindGenerate(store, ref, params.messages, {
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    assertServable(gen.content, params.messages);
    return {
      raw: buildEvermindCompletion(gen, `evermind/${ref}`),
      content: gen.content,
      usage: gen.usage,
    };
  },

  /**
   * Streaming turns reach Evermind too.
   *
   * Streaming dispatch SKIPS any vendor without `callStream`, so before this a
   * streaming surface silently served a different model than the one pinned to the
   * project — and the pin behaved differently depending on whether the caller asked
   * for a stream. The generation is synchronous CPU with no token-by-token channel to
   * expose, so the honest shape is the completed call replayed through the SAME
   * `pseudoStream` adapter the Responses vendors use, rather than a hand-rolled
   * replay that would drop `usage` and `model` the way those did.
   */
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return pseudoStreamFromCall(await evermindModule.call(params), params);
  },
};
