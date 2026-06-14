/**
 * Tool adapter — bridges a shared `@builderforce/agent-tools` {@link ToolDefinition}
 * into a native loop {@link AgentTool} (PI cutover, loop stage). This is what lets the
 * native `Agent` run the SAME cross-surface tool set the cloud loop runs (read/write/
 * edit/bash/web/…), instead of `pi-coding-agent`'s `createReadTool`/`createWriteTool`/
 * `createEditTool`. The reverse of [pi-tool-definition-adapter.ts](../../agents/pi-tool-definition-adapter.ts),
 * which targeted the pi `AgentTool`; this targets the native one.
 *
 * The shared tool reaches the runtime ONLY through the injected {@link CapabilityProvider}
 * (Dependency Inversion), so the adapter just supplies the Node concretion + workspace
 * root and maps `ToolResult` (`{data, content?, control?}`) → `AgentToolResult`
 * (`{content, details}`): JSON `data` becomes the model-readable text block, media
 * `content` blocks become image blocks, and the full result rides in `details` so
 * downstream (engine control handling) can still see `control`.
 */

import type {
  CapabilityProvider,
  ToolContext,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from "@builderforce/agent-tools";
import type { TSchema } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import type { ImageContent, TextContent } from "../model/types.js";

function toAgentToolResult(result: ToolResult): AgentToolResult<ToolResult> {
  const content: (TextContent | ImageContent)[] = [
    { type: "text", text: JSON.stringify(result.data) },
  ];
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "media" && block.mediaType === "image") {
      content.push({
        type: "image",
        data: block.base64 ?? block.uri ?? block.path ?? "",
        mimeType: block.mimeType ?? "image/png",
      });
    }
  }
  return { content, details: result };
}

/** Adapt one shared {@link ToolDefinition} to a native {@link AgentTool}, bound to a
 *  capability provider + workspace root. */
export function toAgentTool(
  def: ToolDefinition,
  provider: CapabilityProvider,
  workspaceRoot?: string,
): AgentTool {
  return {
    name: def.name,
    label: def.name,
    description: def.schema.function.description,
    // TypeBox schemas ARE JSON-Schema objects; the shared schema's `parameters` is the
    // same structural shape the loop forwards to the model.
    parameters: def.schema.function.parameters as unknown as TSchema,
    execute: async (_toolCallId, params, signal) => {
      const ctx: ToolContext = {
        caps: provider,
        signal,
        workspaceRoot,
      };
      const result = await def.execute((params ?? {}) as Record<string, unknown>, ctx);
      return toAgentToolResult(result);
    },
  };
}

/** Adapt every shared tool a surface can run (capability-gated) to native {@link AgentTool}s. */
export function registryToAgentTools(
  registry: ToolRegistry,
  provider: CapabilityProvider,
  workspaceRoot?: string,
): AgentTool[] {
  return registry.toolsFor(provider).map((def) => toAgentTool(def, provider, workspaceRoot));
}
