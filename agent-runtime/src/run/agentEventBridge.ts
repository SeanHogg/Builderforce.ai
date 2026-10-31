/**
 * The `AgentEvent` bridge: what the embedded runner's surfaces subscribe to, told from the agent's own trace.
 *
 * The runner, the session (which persists each ended message) and the stream subscribers speak `AgentEvent`: a lifecycle,
 * a message per row, and a tool's start / update / end. The agent speaks `RunEvent` (a trace with no text) and announces each
 * row that joins its transcript (`RunStore.appended`). This module is the translation, held in ONE place:
 *
 *   • rows        — `appended` is told every user, tool and synthesized assistant row the moment it joins the transcript, and
 *                   becomes that row's `message_start` / `message_end`;
 *   • the trace   — `turn.started`, `turn.finished`, `tool.dispatched` and `run.finished` become the turn and tool events;
 *   • the model   — an assistant row streams as the model writes it, so the model PORT forwards the provider's events here
 *                   ({@link AgentEventBridge.modelEvent}); the row that arrives later is not told twice;
 *   • the tool    — a tool the surface runs reports its start, its progress and its end here as it runs, so a long command shows
 *                   live; a call that never reached the surface (a refusal, a skipped call) is told from its row.
 *
 * It also keeps the run's ORDERED record of messages, which is what `prompt()` returns: the rows as they joined, the model's
 * errored or aborted turn (which is a message, not a row), and the notice of a model swap. It decides nothing.
 */

import type { RunEvent, RunMessage } from "@builderforce/agent-run";
import type { AgentEvent, AgentMessage } from "../builderforce/model/agent-types.js";
import { createAgentStream } from "../builderforce/agent-loop/assistant-stream.js";
import type { EventStream } from "../builderforce/agent-loop/event-stream.js";
import type { AssistantMessage, AssistantMessageEvent, Model, ToolResultMessage } from "../builderforce/model/types.js";
import { toAgentMessage } from "./channelMessages.js";

/** A model swap the stall policy made: who gave up, who took over, and the notice that says why. */
export interface ModelSwap {
  from: string | undefined;
  to: string;
  attempt: number | undefined;
  shape: unknown;
  notice: string;
}

export interface BridgeOptions {
  /** The model a row reads as written by when the row names none (an answer found before any model call). */
  activeModel: () => Model;
  /** A model swap happened (the host updates its own current model). */
  onSwap: (swap: ModelSwap) => void;
}

export class AgentEventBridge {
  readonly stream: EventStream<AgentEvent, AgentMessage[]> = createAgentStream();
  /** The run's messages, in the order they happened. */
  private readonly record: AgentMessage[] = [];
  private readonly toolNames = new Map<string, string>();
  private readonly started = new Set<string>();
  private readonly ended = new Set<string>();
  private turnOpen = false;
  /** The run's last message is an errored or aborted turn. */
  private terminal = false;
  /** The agent ended the run by its own policy (a stall with nothing left to try): the conversation says why, and it is not a failed turn. */
  private settledByPolicy = false;
  private lastAssistant: AssistantMessage | undefined;
  private turnResults: ToolResultMessage[] = [];

  constructor(private readonly options: BridgeOptions) {}

  /** The run begins: its lifecycle opens, and the prompts it was given are told as messages. */
  start(prompts: readonly AgentMessage[]): void {
    this.stream.push({ type: "agent_start" });
    this.stream.push({ type: "turn_start" });
    this.turnOpen = true;
    for (const prompt of prompts) {
      this.record.push(prompt);
      this.stream.push({ type: "message_start", message: prompt });
      this.stream.push({ type: "message_end", message: prompt });
    }
  }

  // ── the model port ──────────────────────────────────────────────────────────

  /** One event of the provider's stream, as the answer is being written. */
  modelEvent(event: AssistantMessageEvent): void {
    if (event.type === "start") this.stream.push({ type: "message_start", message: { ...event.partial } });
    else if (event.type !== "done" && event.type !== "error") this.stream.push({ type: "message_update", assistantMessageEvent: event, message: { ...event.partial } });
  }

  /**
   * The answer is complete. An errored or aborted turn is a message the run ends on: it joins the record here, because no row
   * ever carries it.
   */
  modelEnd(message: AssistantMessage): void {
    this.lastAssistant = message;
    this.stream.push({ type: "message_end", message });
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      this.terminal = true;
      this.record.push(message);
    }
  }

  // ── the tool port ───────────────────────────────────────────────────────────

  toolStart(callId: string, toolName: string, args: unknown): void {
    this.started.add(callId);
    this.stream.push({ type: "tool_execution_start", toolCallId: callId, toolName, args });
  }

  toolUpdate(callId: string, toolName: string, args: unknown, partialResult: unknown): void {
    this.stream.push({ type: "tool_execution_update", toolCallId: callId, toolName, args, partialResult });
  }

  toolEnd(callId: string, toolName: string, result: unknown, isError: boolean): void {
    this.ended.add(callId);
    this.stream.push({ type: "tool_execution_end", toolCallId: callId, toolName, result, isError });
  }

  // ── the agent's trace ───────────────────────────────────────────────────────

  /** The event sink: the trace the agent writes. */
  readonly emit = (event: RunEvent): void => {
    switch (event.kind) {
      case "turn.started":
        // The first turn was opened with the run; every later one closes the turn before it.
        if (this.firstTurnPending) this.firstTurnPending = false;
        else {
          this.closeTurn();
          this.stream.push({ type: "turn_start" });
          this.turnOpen = true;
        }
        break;
      case "turn.finished":
        this.closeTurn();
        break;
      case "tool.dispatched":
        if (event.callId) this.settleCall(event.callId, event.tool, event.args, event.result, !event.ok);
        break;
      case "run.finished":
        this.closeTurn();
        break;
      case "context.compacted":
        // The note that stands for the dropped middle reaches the session as the summary row every converter folds into the prompt.
        if (event.note) this.record.push({ role: "compactionSummary", summary: event.note, tokensBefore: event.beforeTokens ?? 0, timestamp: Date.now() });
        break;
      case "stall.recovered":
        if (event.action === "escalate") this.swapped(event.detail);
        if (event.action === "pause" || event.action === "fail") this.settledByPolicy = true;
        break;
      default:
        break;
    }
  };

  private firstTurnPending = true;

  /** A row joined the transcript. */
  readonly appended = (row: RunMessage): void => {
    const message = toAgentMessage(row, { model: this.options.activeModel(), toolNames: this.toolNames });
    if (!message) return;
    if (message.role === "assistant") {
      this.record.push(message);
      // An assistant row the model streamed was told as it was written; one with no stream behind it (an answer found before any
      // model call) is told here.
      if (!row.meta) {
        this.lastAssistant = message;
        this.stream.push({ type: "message_start", message });
        this.stream.push({ type: "message_end", message });
      }
      return;
    }
    if (message.role === "toolResult") {
      // A call that never reached the surface (a refusal, a skipped call) has no start or end of its own: it is told from its row.
      if (!this.ended.has(message.toolCallId)) this.settleCall(message.toolCallId, message.toolName, undefined, { content: message.content, details: message.details }, message.isError);
      this.turnResults.push(message);
    }
    this.record.push(message);
    this.stream.push({ type: "message_start", message });
    this.stream.push({ type: "message_end", message });
  };

  // ── the end ─────────────────────────────────────────────────────────────────

  /**
   * The run failed with no model turn behind the failure (the provider stream threw, the context transform threw, the run was
   * stopped between turns): the failure is told as the errored (or aborted) assistant message the runner reads at the end of a
   * run. A failure that already ended on one, or that the agent ended by its own policy, adds nothing.
   */
  fail(reason: string, stopReason: "error" | "aborted"): void {
    if (this.terminal || this.settledByPolicy) return;
    const model = this.options.activeModel();
    const message: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason,
      errorMessage: reason,
      timestamp: Date.now(),
    };
    this.terminal = true;
    this.record.push(message);
    this.stream.push({ type: "message_start", message });
    this.stream.push({ type: "message_end", message });
  }

  /** The messages of the run, in order. */
  messages(): AgentMessage[] {
    return [...this.record];
  }

  /** The run is over: its last turn closes, `agent_end` is told, and the stream settles on the run's messages. */
  finish(): void {
    this.closeTurn();
    const messages = this.messages();
    this.stream.push({ type: "agent_end", messages });
    this.stream.end(messages);
  }

  private closeTurn(): void {
    if (!this.turnOpen) return;
    this.turnOpen = false;
    if (this.lastAssistant) this.stream.push({ type: "turn_end", message: this.lastAssistant, toolResults: this.turnResults });
    this.turnResults = [];
  }

  private settleCall(callId: string, toolName: string, args: unknown, result: unknown, isError: boolean): void {
    this.toolNames.set(callId, toolName);
    if (!this.started.has(callId)) this.toolStart(callId, toolName, args ?? {});
    if (!this.ended.has(callId)) {
      const text = typeof result === "string" ? result : JSON.stringify(result ?? null);
      const shaped = result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content) ? result : { content: [{ type: "text", text }], details: {} };
      this.toolEnd(callId, toolName, shaped, isError);
    }
  }

  private swapped(detail: Record<string, unknown> | undefined): void {
    const to = typeof detail?.to === "string" ? detail.to : undefined;
    const notice = typeof detail?.notice === "string" ? detail.notice : "";
    if (!to) return;
    const from = typeof detail?.from === "string" ? detail.from : undefined;
    this.record.push({
      role: "custom",
      customType: "model_failover",
      content: notice,
      display: true,
      details: { from, to, attempt: detail?.attempt, shape: detail?.shape },
      timestamp: Date.now(),
    });
    this.options.onSwap({ from, to, attempt: typeof detail?.attempt === "number" ? detail.attempt : undefined, shape: detail?.shape, notice });
  }
}
