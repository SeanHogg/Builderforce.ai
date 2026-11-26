import { beforeEach, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  listRemote: vi.fn(async () => []),
  listCatalog: vi.fn(),
  readFile: vi.fn<(uri: string) => Promise<Uint8Array>>(),
  pick: vi.fn(),
  open: vi.fn(),
  command: vi.fn(),
  openExternal: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: { joinPath: (...parts: string[]) => parts.join("/"), parse: (uri: string) => uri },
  workspace: {
    workspaceFolders: [{ uri: "/workspace" }],
    asRelativePath: (uri: string) => uri.slice("/workspace/".length),
    fs: { readFile: stubs.readFile },
  },
  commands: {
    getCommands: async () => ["workbench.mcp.listServer"],
    executeCommand: stubs.command,
  },
  l10n: { t: (text: string) => text },
  env: { uriScheme: "vscode", openExternal: stubs.openExternal },
  window: { showQuickPick: stubs.pick, showTextDocument: stubs.open, showErrorMessage: stubs.showError },
}));
vi.mock("../bfApi", () => ({
  listMcpExtensions: stubs.listRemote,
  listMcpConnectorCatalog: stubs.listCatalog,
}));
vi.mock("../platform/platformTools", () => ({ clearPlatformToolsCache: vi.fn() }));

import { manageMcpServers } from "./mcpServers";

beforeEach(() => {
  vi.clearAllMocks();
  stubs.listRemote.mockResolvedValue([]);
  stubs.readFile.mockImplementation(async (uri) => {
    const remoteOrLocal = '"local": { "command": "node", "args": ["mcp.mjs"] }';
    if (uri.endsWith(".vscode/mcp.json")) return Buffer.from(`{ "servers": { ${remoteOrLocal} } }`);
    if (uri.endsWith(".mcp.json")) return Buffer.from(`{ "mcpServers": { ${remoteOrLocal} } }`);
    throw new Error("file not found");
  });
});

it("opens a deduplicated workspace config without signing in or starting its command", async () => {
  const ensureSignedIn = vi.fn(async () => false);
  stubs.pick.mockImplementation(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "local"));

  await manageMcpServers({} as never, ensureSignedIn);

  const picks: Array<{ action: string }> = stubs.pick.mock.calls[0]?.[0];
  expect(picks.filter((pick) => pick.action === "local")).toHaveLength(1);
  expect(stubs.open).toHaveBeenCalledWith("/workspace/.vscode/mcp.json");
  expect(ensureSignedIn).not.toHaveBeenCalled();
  expect(stubs.command).not.toHaveBeenCalled();
});

it("opens the native MCP manager when the tenant catalog is unavailable", async () => {
  stubs.listRemote.mockRejectedValueOnce(new Error("HTTP 403"));
  stubs.pick.mockImplementation(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "native"));

  await manageMcpServers({} as never, async () => false);

  expect(stubs.command).toHaveBeenCalledWith("workbench.mcp.listServer");
});

it("passes the chosen connector to native review with environment references", async () => {
  stubs.listCatalog.mockResolvedValueOnce([{
    id: "github",
    name: "GitHub",
    transports: [
      { transport: "http", connectorKey: "github" },
      { transport: "stdio", npx: ["@modelcontextprotocol/server-github"], inputs: [{ kind: "secret", key: "GITHUB_PERSONAL_ACCESS_TOKEN" }] },
    ],
  }]);
  stubs.pick
    .mockImplementationOnce(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "catalog"))
    .mockImplementationOnce(async (picks: unknown[]) => picks[0]);

  await manageMcpServers({} as never, async () => true);

  expect(stubs.openExternal).toHaveBeenCalledOnce();
  const uri = stubs.openExternal.mock.calls[0]?.[0] as string;
  expect(uri).toMatch(/^vscode:mcp\/install\?/);
  expect(JSON.parse(decodeURIComponent(uri.split("?")[1]!))).toEqual({
    name: "github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}" },
  });
  expect(stubs.command).not.toHaveBeenCalled();
});
