import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";
import { readMcpConfig } from "@seanhogg/builderforce-mcp/config";

/** Read a trusted, explicitly selected VS Code MCP configuration for an ACP peer. */
export async function loadAcpMcpServers(file: string, cwd: string): Promise<McpServer[]> {
  const config = readMcpConfig(await readFile(resolve(cwd, file), "utf8"), "vscode");
  return Array.from(config, ([name, server]) => {
    if (server.transport === "http") {
      return {
        name,
        type: server.protocol ?? "http",
        url: server.url,
        headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value })),
      };
    }
    if (server.cwd && resolve(cwd, server.cwd) !== resolve(cwd)) {
      throw new Error(`ACP stdio servers run in the session directory. Check the cwd for MCP server "${name}".`);
    }
    return {
      name, command: server.command, args: server.args ?? [],
      env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
    };
  });
}

export function assertAcpMcpCapabilities(servers: readonly McpServer[], capabilities?: McpCapabilities): void {
  for (const server of servers) {
    if ("type" in server && !capabilities?.[server.type]) {
      throw new Error(`This ACP peer does not accept ${server.type.toUpperCase()} MCP servers.`);
    }
  }
}
