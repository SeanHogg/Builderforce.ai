import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type Implementation,
  type Prompt,
  type Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { canCallTool, type ToolGate } from "./policy.js";
import { mcpToolError, mcpToolResult, protectMcpToolResult } from "./protocol.js";
import { toMcp, toToolEntry, type McpToolEntry, type RelayToolEntry } from "./tool.js";

type ToolCatalog<Entry> = {
  list(): readonly Entry[] | Promise<readonly Entry[]>;
  resolve?(entries: readonly Entry[], name: string): Entry | null;
} & (
  | { call(entry: Entry, args: Record<string, unknown>): Promise<unknown> }
  | { callPrepared(entry: Entry, args: Record<string, unknown>): Promise<CallToolResult> }
);

export interface McpServerOptions {
  info: Implementation;
  instructions?: string;
  gate: ToolGate;
  listChanged?: boolean;
  textResources?: readonly { descriptor: Resource; text: string }[];
  textPrompts?: readonly { descriptor: Prompt; text: string }[];
}

/** Use the SDK protocol for tools bound to the current process or browser tab. */
export async function withInProcessMcp<T>(server: Server, operation: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "builderforce-local-tool-host", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await operation(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

export function createMcpServer<Entry extends McpToolEntry | RelayToolEntry>(
  catalog: ToolCatalog<Entry>,
  options: McpServerOptions,
): Server {
  const resources = options.textResources;
  const prompts = options.textPrompts;
  const server = new Server(options.info, {
    capabilities: {
      tools: { listChanged: options.listChanged ?? false },
      ...(resources?.length ? { resources: {} } : {}),
      ...(prompts?.length ? { prompts: {} } : {}),
    },
    instructions: options.instructions,
  });
  if (resources?.length) {
    server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: resources.map(({ descriptor }) => descriptor) }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: [] }));
    server.setRequestHandler(ReadResourceRequestSchema, ({ params: { uri } }) => {
      const resource = resources.find(({ descriptor }) => descriptor.uri === uri);
      if (!resource) throw new McpError(ErrorCode.InvalidParams, "Unknown resource");
      return { contents: [{ uri, mimeType: resource.descriptor.mimeType, text: resource.text }] };
    });
  }
  if (prompts?.length) {
    server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: prompts.map(({ descriptor }) => descriptor) }));
    server.setRequestHandler(GetPromptRequestSchema, ({ params: { name } }) => {
      const prompt = prompts.find(({ descriptor }) => descriptor.name === name);
      if (!prompt) throw new McpError(ErrorCode.InvalidParams, "Unknown prompt");
      return {
        description: prompt.descriptor.description,
        messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text } }],
      };
    });
  }
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
      const name = "tool" in entry ? entry.tool : entry.name;
      if ("callPrepared" in catalog) return protectMcpToolResult(name, await catalog.callPrepared(entry, args));
      return mcpToolResult(name, await catalog.call(entry, args));
    } catch (error) {
      return mcpToolError(entry.name, error instanceof Error ? error.message : "Tool call failed");
    }
  });
  return server;
}

/**
 * Open the 2025 Streamable HTTP notification channel without retaining a session.
 * The watcher and SDK transport live only as long as this response.
 */
export async function serveMcpCatalogStream(
  server: Server,
  request: Request,
  watch: (signal: AbortSignal, changed: () => Promise<void>) => Promise<void>,
  lifetimeMs: number,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  let response: Response;
  try {
    response = await transport.handleRequest(request);
  } catch (error) {
    await server.close();
    throw error;
  }
  if (!response.ok || !response.body) {
    await server.close();
    return response;
  }

  const reader = response.body.getReader();
  const lifetime = new AbortController();
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(lifetimeMs)]);
  const stop = async () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    deadline.removeEventListener("abort", disconnect);
    await server.close();
  };
  const disconnect = () => { void stop().catch(() => undefined); };
  deadline.addEventListener("abort", disconnect, { once: true });
  if (deadline.aborted) disconnect();
  void Promise.resolve()
    .then(() => watch(lifetime.signal, () => server.sendToolListChanged()))
    .finally(stop)
    .catch(() => undefined);

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await stop();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
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
