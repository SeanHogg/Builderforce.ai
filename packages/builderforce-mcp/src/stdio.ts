import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { LaunchSpec } from "./config.js";
import { listMcpToolPages } from "./toolPages.js";

export function serveStdioMcp(server: Server): Promise<void> {
  return server.connect(new StdioServerTransport());
}

/** Lazily start an approved local command. Reconnect on the next request after a child exits. */
export function createMcpStdioClient(launch: LaunchSpec, options: { info: Implementation; timeoutMs: number }) {
  let current: Promise<Client> | undefined;
  let disposed = false;

  function connected(): Promise<Client> {
    if (disposed) return Promise.reject(new Error("MCP stdio client is closed"));
    if (current) return current;
    const client = new Client(options.info);
    const transport = new StdioClientTransport({ ...launch });
    const connecting = client.connect(transport, { timeout: options.timeoutMs }).then(() => client);
    const clear = () => {
      if (current === connecting) current = undefined;
    };
    client.onclose = clear;
    current = connecting;
    void connecting.catch(() => {
      clear();
      return client.close().catch(() => undefined);
    });
    return connecting;
  }

  return {
    async listTools() {
      const client = await connected();
      return listMcpToolPages((cursor) => client.listTools(
        cursor ? { cursor } : undefined, { timeout: options.timeoutMs },
      ));
    },
    async callTool(name: string, args: Record<string, unknown>) {
      const client = await connected();
      return client.callTool({ name, arguments: args }, undefined, { timeout: options.timeoutMs });
    },
    async close() {
      disposed = true;
      const client = await current?.catch(() => undefined);
      await client?.close();
    },
  };
}
