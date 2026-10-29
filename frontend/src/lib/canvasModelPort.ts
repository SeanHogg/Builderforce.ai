import {
  RepetitionLoopError,
  providerFailureEvent,
  providerFailureTrace,
  streamSummaryCompletion,
  turnInterruption,
  type streamChatCompletion,
} from '@seanhogg/builderforce-brain-embedded';
import type { ModelCompletion, ModelRequest, ModelTransport, ModelTransportFailure, ModelUsage, TransportFailure } from '@builderforce/agent-run';
import {
  CANVAS_BUILD_RESPONSE_TOKENS,
  CANVAS_RESPONSE_TOKENS,
  CANVAS_STREAM_IDLE_MS,
  canvasTurnShape,
} from '@/lib/canvasAiTurnBudget';
import type { CanvasRun } from '@/lib/canvasAiRun';
import { servedOnDevice } from '@builderforce/local-inference';
import { cachedModelWindow } from '@/lib/llmModelWindow';
import { toChatMessages } from '@/lib/canvasRunMessages';

/** The gateway's usage report as the agent's `ModelUsage` (prompt/completion → input/output). */
function modelUsageOf(usage: NonNullable<CanvasTurn['usage']>): ModelUsage {
  return {
    ...(usage.prompt !== undefined ? { inputTokens: usage.prompt } : {}),
    ...(usage.completion !== undefined ? { outputTokens: usage.completion } : {}),
    ...(usage.cacheRead !== undefined ? { cacheReadTokens: usage.cacheRead } : {}),
  };
}

/** The turn's usage as the agent reads it: what the gateway reported plus a cost only when it is KNOWN. Absent when neither. */
function turnUsage(result: CanvasTurn, requested: string | undefined): { usage?: ModelUsage } {
  const cost = knownTurnCost(result, requested);
  if (!result.usage && cost.costMc === undefined) return {};
  return { usage: { ...(result.usage ? modelUsageOf(result.usage) : {}), ...cost } };
}

/**
 * What a turn cost, as far as this transport KNOWS it. The gateway reports no per-turn cost here, so
 * the answer is unknown (nothing returned) — except for a turn the on-device model served: that cost
 * nothing, which is a fact (a priced zero), not an unreported cost.
 */
function knownTurnCost(result: CanvasTurn, requested: string | undefined): Pick<ModelUsage, 'costMc'> {
  return servedOnDevice(result, requested) ? { costMc: 0 } : {};
}

/** The summary's ceiling when the policy names none — the summary request's own bound. */
const DEFAULT_SUMMARY_TOKENS = 700;

/** One canvas round-trip's completion, as the stream returns it. */
type CanvasTurn = Awaited<ReturnType<typeof streamChatCompletion>>;

/**
 * A provider failure the model policy routes around: the stream threw an error this
 * transport classified (`providerFailureEvent`), carried in the shape `@builderforce/
 * agent-run` reads. The vendor's own sentence stays the message — a trace, never the
 * user's answer.
 */
class CanvasTransportFailure extends Error implements ModelTransportFailure {
  constructor(message: string, readonly failure: TransportFailure) {
    super(message);
    this.name = 'CanvasTransportFailure';
  }
}

/**
 * Classify a stream error. A provider/transport failure becomes a typed
 * {@link CanvasTransportFailure} for the policy to route around; anything else (a refusal,
 * a user Stop) is the turn's own failure, remembered so the runner surfaces it as it is.
 */
function classifyStreamError(run: CanvasRun, error: unknown, askedModel: string | undefined, step: number): unknown {
  const event = providerFailureEvent(error);
  if (!event) {
    run.fatal = error;
    return error;
  }
  // Built field by field, with the policy's own types: the agent routes on exactly this.
  const failure: TransportFailure = {
    type: 'transport_failed',
    kind: event.kind,
    ...('model' in event && event.model ? { model: event.model } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
  };
  run.throwIfStopped();
  run.providerFailures += 1;
  run.options.onTrace?.(providerFailureTrace(new Date().toISOString(), step, failure.model ?? askedModel, error));
  run.finalText = '';
  // A model that LOOPED still said something real before it did: held for the end, when
  // no other model could take over.
  if (error instanceof RepetitionLoopError) run.loopKept = error.kept;
  run.options.onText?.('');
  return new CanvasTransportFailure((error as Error).message, failure);
}

/**
 * The canvas's MODEL transport — one round-trip on the Brain's own stream (so an unpinned,
 * tool-free turn may be served on the browser's model first), nothing more. WHAT to ask is
 * the agent's: the role, the model and how strictly, the models routed around and the tools
 * advertised arrive on the request, chosen by the model and tools policies. This adds only
 * what the canvas owns about a wire request — the response ceiling the composer's Effort
 * sets (and the build ceiling once a turn is writing an app), the stream's silence budget,
 * the arc stage, the guest-turn metadata — and reports each completion for diagnostics.
 */
export function canvasModelTransport(run: CanvasRun): ModelTransport {
  const { options, stream, guestTurnId } = run;
  let completions = 0;
  return {
    // The window the page already knows (the gateway catalog's rows, the on-device runtime
    // catalog) — the agent sizes its result cap and its compaction from it. Unknown ⇒ undefined.
    window: (model: string) => cachedModelWindow(model),
    /**
     * The compaction summarizer's call: a summary is not a turn. It reuses the Brain's ONE
     * summary completion (`streamSummaryCompletion` — no tools, reasoning off, think-tags
     * stripped) over the same stream, and touches NOTHING a person watches or the run
     * counts: no streamed text, no provenance row, no completion counter, no failure ledger,
     * no kept-loop text. A failure simply throws; the policy falls back to its recall note.
     */
    async summarize(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const user = request.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
      const note = await streamSummaryCompletion(
        (opts) => stream({
          ...opts,
          idleTimeoutMs: CANVAS_STREAM_IDLE_MS,
          routingMode: options.routingMode,
          // The run's pin keeps its strictness, and the models it routes around stay out of the summary too.
          modelStrict: request.model ? request.strict : undefined,
          ...(request.excludeModels && request.excludeModels.length > 0 ? { excludeModels: [...request.excludeModels] } : {}),
          metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
        }),
        request.model,
      )({ system, user, maxTokens: request.maxTokens ?? DEFAULT_SUMMARY_TOKENS, signal: signal ?? options.signal });
      // No note is a failed summary, not an empty one: it takes the failure path, so the policy
      // falls back to its recall note instead of folding a blank "memory" into the transcript.
      if (!note) throw new Error('The summary model returned no note.');
      return { content: note };
    },
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const step = completions;
      completions += 1;
      run.finalText = '';
      let result: CanvasTurn;
      try {
        result = await stream({
          // THE stream client's silence rule (no headers, or no bytes, for this long)
          // at the canvas's own budget — there is no second watchdog.
          idleTimeoutMs: CANVAS_STREAM_IDLE_MS,
          signal: signal ?? options.signal,
          messages: toChatMessages(request.messages),
          tools: request.tools ?? [],
          tool_choice: 'auto',
          ...canvasTurnShape(run.workspaceTurn || run.truncatedOnce ? CANVAS_BUILD_RESPONSE_TOKENS : CANVAS_RESPONSE_TOKENS, options.runShaping),
          model: request.model,
          modelStrict: request.model ? request.strict : undefined,
          role: request.role,
          ...(options.arcStage ? { arcStage: options.arcStage } : {}),
          routingMode: options.routingMode,
          ...(request.excludeModels && request.excludeModels.length > 0 ? { excludeModels: [...request.excludeModels] } : {}),
          metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
        }, { onTextDelta: (delta) => { run.finalText += delta; options.onText?.(run.finalText); } });
      } catch (error) {
        throw classifyStreamError(run, error, request.model, step);
      }
      run.throwIfStopped();
      options.onCompletion?.({
        at: new Date().toISOString(), iteration: step + 1,
        requestedModel: request.model ?? null,
        resolvedModel: result.resolvedModel ?? null,
        resolvedVendor: result.resolvedVendor ?? null,
        account: result.account ?? null,
        // Absent = the account's funding order applied (an unpicked turn sends no routingMode).
        routingMode: options.routingMode ?? 'account',
        toolsAdvertised: request.tools?.length ?? 0,
        toolCalls: result.toolCalls.map((call) => call.name),
        finishReason: result.finishReason,
      });
      run.lastFinishReason = result.finishReason;
      // A completion arrived: whatever a looping model said before is no longer the tail.
      run.loopKept = '';
      // The calls about to run own the turn; what the model said around them is not an answer.
      if (result.toolCalls.length > 0) run.finalText = '';
      const interrupted = turnInterruption(result.finishReason);
      return {
        content: result.text,
        toolCalls: result.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
        ...(result.resolvedModel ? { model: result.resolvedModel } : {}),
        // What the gateway reported, in the agent's words: the run's tally sums these into the
        // §8.2 row's tokens and cache reads, and — for a turn the on-device model served — a known cost of 0.
        ...turnUsage(result, request.model),
        ...(interrupted ? { interrupted } : {}),
      };
    },
  };
}
