/** Workspace Markdown tools with adapters for existing call and policy names. */

import { ToolRegistry, workspaceMemoryReadTool, workspaceMemorySearchTool } from "@builderforce/agent-tools";
import { Type } from "@sinclair/typebox";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { buildWorkspaceMemoryProvider, type NodeWorkspaceMemoryProvider } from "../../builderforce/shared-tools/node-service-tools.js";
import { jsonResult, readNumberParam, readStringParam, type AnyAgentTool } from "./common.js";

interface MemoryToolOptions {
  config?: BuilderForceAgentsConfig;
  agentSessionKey?: string;
  /** Opt in with one options object shared by the search and read factories. */
  workspaceReferences?: boolean;
}

const registry = new ToolRegistry([workspaceMemorySearchTool, workspaceMemoryReadTool]);
const scopes = new WeakMap<MemoryToolOptions, NodeWorkspaceMemoryProvider>();

// These fields are accepted only through the original compatibility entry point.
const savedReadParams = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});
const { description: searchDescription, parameters: searchParams } = workspaceMemorySearchTool.schema.function;
const { description: readDescription, parameters: wireReadParams } = workspaceMemoryReadTool.schema.function;
const referenceParams = Type.Unsafe(wireReadParams);
const readParams = Type.Union([savedReadParams, referenceParams]);

function providerFor(options: MemoryToolOptions): NodeWorkspaceMemoryProvider | null {
  if (!options.workspaceReferences) return buildWorkspaceMemoryProvider(options, false);
  const existing = scopes.get(options);
  if (existing) return existing;
  const provider = buildWorkspaceMemoryProvider(options);
  if (provider) scopes.set(options, provider);
  return provider;
}

export function createMemorySearchTool(options: MemoryToolOptions): AnyAgentTool | null {
  const caps = providerFor(options);
  if (!caps) return null;
  return {
    name: "memory_search",
    label: "Memory Search",
    description: searchDescription,
    parameters: Type.Unsafe(searchParams),
    ...(options.workspaceReferences ? { wireName: workspaceMemorySearchTool.name } : {}),
    idempotent: true,
    async execute(_toolCallId, params) {
      const { data } = await registry.dispatch(workspaceMemorySearchTool.name, {
        query: readStringParam(params, "query", { required: true }),
        maxResults: readNumberParam(params, "maxResults"),
        minScore: readNumberParam(params, "minScore"),
      }, { caps });
      return jsonResult(data);
    },
  };
}

export function createMemoryGetTool(options: MemoryToolOptions): AnyAgentTool | null {
  const caps = providerFor(options);
  if (!caps) return null;
  return {
    name: "memory_get",
    label: "Memory Get",
    description: options.workspaceReferences
      ? readDescription
      : "Read a snippet from a configured Markdown memory file using its path and optional from/lines values.",
    parameters: options.workspaceReferences ? readParams : savedReadParams,
    ...(options.workspaceReferences ? { wireName: workspaceMemoryReadTool.name, wireParameters: referenceParams } : {}),
    idempotent: true,
    async execute(_toolCallId, params) {
      if (options.workspaceReferences && Object.hasOwn(params, "ref")) {
        const { data } = await registry.dispatch(workspaceMemoryReadTool.name, { ref: params.ref }, { caps });
        return jsonResult(data);
      }
      const path = readStringParam(params, "path", { required: true });
      return jsonResult(await caps.readPath(path, {
        from: readNumberParam(params, "from", { integer: true }),
        lines: readNumberParam(params, "lines", { integer: true }),
      }));
    },
  };
}
