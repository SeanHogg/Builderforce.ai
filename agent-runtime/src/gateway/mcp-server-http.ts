/** The agent-runtime gateway adapter for the local MCP catalog. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, resolve } from "node:path";
import {
  createWorkspaceMcpServer,
  createWorkspaceMcpTools,
  resolveWorkspaceMcpTool,
  WORKSPACE_MCP_INFO,
  type WorkspaceMcpTool,
} from "@builderforce/workspace-mcp";
import { nodeWatchPort } from "@builderforce/agent-tools/node-watch-port";
import { advertiseName, normalizeInputSchema, toMcp } from "@seanhogg/builderforce-mcp";
import { protectToolOutput } from "@seanhogg/builderforce-mcp/policy";
import { ErrorCode, mcpRejection, safeToolError } from "@seanhogg/builderforce-mcp/protocol";
import { serveStatelessMcp } from "@seanhogg/builderforce-mcp/server";
import { onPremRootId } from "../agents/knowledge/index/onPremRootId.js";
import { buildNodeCapabilityProvider } from "../agents/node-capability-provider.js";
import { onPremTreeSitterDir } from "../agents/on-prem-symbol-index.js";
import { agentFleetTool } from "../builderforce/tools/agent-fleet-tool.js";
import { codebaseSearchTool } from "../builderforce/tools/codebase-search-tool.js";
import { gitHistoryTool } from "../builderforce/tools/git-history-tool.js";
import { projectKnowledgeTool } from "../builderforce/tools/project-knowledge-tool.js";
import { semanticSearchTool } from "../builderforce/tools/semantic-search-tool.js";
import { workflowStatusTool } from "../builderforce/tools/workflow-status-tool.js";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { readJsonBody } from "./hooks.js";
import {
  readJsonBodyOrError,
  sendJson,
  sendMethodNotAllowed,
  sendInvalidRequest,
} from "./http-common.js";
import { getBearerToken, getHeader } from "./http-utils.js";

const MAX_BODY_BYTES = 512 * 1024;

/**
 * True if an `Origin` header names a loopback host. MCP clients (Cursor, Claude
 * Code, Goose, …) are NOT browsers and send NO `Origin`; only a web page sends
 * one. A page served from anything but localhost that reaches the loopback MCP
 * port is a drive-by CSRF attempt (esp. when loopback auth is disabled), so we
 * accept an `Origin` only when it is itself loopback.
 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

const LEGACY_TOOLS = [
  semanticSearchTool,
  codebaseSearchTool,
  projectKnowledgeTool,
  gitHistoryTool,
  workflowStatusTool,
  agentFleetTool,
];

const LEGACY_ENTRIES: readonly WorkspaceMcpTool[] = LEGACY_TOOLS.map((tool) => ({
  name: advertiseName("workspace", tool.name),
  legacyName: tool.name,
  title: tool.label,
  description: tool.description,
  inputSchema: normalizeInputSchema(tool.parameters),
  effect: "read",
  surfaces: ["workspace"],
  async run(args) {
    const result = await tool.execute(crypto.randomUUID(), args as never);
    return result.content ?? result;
  },
}));

const WORKSPACE_TOOLS = createWorkspaceMcpTools((projectRoot) => {
  if (!projectRoot || !isAbsolute(projectRoot)) throw new Error("An absolute projectRoot is required");
  const root = resolve(projectRoot);
  return { root, caps: buildNodeCapabilityProvider({ workspaceRoot: root }) };
}, {
  requireRoot: true,
  grammar: () => {
    const wasmDir = onPremTreeSitterDir();
    return wasmDir ? { wasmDir } : {};
  },
  // One change feed and one root id per workspace: the definition index follows the same port.
  watch: nodeWatchPort(),
  rootId: (root) => onPremRootId(root),
});

function nodeRequestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else for (const part of value ?? []) headers.append(key, part);
  }
  return headers;
}

export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) {
    return false;
  }

  // Cross-origin browser guard (drive-by localhost CSRF). A real MCP client sends
  // no Origin; a web page always does. Reject any request carrying a non-loopback
  // Origin BEFORE auth so a page can't invoke tools even when loopback auth is off.
  const origin = getHeader(req, "origin");
  if (origin && !isLoopbackOrigin(origin)) {
    sendJson(res, 403, mcpRejection(ErrorCode.InvalidRequest, "Forbidden: cross-origin requests are not allowed"));
    return true;
  }

  // Authenticate all MCP requests
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? loadConfig().gateway?.trustedProxies,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="builderforce-workspace"');
    sendJson(res, 401, mcpRejection(ErrorCode.InvalidRequest, "Unauthorized"));
    return true;
  }

  // No wildcard CORS: MCP clients are not browsers. We only ever reach here with
  // no Origin (native client) or a loopback Origin (guarded above), so reflect a
  // loopback Origin for the rare local browser tool and emit nothing otherwise.
  // A wildcard `*` would let ANY visited web page fetch the loopback tool endpoint.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Legacy GET manifest for clients that use the REST adapter.
  if (url.pathname === "/mcp" && req.method === "GET") {
    if (getHeader(req, "accept")?.includes("text/event-stream")) {
      sendJson(res, 405, mcpRejection(ErrorCode.MethodNotFound, "This MCP server is stateless; use POST"));
      return true;
    }
    sendJson(res, 200, {
      serverInfo: WORKSPACE_MCP_INFO,
      capabilities: { tools: {} },
      tools: LEGACY_ENTRIES.map((entry) => ({ ...toMcp(entry), name: entry.legacyName })),
    });
    return true;
  }

  // POST /mcp  →  JSON-RPC 2.0 dispatch (MCP standard transport)
  if (url.pathname === "/mcp" && req.method === "POST") {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : body.error === "request body timeout" ? 408 : 400;
      sendJson(res, status, mcpRejection(ErrorCode.ParseError, body.error));
      return true;
    }
    const server = createWorkspaceMcpServer(WORKSPACE_TOOLS, LEGACY_ENTRIES);
    const response = await serveStatelessMcp(server, new Request(url, { method: "POST", headers: nodeRequestHeaders(req) }), body.value);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(await response.text());
    return true;
  }

  // Legacy REST: POST /mcp/call  (convenience endpoint for non-MCP clients)
  if (url.pathname === "/mcp/call" && req.method === "POST") {
    const bodyUnknown = await readJsonBodyOrError(req, res, MAX_BODY_BYTES);
    if (bodyUnknown === undefined) {
      return true;
    }

    const body = bodyUnknown as Record<string, unknown>;
    const toolName = typeof body.tool === "string" ? body.tool : "";
    const toolArgs = (body.args ?? body.arguments ?? {}) as Record<string, unknown>;

    if (!toolName) {
      sendInvalidRequest(res, "body.tool is required");
      return true;
    }

    const tool = resolveWorkspaceMcpTool(WORKSPACE_TOOLS, LEGACY_ENTRIES, toolName);
    if (!tool) {
      sendJson(res, 404, { ok: false, error: `Tool not found: ${toolName}` });
      return true;
    }

    try {
      const result = await tool.run(toolArgs);
      sendJson(res, 200, { ok: true, result: protectToolOutput(tool.name, result) });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: safeToolError(tool.name, err instanceof Error ? err.message : String(err)),
      });
    }
    return true;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendMethodNotAllowed(res, "GET, POST");
    return true;
  }

  // Unknown /mcp sub-path
  sendJson(res, 404, { ok: false, error: "Unknown MCP endpoint" });
  return true;
}
