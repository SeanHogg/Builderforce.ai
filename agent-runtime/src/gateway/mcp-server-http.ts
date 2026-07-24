/**
 * MCP (Model Context Protocol) HTTP server for BuilderForceAgents.
 *
 * Mounts at /mcp on the local gateway (port 18789).
 * Exposes BuilderForceAgents tools so external AI coding tools (Cursor, Continue.dev, Windsurf,
 * Goose, Claude Code) can call them as MCP context providers.
 *
 * Endpoints:
 *   GET  /mcp           — MCP tool manifest (list of available tools + schemas)
 *   POST /mcp/call      — Invoke a tool by name with arguments
 *
 * Auth: Bearer token (same as gateway auth). Local loopback requests are allowed
 * without a token when gateway auth is disabled.
 *
 * MCP spec reference: https://modelcontextprotocol.io/specification
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { agentFleetTool } from "../builderforce/tools/agent-fleet-tool.js";
import { codebaseSearchTool } from "../builderforce/tools/codebase-search-tool.js";
import { gitHistoryTool } from "../builderforce/tools/git-history-tool.js";
import {
  reviewsRecordTool,
  securityRecordTool,
  ticketsFromDeltaTool,
} from "../builderforce/tools/platform-ticket-tools.js";
import { projectKnowledgeTool } from "../builderforce/tools/project-knowledge-tool.js";
import { semanticSearchTool } from "../builderforce/tools/semantic-search-tool.js";
import { workflowStatusTool } from "../builderforce/tools/workflow-status-tool.js";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendJson,
  sendMethodNotAllowed,
  sendInvalidRequest,
} from "./http-common.js";
import { getBearerToken, getHeader } from "./http-utils.js";

const MCP_VERSION = "2024-11-05";
const SERVER_NAME = "builderforce";
const SERVER_VERSION = "1.0.0";

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

/** The BuilderForceAgents tools exposed via MCP. */
const MCP_TOOLS = [
  semanticSearchTool, // vector+ranked semantic search (preferred)
  codebaseSearchTool, // keyword grep fallback
  projectKnowledgeTool,
  gitHistoryTool,
  workflowStatusTool,
  agentFleetTool,
  ticketsFromDeltaTool, // relay: record a code delta on the board (builtin tickets.from_delta)
  reviewsRecordTool, // relay: record a Done-item review outcome (builtin reviews.record)
  securityRecordTool, // relay: file a SOC 2 finding as a SECURITY ticket (builtin security.record_finding)
];

/**
 * Convert a TypeBox schema object to an MCP-compatible JSON Schema fragment.
 * TypeBox schemas are already valid JSON Schema so we can pass them through.
 */
function toJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object") {
    // Strip TypeBox internal metadata ($schema, symbols) that JSON Schema consumers don't need
    const { $schema: _s, ...rest } = schema as Record<string, unknown>;
    return rest;
  }
  return { type: "object", properties: {} };
}

/** Build the MCP initialize / tools/list response body. */
function buildManifest() {
  return {
    protocolVersion: MCP_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.parameters),
    })),
  };
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

  if (!url.pathname.startsWith("/mcp")) {
    return false;
  }

  // Cross-origin browser guard (drive-by localhost CSRF). A real MCP client sends
  // no Origin; a web page always does. Reject any request carrying a non-loopback
  // Origin BEFORE auth so a page can't invoke tools even when loopback auth is off.
  const origin = getHeader(req, "origin");
  if (origin && !isLoopbackOrigin(origin)) {
    sendJson(res, 403, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32002, message: "Forbidden: cross-origin requests are not allowed" },
    });
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
    sendJson(res, 401, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    });
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // GET /mcp  →  manifest / initialize response
  if (url.pathname === "/mcp" && req.method === "GET") {
    sendJson(res, 200, buildManifest());
    return true;
  }

  // POST /mcp  →  JSON-RPC 2.0 dispatch (MCP standard transport)
  if (url.pathname === "/mcp" && req.method === "POST") {
    const bodyUnknown = await readJsonBodyOrError(req, res, 512 * 1024);
    if (bodyUnknown === undefined) {
      return true;
    }

    const body = bodyUnknown as Record<string, unknown>;
    const id = body.id ?? null;
    const method = typeof body.method === "string" ? body.method : "";
    const params = (body.params ?? {}) as Record<string, unknown>;

    // MCP initialize
    if (method === "initialize") {
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id,
        result: buildManifest(),
      });
      return true;
    }

    // MCP tools/list
    if (method === "tools/list") {
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id,
        result: { tools: buildManifest().tools },
      });
      return true;
    }

    // MCP tools/call
    if (method === "tools/call") {
      const toolName = typeof params.name === "string" ? params.name : "";
      const toolArgs = (params.arguments ?? params.args ?? {}) as Record<string, unknown>;

      const tool = MCP_TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${toolName}`,
          },
        });
        return true;
      }

      try {
        const result = await tool.execute(`mcp-${Date.now()}`, toolArgs as never);
        const content =
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content ?? result);

        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: content }],
            isError: false,
          },
        });
      } catch (err) {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          },
        });
      }
      return true;
    }

    // Unknown method
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
    return true;
  }

  // Legacy REST: POST /mcp/call  (convenience endpoint for non-MCP clients)
  if (url.pathname === "/mcp/call" && req.method === "POST") {
    const bodyUnknown = await readJsonBodyOrError(req, res, 512 * 1024);
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

    const tool = MCP_TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      sendJson(res, 404, { ok: false, error: `Tool not found: ${toolName}` });
      return true;
    }

    try {
      const result = await tool.execute(`mcp-${Date.now()}`, toolArgs as never);
      sendJson(res, 200, { ok: true, result: result.content ?? result });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
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
