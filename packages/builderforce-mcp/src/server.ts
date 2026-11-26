import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Implementation,
} from "@modelcontextprotocol/sdk/types.js";
import { canCallTool, type ToolGate } from "./policy.js";
import { mcpToolError, mcpToolResult } from "./protocol.js";
import { toMcp, toToolEntry, type McpToolEntry, type RelayToolEntry } from "./tool.js";

interface ToolCatalog<Entry> {
  list(): readonly Entry[] | Promise<readonly Entry[]>;
  call(entry: Entry, args: Record<string, unknown>): Promise<unknown>;
  resolve?(entries: readonly Entry[], name: string): Entry | null;
}

export function createMcpServer<Entry extends McpToolEntry | RelayToolEntry>(
  catalog: ToolCatalog<Entry>,
  options: { info: Implementation; instructions?: string; gate: ToolGate; listChanged?: boolean },
): Server {
  const server = new Server(options.info, {
    capabilities: { tools: { listChanged: options.listChanged ?? false } },
    instructions: options.instructions,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const entries = await catalog.list();
    const tools = [];
    for (const entry of entries) {
      const descriptor = toToolEntry(entry);
      if (!options.gate.allows || await options.gate.allows(descriptor)) tools.push(toMcp(descriptor));
    }
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const entries = await catalog.list();
    const entry = catalog.resolve ? catalog.resolve(entries, params.name) : entries.find((tool) => tool.name === params.name);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
    const args = params.arguments ?? {};
    const descriptor = toToolEntry(entry);
    try {
      if (!await canCallTool(options.gate, descriptor, args)) {
        return mcpToolError(entry.name, "Tool call requires approval");
      }
      return mcpToolResult("tool" in entry ? entry.tool : entry.name, await catalog.call(entry, args));
    } catch (error) {
      return mcpToolError(entry.name, error instanceof Error ? error.message : "Tool call failed");
    }
  });
  return server;
}

/** Compatibility for older Builderforce discovery callers with a partial initialize request. */
function completeLegacyInitialize(message: unknown, fallback: string | undefined): unknown {
  if (!message || typeof message !== "object" || !("method" in message) || message.method !== "initialize") return message;
  const params = ("params" in message && message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
  if (params.clientInfo !== undefined && params.capabilities !== undefined) return message;
  const requested = params.protocolVersion;
  return {
    ...message,
    params: {
      capabilities: {},
      clientInfo: { name: "builderforce-legacy-client", version: "1" },
      ...params,
      protocolVersion: typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS.includes(requested) || !fallback)
        ? requested
        : fallback ?? SUPPORTED_PROTOCOL_VERSIONS[0],
    },
  };
}

export async function serveStatelessMcp(
  server: Server,
  request: Request,
  parsedBody: unknown,
  options: { legacyFallbackVersion?: string } = {},
): Promise<Response> {
  const headers = new Headers(request.headers);
  const accept = headers.get("accept");
  if (!accept || accept === "*/*") headers.set("accept", "application/json, text/event-stream");
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const body = Array.isArray(parsedBody)
    ? parsedBody.map((message) => completeLegacyInitialize(message, options.legacyFallbackVersion))
    : completeLegacyInitialize(parsedBody, options.legacyFallbackVersion);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request(request.url, { method: request.method, headers }), { parsedBody: body });
    if (!Array.isArray(body) || response.status !== 200) return response;
    const payload: unknown = await response.json();
    return Response.json(Array.isArray(payload) ? payload : [payload], { headers: response.headers });
  } finally {
    await server.close();
  }
}
