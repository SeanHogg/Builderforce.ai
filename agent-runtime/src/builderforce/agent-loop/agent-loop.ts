/**
 * Native agent loop — the pi-free replacement for `@mariozechner/pi-agent-core`'s
 * `agentLoop` + `Agent` (PI cutover, loop stage). Drives THE shared agent loop
 * (`@builderforce/agent-loop`) over an injected
 * {@link StreamFn}: stream an assistant message, execute its tool calls against the
 * provided {@link AgentTool}s, append results, repeat until no tool calls — honoring
 * mid-run steering + queued follow-ups. Emits the `AgentEvent` protocol the on-prem
 * surfaces subscribe to. Faithful to pi-agent-core 0.54's loop semantics.
 */

import {
  runAgentLoop,
  type LoopCodec,
  type LoopHooks,
  type LoopPorts,
} from "@builderforce/agent-loop";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import {
  evaluatePolicyGateSeam as evaluateOnPremPolicyGate,
  isPolicyRefusal,
  policyRefusalMessage,
} from "@builderforce/agent-run";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentToolResult,
} from "../model/agent-types.js";
import type { AssistantMessage, Model, TextContent, ToolCall, ToolResultMessage } from "../model/types.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import { createAgentStream, streamAssistantResponse } from "./assistant-stream.js";
import type { EventStream } from "./event-stream.js";
import { packContextForModel } from "./handoff-pack.js";
import { gateRunConfig } from "./prefetch-preamble.js";
import { initialOnPremRunPolicy, modelRef, resolveStallOutcome } from "./stall-recovery.js";
import type { StreamFn } from "./stream.js";

type ToolResultLike = AgentToolResult<unknown>;

function isToolCall(c: { type: string }): c is ToolCall {
  return c.type === "toolCall";
}

/** Visible text of an assistant turn — thinking blocks and tool calls excluded, since
 *  only what the USER was left holding decides whether the turn stalled. */
function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  streamFn: StreamFn,
): Promise<void> {
  let firstTurn = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];
  // Budget for the announced-but-untaken tool call recovery below, shared with the
  // Brain run loop via `@builderforce/agent-stall`.
  let announcementRecoveries = 0;
  // MODEL FAILOVER state: THE model hand-off policy (`@builderforce/run-policy`), the
  // same one every other agent loop drives — every ref burned this run (what the picker
  // must avoid and the exhausted notice names) and the failover budget. `activeModel` is
  // the resolved `Model` behind the policy's current ref: what the NEXT turn runs on.
  let activeModel: Model = config.model;
  let policy = initialOnPremRunPolicy(config.model);
  // The run's own tool NAMES and the request it was given — the two facts the HANDOFF
  // shape needs. Captured once, before the loop starts pushing its own recovery
  // messages in as `user` turns: reading the newest user message later would ask
  // "did the user ask for a change?" of a nudge this loop wrote itself.
  const toolNames = (currentContext.tools ?? []).map((t) => t.name);
  // What this run has read, searched and changed — the shared record every runtime
  // keeps — restated in front of each turn so the model builds on its own work
  // instead of re-deriving the repo once older results compact away.
  const knowledge = config.knowledge ?? new RunKnowledgeRecorder();
  const userRequest =
    [...currentContext.messages]
      .reverse()
      .find((m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user")?.content ?? "";

  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` (the same
  // kernel the cloud engine, the Brain and the canvas drive). The pi-shaped protocol —
  // `AgentMessage` rows, the event stream, steering that skips the rest of a turn,
  // follow-ups after the run would stop — is the codec and the hooks below.
  /** The model errored or was aborted: the whole run ends, follow-ups included. */
  let terminated = false as boolean;
  /** The assistant message of the turn in flight, and its tool results, for `turn_end`. */
  let turnMessage: AssistantMessage | null = null;
  let turnResults: ToolResultMessage[] = [];
  /** Steering that arrived mid-turn: the remaining calls of this turn are skipped. */
  let steeringAfterTools: AgentMessage[] | null = null;
  const skipped: ToolResultLike = {
    content: [{ type: "text", text: "Skipped due to queued user message." }],
    details: {},
  };
  const pushBoth = (m: AgentMessage): void => {
    currentContext.messages.push(m);
    newMessages.push(m);
  };
  const isTerminal = (m: AssistantMessage): boolean =>
    m.stopReason === "error" || m.stopReason === "aborted";

  const codec: LoopCodec<AgentMessage> = {
    assistant: (turn) => turn.meta as AssistantMessage,
    tool: (call, result) => {
      const r = result.data as ToolResultLike;
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: r.content,
        details: r.details,
        isError: result.isError === true,
        timestamp: Date.now(),
      };
    },
  };

  const ports: LoopPorts<AgentMessage> = {
    complete: async () => {
      const message = await streamAssistantResponse(
        currentContext,
        config,
        activeModel,
        signal,
        stream,
        streamFn,
        knowledge.brief(),
      );
      // An errored / aborted turn never executes its calls: it is handed to the
      // no-tool-calls path, which records it and ends the run.
      const toolCalls = isTerminal(message)
        ? []
        : message.content.filter(isToolCall).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          }));
      return { content: assistantText(message), toolCalls, meta: message };
    },
    dispatch: async (call) => {
      const tool = currentContext.tools?.find((t) => t.name === call.name);
      try {
        if (!tool) throw new Error(`Tool ${call.name} not found`);
        const result = await tool.execute(call.id, call.args, signal, (partialResult) => {
          stream.push({
            type: "tool_execution_update",
            toolCallId: call.id,
            toolName: call.name,
            args: call.args,
            partialResult,
          });
        });
        return { data: result };
      } catch (e) {
        const result: ToolResultLike = {
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
          details: {},
        };
        return { data: result, isError: true };
      }
    },
  };

  const hooks: LoopHooks<AgentMessage> = {
    beforeTurn: () => {
      if (!firstTurn) stream.push({ type: "turn_start" });
      else firstTurn = false;
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          stream.push({ type: "message_start", message });
          stream.push({ type: "message_end", message });
          pushBoth(message);
        }
        pendingMessages = [];
      }
      turnMessage = null;
      turnResults = [];
      steeringAfterTools = null;
      return undefined;
    },
    onNoToolCalls: async (_ctx, turn) => {
      const message = turn.meta as AssistantMessage;
      pushBoth(message);
      stream.push({ type: "turn_end", message, toolResults: [] });
      if (isTerminal(message)) {
        terminated = true;
        return { action: "stop", ok: false };
      }
      pendingMessages = (await config.getSteeringMessages?.()) || [];
      // The model ANNOUNCED an action and then ended the turn without taking it
      // ("I'll search the codebase for the handler." → stopReason: stop, 0 tool
      // calls). Treating that as "no tool calls, therefore done" ends the run with a
      // promise as its result — for an autonomous run that is a silent no-op that
      // still burns the run. WHAT that earns — another re-prompt, a different model,
      // or an explained stop — is `resolveStallOutcome`; this only performs it.
      // Nothing to do when steering already queued work.
      if (pendingMessages.length === 0) {
        const decision = resolveStallOutcome({
          facts: {
            text: assistantText(message),
            availableToolCount: currentContext.tools?.length ?? 0,
            availableToolNames: toolNames,
            requestText: typeof userRequest === "string" ? userRequest : "",
          },
          activeModel,
          policy,
          recoveriesUsed: announcementRecoveries,
          pickFallbackModel: config.pickFallbackModel,
        });
        policy = decision.policy;
        const outcome = decision.outcome;
        if (outcome.kind === "nudge") {
          announcementRecoveries = outcome.recoveriesUsed;
          pendingMessages = [{ role: "user", content: outcome.nudge, timestamp: Date.now() }];
        } else if (outcome.kind === "failover") {
          const previous = activeModel;
          activeModel = outcome.model;
          announcementRecoveries = 0;
          // The incoming model inherits a context packed for ITS window (a smaller
          // fallback must not be handed a transcript it cannot hold).
          const packed = await packContextForModel({
            messages: currentContext.messages,
            systemPrompt: currentContext.systemPrompt,
            tools: currentContext.tools,
            from: previous,
            to: outcome.model,
            maxTokens: config.maxTokens,
          });
          if (packed.dropped > 0) currentContext.messages.splice(0, currentContext.messages.length, ...packed.messages);
          config.onModelFallback?.(previous, outcome.model, outcome.notice);
          // Visible, never silent: a run that quietly changes who is answering is its
          // own support ticket. `display: true` also folds it into the next prompt, so
          // the incoming model is told what the previous one failed to do.
          pushBoth({
            role: "custom",
            customType: "model_failover",
            content: outcome.notice,
            display: true,
            details: {
              from: modelRef(previous),
              to: modelRef(outcome.model),
              attempt: outcome.failoversUsed,
              shape: outcome.shape,
            },
            timestamp: Date.now(),
          });
          pendingMessages = [{ role: "user", content: outcome.nudge, timestamp: Date.now() }];
        } else if (outcome.kind === "exhausted") {
          // Nothing left to try. Ending here silently leaves a promise as the run's
          // result — for an autonomous run that reads as a completed step that did
          // nothing. Append the reason to the transcript so the run output, the ticket
          // ledger and any human reviewer see WHY it produced nothing, instead of
          // inferring success from a clean exit.
          pushBoth({ role: "user", content: outcome.notice, timestamp: Date.now() });
        }
      }
      return pendingMessages.length > 0 ? { action: "continue" } : { action: "stop", ok: true };
    },
    beforeToolCalls: (_ctx, turn) => {
      // The kernel pushes the assistant row onto the context; the run's own
      // `newMessages` ledger gets it here.
      turnMessage = turn.meta as AssistantMessage;
      newMessages.push(turnMessage);
      return undefined;
    },
    beforeDispatch: (call) => {
      stream.push({
        type: "tool_execution_start",
        toolCallId: call.id,
        toolName: call.name,
        args: call.args,
      });
      if (steeringAfterTools) {
        // A queued user message outranks the rest of this turn's calls.
        stream.push({
          type: "tool_execution_end",
          toolCallId: call.id,
          toolName: call.name,
          result: skipped,
          isError: true,
        });
        return { result: { data: skipped, isError: true } };
      }
      const decision = evaluateOnPremPolicyGate(config.policyGates, call.name, call.args);
      if (isPolicyRefusal(decision)) {
        // Honour block (and require-approval — this runtime has no policy-pause
        // UI, so it refuses with a message the model sees). Kernel skips
        // `ports.dispatch` when beforeDispatch returns `{ result }`.
        const refused: ToolResultLike = {
          content: [{ type: "text", text: policyRefusalMessage(decision) }],
          details: { policy: decision },
        };
        return { result: { data: refused, isError: true } };
      }
      return undefined;
    },
    afterDispatch: async (call, result, row) => {
      const toolResultMessage = row as ToolResultMessage;
      if (result.isError !== true) knowledge.record(call.name, call.args);
      if (!steeringAfterTools) {
        stream.push({
          type: "tool_execution_end",
          toolCallId: call.id,
          toolName: call.name,
          result: result.data as ToolResultLike,
          isError: result.isError === true,
        });
      }
      turnResults.push(toolResultMessage);
      newMessages.push(toolResultMessage);
      stream.push({ type: "message_start", message: toolResultMessage });
      stream.push({ type: "message_end", message: toolResultMessage });
      if (!steeringAfterTools && config.getSteeringMessages) {
        const steering = await config.getSteeringMessages();
        if (steering.length > 0) steeringAfterTools = steering;
      }
      return undefined;
    },
    afterToolCalls: async () => {
      if (turnMessage)
        stream.push({ type: "turn_end", message: turnMessage, toolResults: turnResults });
      pendingMessages = steeringAfterTools ?? ((await config.getSteeringMessages?.()) || []);
      return undefined;
    },
  };

  while (true) {
    // No `signal` for the kernel: the stream and the tools receive it directly and an
    // abort surfaces as a `stopReason: "aborted"` message, recorded like any other.
    await runAgentLoop<AgentMessage>({
      messages: currentContext.messages,
      codec,
      ports,
      hooks,
      budget: { stepCap: Number.POSITIVE_INFINITY },
    });
    if (terminated) break;
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }
    break;
  }
  stream.push({ type: "agent_end", messages: newMessages });
  stream.end(newMessages);
}

/** Start an agent loop with new prompt message(s). */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();
  void (async () => {
    const newMessages = [...prompts];
    const currentContext: AgentContext = {
      ...context,
      messages: [...context.messages, ...prompts],
    };
    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });
    for (const prompt of prompts) {
      stream.push({ type: "message_start", message: prompt });
      stream.push({ type: "message_end", message: prompt });
    }
    // The PreFetch gate (`prefetch-preamble.ts`): an ANSWER has already settled the run.
    const runConfig = await gateRunConfig(config, prompts, signal, stream, newMessages);
    if (!runConfig) return;
    await runLoop(currentContext, newMessages, runConfig, signal, stream, streamFn);
  })();
  return stream;
}
