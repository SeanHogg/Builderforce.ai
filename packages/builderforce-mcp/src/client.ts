import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  LATEST_PROTOCOL_VERSION,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Implementation,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { listMcpToolPages } from "./toolPages.js";

export class McpAuthChallenge extends Error {
  constructor(readonly status: number, readonly challenge: string | null) {
    super(`MCP server requires authorization (HTTP ${status})`);
    this.name = "McpAuthChallenge";
  }
}

export interface McpHttpSession {
  id?: string;
  protocolVersion: string;
}

interface ClientOptions {
  url: string;
  authorization?: string | null;
  fetch: typeof fetch;
  info: Implementation;
  timeoutMs: number;
  session?: McpHttpSession;
}

export function createMcpHttpClient(options: ClientOptions) {
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    sessionId: options.session?.id,
    requestInit: {
      redirect: "manual",
      headers: options.authorization ? { Authorization: options.authorization } : {},
    },
    reconnectionOptions: {
      maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1,
    },
    fetch: async (_url, init) => {
      // Responses to POST already carry their own SSE stream when needed.
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization");
      headers.delete("authorization");
      const deadline = AbortSignal.timeout(options.timeoutMs);
      const response = await options.fetch(options.url, {
        ...init,
        headers: { ...Object.fromEntries(headers), ...(authorization ? { Authorization: authorization } : {}) },
        redirect: "manual",
        signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
      });
      if (response.status === 401 || response.status === 403) {
        const challenge = response.headers.get("www-authenticate");
        await response.body?.cancel();
        throw new McpAuthChallenge(response.status, challenge);
      }
      // Older servers sent JSON-RPC with the fetch default text/plain media type.
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (response.ok && response.body && (!mediaType || mediaType === "text/plain")) {
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set("content-type", "application/json");
        return new Response(response.body, { status: response.status, headers: responseHeaders });
      }
      return response;
    },
  });
  if (options.session) transport.setProtocolVersion(options.session.protocolVersion);
  let sequence = 0;

  async function request(method: string, params: JSONRPCRequest["params"]) {
    const id = transport.sessionId ? crypto.randomUUID() : ++sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), options.timeoutMs);
      transport.onerror = reject;
      transport.onmessage = (message) => {
        if (isJSONRPCResultResponse(message) && message.id === id) resolve(message.result);
        if (isJSONRPCErrorResponse(message) && message.id === id) {
          reject(new McpError(message.error.code, message.error.message, message.error.data));
        }
      };
      void transport.send({ jsonrpc: "2.0", id, method, params }).catch(reject);
    }).finally(() => {
      clearTimeout(timer);
      transport.onmessage = undefined;
      transport.onerror = undefined;
    });
  }

  return {
    start: () => transport.start(),
    close: () => transport.close(),
    async initialize(): Promise<McpHttpSession> {
      const result = await request("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: options.info,
      });
      const version = result.protocolVersion ?? LATEST_PROTOCOL_VERSION;
      if (typeof version !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
        throw new Error("MCP server negotiated an unsupported protocol version");
      }
      transport.setProtocolVersion(version);
      await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return { id: transport.sessionId, protocolVersion: version };
    },
    listTools: (): Promise<unknown[]> => listMcpToolPages(async (cursor) => {
      const result = await request("tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(result.tools)) throw new Error("MCP server did not return a tool list");
      return { tools: result.tools, nextCursor: result.nextCursor };
    }),
    callTool: (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }),
  };
}

export function isExpiredMcpSession(error: unknown): boolean {
  return error instanceof StreamableHTTPError && error.code === 404;
}
