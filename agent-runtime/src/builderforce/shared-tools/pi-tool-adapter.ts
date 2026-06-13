/**
 * Adapter: a SHARED {@link ToolDefinition} (`@builderforce/agent-tools`, the same
 * objects the cloud engine runs) → a pi {@link AnyAgentTool} the on-prem loop accepts.
 *
 * This is the bridge that makes "any cloud tool is usable on-prem" concrete: the
 * cloud Worker and the Node loop drive the exact same tool definition; only the
 * injected {@link CapabilityProvider} differs. The two tool SHAPES differ (pi uses a
 * co-located `execute(toolCallId, params)` + TypeBox schema; the shared contract uses
 * `execute(args, ctx)` + a plain JSON-schema), so this maps one to the other.
 */

import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
  CapabilityProvider,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSchema,
} from "@builderforce/agent-tools";
import { ToolRegistry } from "@builderforce/agent-tools";
import type { AnyAgentTool } from "../../agents/pi-tools.types.js";
import { jsonResult } from "../../agents/tools/common.js";

/** Wrap one shared tool as a pi tool, binding it to a capability provider. */
export function toPiTool(def: ToolDefinition, provider: CapabilityProvider): AnyAgentTool {
  return {
    name: def.name,
    label: def.name,
    description: def.schema.function.description,
    // The shared schema's `parameters` is already a JSON Schema object, which is what
    // pi serializes to the model. AnyAgentTool's parameter type is `any`.
    parameters: def.schema.function.parameters as AnyAgentTool["parameters"],
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
      const ctx: ToolContext = { caps: provider, signal };
      const result = await def.execute((params ?? {}) as Record<string, unknown>, ctx);
      // On-prem, `finish` / `ask_human` control signals are handled by the pi loop's
      // own lifecycle, so the adapter surfaces only the model-facing data here.
      return jsonResult(result.data);
    },
  };
}

/**
 * Every shared tool the Node provider can back, as pi tools. By default `finish` is
 * excluded (the pi loop ends when the model stops calling tools — it has no `finish`
 * tool of its own), so a stray cloud-style `finish` can't confuse it.
 */
export function sharedToolsForNode(
  registry: ToolRegistry,
  provider: CapabilityProvider,
  opts?: { includeFinish?: boolean },
): AnyAgentTool[] {
  return registry
    .toolsFor(provider)
    .filter((def) => opts?.includeFinish || def.name !== "finish")
    .map((def) => toPiTool(def, provider));
}

/** Pull the model-facing payload out of a pi tool result: prefer the structured
 *  `details`, fall back to the joined text content. Always a plain object so it
 *  serializes cleanly as the shared `ToolResult.data`. */
function piResultToData(result: AgentToolResult<unknown>): Record<string, unknown> {
  if (result.details && typeof result.details === "object") {
    return result.details as Record<string, unknown>;
  }
  const text = (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { result: result.details ?? text };
}

/**
 * REVERSE adapter: an existing pi {@link AnyAgentTool} → a shared {@link ToolDefinition}.
 * This is what brings the WHOLE on-prem tool set (browser, sessions, channels, media,
 * orchestrate, memory, code-intel, …) under the one shared contract WITHOUT copying
 * any schema (DRY: the schema + logic stay single-sourced in the pi tool). The result
 * is dispatchable through the shared {@link ToolRegistry} exactly like a core/cloud
 * tool, so on-prem and cloud drive the SAME registry + engine abstraction — only the
 * concrete tool instances per surface differ.
 *
 * `requires: []` because the pi tool already encapsulates its own runtime needs and a
 * surface that has the pi tool can run it; per-surface availability is decided by
 * WHICH registry a surface builds (the cloud builds from core tools; on-prem builds
 * from these), not by capability flags here.
 */
export function fromPiTool(tool: AnyAgentTool): ToolDefinition {
  const parameters = (tool.parameters as ToolSchema["function"]["parameters"]) ?? {
    type: "object",
    properties: {},
  };
  return {
    name: tool.name,
    requires: [],
    schema: {
      type: "function",
      function: { name: tool.name, description: tool.description ?? "", parameters },
    },
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const result = await tool.execute(randomUUID(), args as never, ctx.signal);
      return { data: piResultToData(result) };
    },
  };
}

/**
 * Build the on-prem surface's tool registry from its assembled pi tools — the SAME
 * shared {@link ToolRegistry} type the cloud uses. After this, the On-Prem (and the
 * future V2 `local`) surface sources its ENTIRE tool set through the shared contract:
 * every pi tool is a shared `ToolDefinition`, dispatched the same way as the cloud's
 * core tools. Duplicate names (pi sets are unique, but defensively) keep the first.
 */
export function buildOnPremToolRegistry(piTools: AnyAgentTool[]): ToolRegistry {
  const registry = new ToolRegistry();
  const seen = new Set<string>();
  for (const tool of piTools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    registry.register(fromPiTool(tool));
  }
  return registry;
}
