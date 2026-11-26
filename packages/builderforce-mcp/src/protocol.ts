import { redactJsonText } from "@builderforce/secret-redaction";
import { fitToolText, toolOutputCap } from "@builderforce/tool-output-policy";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { protectToolOutput } from "./policy.js";

export { ErrorCode, McpError, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
export type { CallToolResult, Implementation, Tool } from "@modelcontextprotocol/sdk/types.js";

/** Protocol envelope for rejections that happen at the HTTP boundary before SDK dispatch. */
export function mcpRejection(code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function mcpToolResult(tool: string, value: unknown): CallToolResult {
  const safe = protectToolOutput(tool, value);
  const text = typeof safe === "string" ? safe : safe == null ? "ok" : JSON.stringify(safe);
  return {
    content: [{ type: "text", text }],
    ...(safe && typeof safe === "object" && !Array.isArray(safe)
      ? { structuredContent: safe as Record<string, unknown> }
      : {}),
  };
}

export function safeToolError(tool: string, message: string): string {
  return fitToolText(redactJsonText(message), toolOutputCap(tool), { tool });
}

export function mcpToolError(tool: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: safeToolError(tool, message) }] };
}
