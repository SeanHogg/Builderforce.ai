/**
 * The channel path's TOOL port: the runner's own tools as the agent's closed catalog.
 *
 * A channel agent's tools are the runner's `AgentTool`s (messaging, browser, files, exec, the plugin tools), not the shared
 * registry's, so they are the whole catalog of the run (`PlatformTools.closed`): the agent advertises exactly these and hands every
 * call to {@link PlatformTools.execute}. The agent still owns WHEN a call may run (the governance gates, the argument parse, the
 * steering skip); this port owns what a call DOES, and keeps what the tool returned whole (its blocks, its details) on the row.
 *
 * It reports each call's start, progress and end to the surface as the tool runs, and records a successful call in the host's
 * run log, so the run's note and code map are the host's one record.
 */

import type { PlatformTools } from "@builderforce/agent-run";
import type { RunKnowledgeLog, ToolSchema } from "@builderforce/agent-tools";
import type { AgentTool } from "../builderforce/model/agent-types.js";
import type { AgentEventBridge } from "./agentEventBridge.js";
import { resultParts, textOf } from "./channelMessages.js";

// biome-ignore lint/suspicious/noExplicitAny: the runner's tools carry their own parameter schemas
type AnyTool = AgentTool<any>;

export interface ChannelToolsOptions {
  tools: readonly AnyTool[];
  bridge: AgentEventBridge;
  /** The host's run log; a successful call is recorded in it. */
  knowledge?: RunKnowledgeLog;
  /** The request the run was given: the text the catalog is ranked against. */
  query: string;
}

export function channelTools(options: ChannelToolsOptions): PlatformTools {
  const { bridge, knowledge } = options;
  const byName = new Map(options.tools.map((t) => [t.name, t]));
  const schemas: ToolSchema[] = options.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters as unknown as ToolSchema["function"]["parameters"] },
  }));

  return {
    closed: true,
    // The tool's own words, not a JSON-quoted copy of them.
    verbatimText: true,
    schemas: () => schemas,
    // Every tool the runner gave the run is advertised: the runner decided what this channel may use.
    selection: { query: options.query, limit: Math.max(1, schemas.length), required: new Set<string>() },
    async execute(name, args, env) {
      const callId = env.callId ?? name;
      const tool = byName.get(name);
      bridge.toolStart(callId, name, args);
      try {
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.execute(callId, args, env.signal, (partialResult) => bridge.toolUpdate(callId, name, args, partialResult));
        if (knowledge) knowledge.record(name, args);
        bridge.toolEnd(callId, name, result, false);
        return {
          data: textOf(result.content),
          parts: resultParts(result.content),
          meta: { toolName: name, details: result.details, timestamp: Date.now() },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const result = { content: [{ type: "text" as const, text: message }], details: {} };
        bridge.toolEnd(callId, name, result, true);
        return { data: message, isError: true, parts: resultParts(result.content), meta: { toolName: name, details: {}, timestamp: Date.now() } };
      }
    },
  };
}
