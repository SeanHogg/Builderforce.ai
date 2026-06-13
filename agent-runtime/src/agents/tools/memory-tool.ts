/**
 * Memory recall tools (memory_search / memory_get).
 *
 * Legacy pi (`AnyAgentTool`) wrappers — the implementation lives once in the pi-free
 * `builderforce/shared-tools/node-service-tools.ts` (`runMemorySearch`/`runMemoryGet`
 * + `resolveMemoryToolContext`), shared with the native `ToolDefinition`s (DRY).
 * Removed when the pi loop is retired.
 */

import { Type } from "@sinclair/typebox";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import {
  resolveMemoryToolContext,
  runMemoryGet,
  runMemorySearch,
} from "../../builderforce/shared-tools/node-service-tools.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

export function createMemorySearchTool(options: {
  config?: BuilderForceAgentsConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search .builderforce/MEMORY.md + .builderforce/memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      return jsonResult(
        await runMemorySearch(ctx, {
          query,
          maxResults: maxResults ?? undefined,
          minScore: minScore ?? undefined,
        }),
      );
    },
  };
}

export function createMemoryGetTool(options: {
  config?: BuilderForceAgentsConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from .builderforce/MEMORY.md or .builderforce/memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      return jsonResult(
        await runMemoryGet(ctx, {
          path: relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        }),
      );
    },
  };
}
