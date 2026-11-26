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
