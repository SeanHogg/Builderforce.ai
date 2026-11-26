import type { RelayToolEntry } from "./tool.js";

export const PLATFORM_EXTENSION_ID = "builtin";
export const MCP_CATALOG_TTL_MS = 60_000;
export const MCP_CALL_PATH = "/llm/v1/mcp/call";

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
    async list(surface?: string, failure?: (status: number) => string): Promise<RelayToolEntry[]> {
      const response = await request(mcpCatalogPath(surface));
      if (!response.ok) throw new Error(failure?.(response.status) ?? `tool catalog unavailable (HTTP ${response.status})`);
      const body = (await response.json()) as RelayCatalog;
      return Array.isArray(body.tools) ? body.tools : [];
    },
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
