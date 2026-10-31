/**
 * The channel path's MODEL port: where an embedded-runner model turn runs.
 *
 * The runner hands the loop a {@link StreamFn} (the provider's stream, bound by the runner to its route and auth) and a `Model`.
 * This port is that stream behind the agent's `ModelTransport`: the agent asks for a model by NAME, the port resolves the name to
 * the `Model` the runner resolved, turns the transcript into the provider's messages (through the runner's own `transformContext`
 * and `convertToLlm`), streams the answer, forwards the provider's events to the surface as they arrive, and hands the agent
 * the finished answer with its native blocks. It decides nothing: which model, when to swap, and what a stalled turn earns are
 * the agent's.
 *
 * A model is named by its REF (`provider/id`): on-prem the same id is served by several providers, so the id alone cannot say
 * what has been tried. The ref is what the agent's model policy tracks and what the host's fallback picker compares against.
 */

import { ModelTransportError } from "@builderforce/agent-run";
import type { ModelCompletion, ModelRequest, ModelTransport, RunMessage } from "@builderforce/agent-run";
import { isVolatileTail } from "@seanhogg/builderforce-memory/handoff";
import { resolveContextWindowTokens } from "../agents/context-window.js";
import type { AgentLoopConfig } from "../builderforce/agent-loop/agent-loop-config.js";
import { modelRef } from "../builderforce/agent-loop/stall-recovery.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentMessage, AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage, Context, Message, Model, Tool } from "../builderforce/model/types.js";
import type { AgentEventBridge } from "./agentEventBridge.js";
import { modelUsageOf, toAgentMessage, toRunRow } from "./channelMessages.js";

/** The models of one run by ref: the one it started on, and every successor the host's picker has offered. */
export class ChannelModels {
  private readonly byRef = new Map<string, Model>();
  active: Model;

  constructor(start: Model) {
    this.active = start;
    this.byRef.set(modelRef(start), start);
  }

  add(model: Model): string {
    const ref = modelRef(model);
    this.byRef.set(ref, model);
    return ref;
  }

  /** The model a name asks for; the run's active one when it names none (or one this run never met). */
  resolve(ref: string | undefined): Model {
    return (ref ? this.byRef.get(ref) : undefined) ?? this.active;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: the runner's tools carry their own parameter schemas
type AnyTool = AgentTool<any>;

export interface ChannelModelOptions {
  models: ChannelModels;
  streamFn: StreamFn;
  config: AgentLoopConfig;
  tools: readonly AnyTool[];
  bridge: AgentEventBridge;
}

/** The provider's view of the tools the agent advertised this turn: the runner's own tool objects, by name, in the agent's order. */
function advertised(request: ModelRequest, tools: readonly AnyTool[]): Tool[] | undefined {
  if (!request.tools) return undefined;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out = request.tools.map((s) => byName.get(s.function.name)).filter((t): t is AnyTool => t !== undefined);
  return out.length > 0 ? out : undefined;
}

/** The transcript as the runner's messages: the leading system rows are the system prompt, a later system row is a note the model reads as the user's. */
function transcriptOf(rows: readonly RunMessage[], model: Model): { systemPrompt: string; messages: AgentMessage[] } {
  const toolNames = new Map<string, string>();
  const system: string[] = [];
  const messages: AgentMessage[] = [];
  let lead = true;
  for (const row of rows) {
    if (row.role === "system" && lead) {
      system.push(row.content);
      continue;
    }
    lead = false;
    const message = row.role === "system" ? toRunRow({ role: "user", content: row.content, timestamp: Date.now() }) : row;
    const converted = toAgentMessage(message, { model, toolNames, forModel: true });
    if (converted) messages.push(converted);
  }
  return { systemPrompt: system.join("\n\n"), messages };
}

export function channelModelTransport(options: ChannelModelOptions): ModelTransport {
  const { models, streamFn, config, bridge } = options;

  /** One provider turn. `live` ⇒ the surface hears the answer as it is written. */
  async function ask(request: ModelRequest, signal: AbortSignal | undefined, live: boolean): Promise<ModelCompletion> {
    const model = models.resolve(request.model);
    const tailRow = request.messages.at(-1);
    const hasTail = tailRow !== undefined && tailRow.role === "user" && isVolatileTail(tailRow);
    const { systemPrompt, messages: history } = transcriptOf(hasTail ? request.messages.slice(0, -1) : request.messages, model);
    const prepared = config.transformContext ? await config.transformContext(history, signal) : history;
    const converted: Message[] = await config.convertToLlm(prepared);
    const context: Context = {
      systemPrompt,
      // The run's volatile tail rides LAST, built per request and never part of the conversation.
      messages: hasTail ? [...converted, { role: "user", content: tailRow.content, timestamp: Date.now() }] : converted,
      tools: advertised(request, options.tools),
    };
    const apiKey = (config.getApiKey ? await config.getApiKey(model.provider) : undefined) || config.apiKey;
    const response = await streamFn(model, context, { apiKey, temperature: config.temperature, maxTokens: request.maxTokens ?? config.maxTokens, signal });
    let final: AssistantMessage | undefined;
    for await (const event of response) {
      if (event.type === "done" || event.type === "error") {
        final = await response.result();
        break;
      }
      if (live) bridge.modelEvent(event);
    }
    final ??= await response.result();
    if (live) bridge.modelEnd(final);
    // An errored or aborted turn is the run's end, never a turn that acted: the agent is told it failed, and the message stays
    // in the run's record (`AgentEventBridge.modelEnd`).
    if (final.stopReason === "error" || final.stopReason === "aborted") {
      throw new ModelTransportError(final.errorMessage ?? `the model turn ${final.stopReason}`, undefined, { routable: false });
    }
    const row = toRunRow(final);
    return {
      content: row.content,
      toolCalls: row.toolCalls ?? [],
      usage: modelUsageOf(final.usage),
      model: modelRef(model),
      ...(final.stopReason === "length" ? { interrupted: "truncated" as const } : {}),
      ...(row.parts ? { parts: row.parts } : {}),
      ...(row.meta ? { meta: row.meta } : {}),
    };
  }

  return {
    complete: (request, signal) => ask(request, signal, true),
    // A summary is not a turn: the surface does not hear it.
    summarize: (request, signal) => ask(request, signal, false),
    window: (ref) => resolveContextWindowTokens(models.resolve(ref)),
    ...(config.pickFallbackModel
      ? {
          pickFallback: (tried: readonly string[]) => {
            const next = config.pickFallbackModel!(tried);
            return next ? models.add(next) : undefined;
          },
        }
      : {}),
  };
}
