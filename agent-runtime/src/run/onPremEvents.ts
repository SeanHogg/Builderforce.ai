/**
 * The on-prem run's EVENT port: where a run's trace goes — the relay frames the portal
 * renders (a chat message per assistant turn, a tool-audit row per call, a steer
 * acknowledgement) and the uniform outcome row (PRD 35 §8.2).
 *
 * The agent's own `RunEvent` stream carries no text and no arguments (it is the trace
 * every entry point must match), so the frames the portal needs are read where the text
 * and arguments are: off the model transport's completions. Both halves feed the host's
 * {@link OnPremRunSinks}; neither decides anything.
 */

import type {
  EventSink,
  ModelCompletion,
  ModelTransport,
  RunEvent,
  RunOutcomeRow,
  SteeringSource,
} from "@builderforce/agent-run";

/** What the host (the relay) renders a run's progress with. */
export interface OnPremRunSinks {
  /** An assistant turn's text. */
  onAssistantText(text: string): void;
  /** A tool call the model made (live and durable). */
  onToolUse(toolName: string, toolUseId: string, args: unknown): void;
  /** A model turn that ended without a tool call — the run's answer so far. */
  onResult(ok: boolean, text: string, usage: { inputTokens: number; outputTokens: number }): void;
  /** A mid-run steer reached the model as the next user turn. */
  onSteerApplied?(text: string): void;
  /** The run's uniform outcome row (§8.2), written once at its end. */
  onOutcome?(row: RunOutcomeRow): void;
  /**
   * The observer of one SUB-AGENT of this run, tagged with the child's label. A child's
   * turns and calls go here and nowhere else — never to this run's chat. Absent ⇒ a child
   * reports nothing live.
   */
  forChild?(label: string): OnPremRunSinks;
}

/** The arguments of a call as the host shows them: parsed when they are JSON. */
function argsOf(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { raw, parseError: err instanceof Error ? err.message : String(err) };
  }
}

/** A transport that reports each completion to the sinks. The answer is passed through untouched. */
export function observedModel(inner: ModelTransport, sinks: OnPremRunSinks): ModelTransport {
  return {
    ...(inner.window ? { window: inner.window.bind(inner) } : {}),
    ...(inner.preflight ? { preflight: inner.preflight.bind(inner) } : {}),
    async complete(request, signal): Promise<ModelCompletion> {
      const completion = await inner.complete(request, signal);
      if (completion.content.trim()) sinks.onAssistantText(completion.content);
      const calls = completion.toolCalls ?? [];
      for (const call of calls) sinks.onToolUse(call.name, call.id, argsOf(call.arguments));
      if (calls.length === 0) {
        sinks.onResult(true, completion.content, {
          inputTokens: completion.usage?.inputTokens ?? 0,
          outputTokens: completion.usage?.outputTokens ?? 0,
        });
      }
      return completion;
    },
  };
}

/**
 * The steering port over the host's queue. The agent acknowledges a steer with a text-less
 * `steer.applied`; this port remembers the texts it handed over, in order, so the
 * acknowledgement the host renders carries the text the user sent.
 */
export function acknowledgedSteering(
  queue: { drain(): string[]; pending(): number; onPush(listener: () => void): () => void },
): { source: SteeringSource; takeApplied: () => string } {
  const handed: string[] = [];
  return {
    source: {
      drain: () => {
        const taken = queue.drain();
        handed.push(...taken);
        return taken;
      },
      // A portal steer cuts the rest of the turn it lands in (the V1 loop's rule): the run
      // skips the calls it has not made yet and takes the steer before its next model call.
      hasInterrupt: () => queue.pending() > 0,
      onInterrupt: (listener) => queue.onPush(listener),
    },
    takeApplied: () => handed.shift() ?? "",
  };
}

/** The event sink: steer acknowledgements and the outcome row go to the host. */
export function relayEventSink(sinks: OnPremRunSinks, takeApplied: () => string): EventSink {
  return {
    emit(event: RunEvent) {
      if (event.kind === "steer.applied") sinks.onSteerApplied?.(takeApplied());
    },
    outcome(row: RunOutcomeRow) {
      sinks.onOutcome?.(row);
    },
  };
}
