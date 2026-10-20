import {
  selectToolsForTurn,
  turnInterruption,
  type ChatCompletionMessage,
  type streamChatCompletion,
} from '@seanhogg/builderforce-brain-embedded';
import type { LoopPorts } from '@builderforce/agent-loop';
import { nextTurn } from '@builderforce/run-policy';
import { NON_AUTHORING_TOOL_NAMES } from '@/lib/canvasTurnOutcome';
import {
  CANVAS_BUILD_RESPONSE_TOKENS,
  CANVAS_RESPONSE_TOKENS,
  CANVAS_STREAM_IDLE_MS,
  CANVAS_TOOL_LIMIT,
  canvasTurnShape,
} from '@/lib/canvasAiTurnBudget';
import { specsFor } from '@/lib/canvasAiToolExecution';
import { reportToPolicy, type CanvasRun } from '@/lib/canvasAiRun';
import { recoverFromProviderFailure } from '@/lib/canvasProviderRecovery';

/** One canvas round-trip's completion, as the stream returns it. */
export type CanvasTurn = Awaited<ReturnType<typeof streamChatCompletion>>;

/**
 * The canvas loop's MODEL port — one round-trip: the reserved authoring phase, the
 * relevance-selected tool menu, the request the run policy asks for, the recovery when
 * the provider breaks under it, and the completion diagnostics.
 */
export function canvasModelPort(run: CanvasRun): LoopPorts<ChatCompletionMessage>['complete'] {
  const { options, messages, actions, mutationRequested, toolsUsedThisTurn, requiredTools, stream, guestTurnId } = run;
  return async (ctx) => {
    const turn = ctx.step;
    // The authoring phase arms once the model has IGNORED an explicit act-now directive
    // (a prose recovery spent): research and re-reads withdrawn, authoring tools only.
    // There is no step-count trigger — the canvas loop runs without a step cap.
    run.authoringOnly = mutationRequested && !run.canvasChanged && run.mutationRecoveries > 0;
    if (run.authoringOnly && !run.authoringDirectiveIssued) {
      run.authoringDirectiveIssued = true;
      messages.push({
        role: 'system',
        content: 'The research phase is over. Use the remaining turns only to create or update the requested Canvas artifacts with canvas_* tools. Build from what you already have — you have the board snapshot and do not need to read it again — state any evidence gap inside the artifact, and do not make another search or fetch call.',
      });
    }
    const availableActions = run.authoringOnly
      ? actions.filter((action) => !NON_AUTHORING_TOOL_NAMES.has(action.name))
      : actions;
    // Per-turn selection (see CANVAS_TOOL_LIMIT). The query is the user's request
    // plus the latest exchange, so a follow-up ("now add a budget screen") still
    // scores the tools its wording names.
    const recent = (options.conversation ?? []).slice(-2).map((message) => message.content).join('\n');
    const selection = selectToolsForTurn(specsFor(availableActions), {
      query: `${options.prompt}\n${recent}`,
      limit: CANVAS_TOOL_LIMIT,
      pinned: toolsUsedThisTurn,
      required: requiredTools,
    });
    // What this round-trip asks for: the role (analysis until the turn starts
    // building an app, then code), the model and how strictly, and the exclusions.
    const ask = nextTurn(run.policy, { hasTools: selection.tools.length > 0 });
    let result: CanvasTurn;
    try {
      result = await stream({
        // THE stream client's silence rule (no headers, or no bytes, for this long)
        // at the canvas's own budget — there is no second watchdog.
        idleTimeoutMs: CANVAS_STREAM_IDLE_MS,
        signal: options.signal,
        messages,
        tools: selection.tools,
        tool_choice: 'auto',
        ...canvasTurnShape(run.workspaceTurn || run.truncatedOnce ? CANVAS_BUILD_RESPONSE_TOKENS : CANVAS_RESPONSE_TOKENS, options.runShaping),
        model: ask.model,
        modelStrict: ask.model ? ask.strict : undefined,
        role: ask.role,
        ...(options.arcStage ? { arcStage: options.arcStage } : {}),
        routingMode: options.routingMode,
        ...(ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}),
        metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
      }, { onTextDelta: (delta) => { run.finalText += delta; options.onText?.(run.finalText); } });
    } catch (error) {
      return recoverFromProviderFailure(run, error, ask.model, turn);
    }
    run.throwIfStopped();
    options.onCompletion?.({
      at: new Date().toISOString(), iteration: turn + 1,
      requestedModel: ask.model ?? null,
      resolvedModel: result.resolvedModel ?? null,
      resolvedVendor: result.resolvedVendor ?? null,
      account: result.account ?? null,
      routingMode: options.routingMode ?? 'auto',
      toolsAdvertised: selection.tools.length,
      toolCalls: result.toolCalls.map((call) => call.name),
      finishReason: result.finishReason,
    });
    run.lastTurnInterruption = turnInterruption(result.finishReason);
    reportToPolicy(run, {
      type: 'turn_succeeded',
      ...(result.resolvedModel ? { model: result.resolvedModel } : {}),
      acted: result.toolCalls.length > 0,
    });
    return {
      content: result.text,
      toolCalls: result.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
      meta: result,
    };
  };
}
