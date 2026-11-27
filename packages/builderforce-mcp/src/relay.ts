import { advertiseName } from "./naming.js";
import { requiresWriteApproval, toOpenAI, type RelayToolEntry } from "./tool.js";

export const PLATFORM_EXTENSION_ID = "builtin";
export const MCP_CATALOG_TTL_MS = 60_000;
export const MCP_CALL_PATH = "/llm/v1/mcp/call";

/** The canonical provider-facing name for a first-party platform relay entry. */
export function platformWireToolName(entry: Pick<RelayToolEntry, "extensionId" | "tool">): string | undefined {
  if (entry.extensionId !== PLATFORM_EXTENSION_ID) return undefined;
  try {
    return advertiseName("platform", entry.tool);
  } catch {
    return undefined;
  }
}

export function mcpCatalogPath(surface?: string): string {
  return "/llm/v1/mcp/tools" + (surface ? `?surface=${encodeURIComponent(surface)}` : "");
}

export interface RelayToolCall {
  extensionId: string;
  tool: string;
  arguments?: unknown;
}

export function mcpCallRequest(call: RelayToolCall) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(call),
  };
}

export interface RelayCatalog {
  tools?: RelayToolEntry[];
}

export interface RelayCallResult {
  result?: unknown;
  error?: string;
}

/** Optional projection for hosts consuming the relay from a native runtime. */
export function toRelayModelTool(entry: RelayToolEntry & { legacyName?: string }) {
  const { extensionId, tool, name, legacyName } = entry;
  return {
    extensionId, tool, name,
    ...(legacyName && legacyName !== name ? { legacyName } : {}),
    modelTool: toOpenAI(entry),
    approvalRequired: requiresWriteApproval(entry),
  };
}

export function relayModelText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "{}";
}

export async function readMcpRelayCatalog(
  response: Response,
  failure?: (status: number) => string,
): Promise<RelayToolEntry[]> {
  if (!response.ok) throw new Error(failure?.(response.status) ?? `tool catalog unavailable (HTTP ${response.status})`);
  const body = (await response.json()) as RelayCatalog;
  return Array.isArray(body.tools) ? body.tools : [];
}

export function createMcpRelay(options: {
  baseUrl: string;
  token?: string | null;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
}) {
  const fetcher = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  function request(path: string, init: RequestInit = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...init.headers,
      ...options.headers,
    };
    const signal = options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
    return fetcher(baseUrl + path, { ...init, headers, ...(signal ? { signal } : {}) });
  }

  return {
    list: async (surface?: string, failure?: (status: number) => string) =>
      readMcpRelayCatalog(await request(mcpCatalogPath(surface)), failure),
    call: (call: RelayToolCall) => request(MCP_CALL_PATH, mcpCallRequest(call)),
  };
}

/** Retain one catalog for one authenticated scope and collapse concurrent reads. */
export function createMcpCatalogCache<T>(now: () => number = Date.now) {
  let cached: { key: string; at: number; value: Promise<T> } | undefined;
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const at = now();
      if (cached?.key === key && at - cached.at < MCP_CATALOG_TTL_MS) return cached.value;
      const value = load().catch((error: unknown) => {
        if (cached?.value === value) cached = undefined;
        throw error;
      });
      cached = { key, at, value };
      return value;
    },
    clear() { cached = undefined; },
  };
}
