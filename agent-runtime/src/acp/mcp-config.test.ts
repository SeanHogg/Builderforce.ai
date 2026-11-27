import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createAcpClient } from "./client.js";
import { assertAcpMcpCapabilities, loadAcpMcpServers } from "./mcp-config.js";

it("translates an explicitly selected VS Code config to ACP session servers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bf-acp-mcp-"));
  const file = join(cwd, "mcp.json");
  try {
    await writeFile(file, JSON.stringify({ servers: {
      workspace: { type: "http", url: "http://127.0.0.1:18789/mcp", headers: { Authorization: "Bearer fixture" } },
      memory: { command: "memory", args: ["--stdio"], env: { MODE: "readonly" }, cwd: "." },
      disabled: { command: "other", disabled: true },
    } }));
    const servers = await loadAcpMcpServers("mcp.json", cwd);
    expect(servers).toEqual([
      { name: "workspace", type: "http", url: "http://127.0.0.1:18789/mcp", headers: [{ name: "Authorization", value: "Bearer fixture" }] },
      { name: "memory", command: "memory", args: ["--stdio"], env: [{ name: "MODE", value: "readonly" }] },
    ]);
    expect(() => assertAcpMcpCapabilities(servers, { http: true, sse: false })).not.toThrow();
    expect(() => assertAcpMcpCapabilities(servers)).toThrow(/does not accept HTTP/);
  } finally {
    await rm(file, { force: true });
    await rmdir(cwd);
  }
});

it("passes the selected servers to a supporting ACP child", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bf-acp-peer-"));
  const config = join(cwd, "mcp.json");
  const peer = join(cwd, "peer.mjs");
  try {
    await writeFile(config, JSON.stringify({ servers: { docs: { type: "http", url: "https://mcp.example.test/mcp" } } }));
    await writeFile(peer, `
import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  const result = method === "initialize"
    ? { protocolVersion: params.protocolVersion, agentCapabilities: { mcpCapabilities: { http: true, sse: false } }, authMethods: [] }
    : { sessionId: method === "session/new" && params.mcpServers[0]?.url === "https://mcp.example.test/mcp" ? "configured" : "missing" };
  console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
`);
    const { sessionId, agent } = await createAcpClient({
      cwd, serverCommand: process.execPath, serverArgs: [peer], mcpConfig: "mcp.json",
    });
    agent.kill();
    expect(sessionId).toBe("configured");
  } finally {
    await Promise.all([rm(config, { force: true }), rm(peer, { force: true })]);
    await rmdir(cwd);
  }
});
