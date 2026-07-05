import * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "./gateway";
import type { ToolDef } from "./fileTools";
import { ttlCache } from "./ttlCache";

/**
 * Platform tools = the SHARED, server-side capability catalog (projects, tasks,
 * OKRs, specs, …) exposed by the gateway MCP relay (`GET /llm/v1/mcp/tools`,
 * `POST /llm/v1/mcp/call`). The web Brain and this extension are BOTH thin
 * clients of that one catalog — there is no second copy of the tool list here.
 * Adding a capability server-side makes it appear in the IDE chat automatically.
 *
 * This module fetches the advertised catalog and adapts each entry to the
 * extension's {@link ToolDef} shape so the existing agent loop can dispatch it
 * alongside the local file tools. Calls are authed with the same gateway key the
 * chat stream uses, so the IDE "brain" and the web "brain" act as one.
 */

/** One advertised tool from the gateway MCP relay (mirror of api McpToolEntry). */
interface McpToolEntry {
  extensionId: string;
  /** Original tool name on the owning server, sent back on the relay call. */
  tool: string;
  /** Flat, gateway-safe name the model sees (e.g. `builtin_tasks_create`). */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whether the tool writes. Undefined (external servers) ⇒ treat as mutating. */
  mutates?: boolean;
}

/** Best-effort stringify of a relay result for the model's tool message. */
function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

// The advertised catalog is stable; cache it briefly so the chat doesn't refetch
// the tool list on every message. Keyed by base URL (busted on sign-out/URL change
// via clearPlatformToolsCache); short TTL covers a freshly-deployed catalog.
const CATALOG_TTL = 60_000;
const catalogCache = ttlCache<string, ToolDef[]>(CATALOG_TTL);

/** Drop the cached catalog (call on sign-out / workspace change). */
export function clearPlatformToolsCache(): void {
  catalogCache.invalidate();
}

/**
 * Fetch the shared platform-tool catalog and adapt it to ToolDef[]. Returns an
 * empty list (never throws) when signed out or the relay is unreachable, so the
 * chat keeps working with just the local file tools.
 */
export async function listPlatformTools(secrets: vscode.SecretStorage): Promise<ToolDef[]> {
  const key = await getApiKey(secrets);
  if (!key) return [];
  const url = getBaseUrl();
  const cached = catalogCache.get(url);
  if (cached) return cached.value;
  let entries: McpToolEntry[] = [];
  try {
    const res = await fetch(`${url}/llm/v1/mcp/tools`, {
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { tools?: McpToolEntry[] };
    entries = Array.isArray(body.tools) ? body.tools : [];
  } catch {
    return [];
  }

  const tools = entries.map((e): ToolDef => ({
    name: e.name,
    description: e.description,
    parameters: e.parameters ?? { type: "object", properties: {} },
    // Fail safe: only a tool that explicitly advertises mutates=false skips the
    // write-confirm gate; anything else (incl. external tools that omit it) asks.
    mutating: e.mutates !== false,
    remote: true,
    execute: (args) => callPlatformTool(secrets, e.extensionId, e.tool, args),
  }));
  catalogCache.set(url, tools);
  return tools;
}

/** Invoke one platform tool through the gateway MCP relay; returns its result text. */
export async function callPlatformTool(
  secrets: vscode.SecretStorage,
  extensionId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const key = await getApiKey(secrets);
  if (!key) throw new Error("not signed in");
  const res = await fetch(`${getBaseUrl()}/llm/v1/mcp/call`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ extensionId, tool, arguments: args }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  try {
    const parsed = JSON.parse(text) as { result?: unknown };
    return stringifyResult("result" in parsed ? parsed.result : parsed);
  } catch {
    return text;
  }
}

/** A human-readable one-liner for a platform tool call (approval prompt / activity row). */
export function describePlatformTool(name: string, args: Record<string, unknown>): string {
  const verb = name.replace(/^builtin_/, "").replace(/_/g, " ");
  const subject =
    (typeof args.title === "string" && args.title) ||
    (typeof args.name === "string" && args.name) ||
    (typeof args.id !== "undefined" && `#${String(args.id)}`) ||
    "";
  return subject ? `${verb}: ${subject}` : verb;
}
