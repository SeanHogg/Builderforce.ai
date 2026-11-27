import assert from "node:assert/strict";
import test from "node:test";
import { advertiseName, isRemoteMcpEndpoint, platformWireToolName, relayDispatchCatalog, relayModelText, toolWireNameCodec, toRelayModelTool } from "../dist/index.js";
import { readMcpConfig, readSynapseConnectors, writeMcpConfig } from "../dist/config.js";

test("remote MCP registration requires a complete HTTPS URL without embedded credentials", () => {
  assert.equal(isRemoteMcpEndpoint(" https://mcp.example.com/mcp "), true);
  for (const invalid of ["https://", "https://a b/mcp", "http://mcp.example.com", "https://user:pass@mcp.example.com"]) {
    assert.equal(isRemoteMcpEndpoint(invalid), false, invalid);
  }
});

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
  assert.equal(platformWireToolName({ extensionId: "builtin", tool: "tasks.list" }), "platform__tasks_list");
  assert.equal(platformWireToolName({ extensionId: "remote", tool: "tasks.list" }), undefined);
  assert.equal(platformWireToolName({ extensionId: "builtin", tool: "tasks." + "a".repeat(64) }), undefined);
});

test("relay dispatch keeps unique aliases and distinguishes tools with a shared legacy spelling", () => {
  const metadata = { extensionId: "remote", description: "", parameters: {} };
  const sharedAlias = "mcp_remote_find_it";
  const longAlias = "mcp_remote_" + "a".repeat(72);
  const [first, second, long] = relayDispatchCatalog([
    { ...metadata, tool: "find-it", name: "ext-remote__find-it", legacyName: sharedAlias },
    { ...metadata, tool: "find_it", name: "ext-remote__find_it", legacyName: sharedAlias },
    { ...metadata, tool: "long", name: "catalog__cafe", legacyName: longAlias },
  ]);
  assert.deepEqual([first.name, second.name, long.name], ["ext-remote__find-it", "ext-remote__find_it", longAlias]);
  const codec = toolWireNameCodec([first.name, second.name, long.name], [long]);
  assert.equal(codec.toWire(longAlias), "catalog__cafe");
  assert.equal(codec.fromWire("catalog__cafe"), longAlias);
  assert.equal(codec.mapPrompt(`Call ${longAlias} now`), "Call catalog__cafe now");
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
