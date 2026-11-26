import { applyEdits, modify, parse as parseJson, type ParseError } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const HOSTS = {
  "claude-code": "mcpServers",
  "claude-desktop": "mcpServers",
  cursor: "mcpServers",
  windsurf: "mcpServers",
  vscode: "servers",
  cline: "mcpServers",
  gemini: "mcpServers",
  codex: "mcp_servers",
} as const;

export type McpConfigHost = keyof typeof HOSTS;

export interface LaunchSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type ConfiguredMcpServer = { transport: "stdio" } & LaunchSpec | {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  protocol?: "sse";
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const entries = record(value);
  if (entries === undefined) return;
  return Object.fromEntries(Object.entries(entries).flatMap(([key, item]) =>
    typeof item === "string" ? [[key, item]] : [],
  ));
}

function readServerMap(document: string, host: McpConfigHost): Record<string, unknown> {
  if (!document.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = host === "codex"
    ? parseToml(document, { integersAsBigInt: "asNeeded" })
    : parseJson(document, errors, { allowTrailingComma: true, allowEmptyContent: true });
  if (value === undefined && errors.length === 0) return {};
  const config = record(value);
  if (errors.length || !config) throw new Error("Invalid MCP host configuration");
  const key = HOSTS[host];
  const map = Object.hasOwn(config, key) ? config[key] : undefined;
  if (map === undefined) return {};
  const servers = record(map);
  if (!servers) throw new Error("Invalid MCP server map");
  return servers;
}

/** Read host configuration as data. Commands and environment references stay literal. */
export function readMcpConfig(document: string, host: McpConfigHost): Map<string, ConfiguredMcpServer> {
  const servers = new Map<string, ConfiguredMcpServer>();
  for (const [name, value] of Object.entries(readServerMap(document, host))) {
    const entry = record(value);
    if (!entry || entry.disabled === true || entry.enabled === false) continue;
    if (typeof entry.command === "string" && entry.command.trim()) {
      const args = entry.args;
      if (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))) continue;
      const env = stringMap(entry.env);
      servers.set(name, {
        transport: "stdio", command: entry.command, args,
        ...(env ? { env } : {}),
        ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
      });
      continue;
    }
    const url = entry.url ?? entry.httpUrl ?? entry.serverUrl;
    if (typeof url !== "string" || !url.trim()) continue;
    const headers = stringMap(entry.headers ?? entry.http_headers);
    servers.set(name, {
      transport: "http", url, ...(headers ? { headers } : {}),
      ...(entry.type === "sse" ? { protocol: "sse" } : {}),
    });
  }
  return servers;
}

function encodeServer(server: ConfiguredMcpServer, host: McpConfigHost): Record<string, unknown> {
  if (server.transport === "stdio") {
    return {
      ...(host === "vscode" || host === "claude-code" ? { type: "stdio" } : {}),
      command: server.command,
      args: server.args ?? [],
      ...(server.env === undefined ? {} : { env: server.env }),
      ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    };
  }
  const remoteType = server.protocol ?? "http";
  const urlKey = host === "windsurf" ? "serverUrl" : host === "gemini" && remoteType === "http" ? "httpUrl" : "url";
  return {
    ...(host === "vscode" || host === "claude-code" ? { type: remoteType } : {}),
    [urlKey]: server.url,
    ...(server.headers === undefined ? {} : { [host === "codex" ? "http_headers" : "headers"]: server.headers }),
  };
}

/** Update one JSON/JSONC server. Append new Codex tables to preserve unrelated TOML comments. */
export function writeMcpConfig(document: string, host: McpConfigHost, name: string, server: ConfiguredMcpServer): string {
  if (!name.trim() || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Invalid MCP server name");
  const servers = readServerMap(document, host);
  const value = encodeServer(server, host);
  if (host === "codex") {
    if (Object.hasOwn(servers, name)) return document;
    const text = stringifyToml({ mcp_servers: { [name]: value } });
    return document ? `${document.trimEnd()}\n\n${text}` : text;
  }
  if (JSON.stringify(servers[name]) === JSON.stringify(value)) return document;
  return applyEdits(document, modify(document, [HOSTS[host], name], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: document.includes("\r\n") ? "\r\n" : "\n" },
  }));
}
