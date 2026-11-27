import assert from "node:assert/strict";
import test from "node:test";
import { advertiseName, relayModelText, toRelayModelTool } from "../dist/index.js";
import { readMcpConfig, readSynapseConnectors, writeMcpConfig } from "../dist/config.js";

test("the native relay projection uses canonical tool shaping and approval", () => {
  const entry = { extensionId: "remote", tool: "search", name: "remote_search", description: "Search", parameters: { type: "object" } };
  assert.deepEqual(toRelayModelTool(entry), {
    extensionId: "remote",
    tool: "search",
    name: "remote_search",
    modelTool: { type: "function", function: { name: "remote_search", description: "Search", parameters: { type: "object" } } },
    approvalRequired: true,
  });
  assert.equal(toRelayModelTool({ ...entry, mutates: false }).approvalRequired, false);
  assert.equal(relayModelText({ id: 3 }), '{"id":3}');
  assert.equal(advertiseName("platform", "tasks.list"), "platform__tasks_list");
});

test("legacy Synapse launch settings round-trip through the VS Code config codec", () => {
  const [connector] = readSynapseConnectors(JSON.stringify([
    { id: "search-1", name: "Search", command: "node", args: ["server.js"], secretKeys: ["TOKEN"] },
    { id: "disabled-1", name: "Disabled", command: "node", enabled: false },
  ]));
  assert.deepEqual(connector.launch.env, { TOKEN: "${env:TOKEN}" });
  const output = writeMcpConfig('{\n  // keep the comment\n  "inputs": []\n}', "vscode", connector.id, {
    transport: "stdio",
    ...connector.launch,
  });
  assert.match(output, /keep the comment/);
  assert.deepEqual(readMcpConfig(output, "vscode").get(connector.id), { transport: "stdio", ...connector.launch });
});

test("Claude Code local sources resolve only the selected project on Windows", () => {
  const remote = { type: "http", url: "https://tools.example/mcp", headers: { Authorization: "Bearer ${TOKEN}" } };
  const document = JSON.stringify({
    mcpServers: { user: remote },
    projects: {
      "C:/Code/project": { mcpServers: { current: remote } },
      "C:/Code/other": { mcpServers: { other: remote } },
    },
  });

  assert.deepEqual([...readMcpConfig(document, "claude-code").keys()], ["user"]);
  const local = readMcpConfig(document, "claude-code", { claudeProjectPath: "c:\\Code\\project" });
  assert.deepEqual([...local.keys()], ["current"]);
  assert.deepEqual(local.get("current")?.headers, remote.headers);
  assert.equal(readMcpConfig(document, "claude-code", { claudeProjectPath: "c:\\Code\\missing" }).size, 0);
});
