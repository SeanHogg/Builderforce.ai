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
  openDialog: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: { joinPath: (...parts: string[]) => parts.join("/"), parse: (uri: string) => uri, file: (path: string) => path },
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
  window: {
    showQuickPick: stubs.pick,
    showTextDocument: stubs.open,
    showErrorMessage: stubs.showError,
    showOpenDialog: stubs.openDialog,
  },
}));
vi.mock("../bfApi", () => ({
  listMcpExtensions: stubs.listRemote,
  listMcpConnectorCatalog: stubs.listCatalog,
}));
vi.mock("../platform/platformTools", () => ({ clearPlatformToolsCache: vi.fn() }));
vi.mock("../gateway/gateway", () => ({ getWebBaseUrl: () => "https://builderforce.example" }));

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

it("lists HTTP configurations without merging credential contexts or including their credentials in the picker", async () => {
  stubs.readFile.mockImplementation(async (uri) => {
    if (!uri.endsWith("/.mcp.json") && !uri.endsWith("/.claude.json")) throw new Error("file not found");
    return Buffer.from(JSON.stringify({
      mcpServers: {
        crm: { type: "http", url: "https://crm.example/mcp", headers: { Authorization: "Bearer ${input:token}" } },
      },
    }));
  });
  stubs.pick.mockImplementationOnce(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "local"));

  const ensureSignedIn = vi.fn();
  await manageMcpServers({} as never, ensureSignedIn);

  const picks = stubs.pick.mock.calls[0]?.[0] as Array<{ action: string; label: string }>;
  expect(picks.filter((pick) => pick.action === "local").map((pick) => pick.label)).toEqual(["$(plug) crm", "$(plug) crm"]);
  expect(JSON.stringify(picks)).not.toContain("${input:token}");
  expect(stubs.open).toHaveBeenCalledWith("/workspace/.mcp.json");
  expect(stubs.openExternal).not.toHaveBeenCalled();
  expect(ensureSignedIn).not.toHaveBeenCalled();
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

it("opens Platform setup for the chosen HTTP offer from the same connector catalog", async () => {
  stubs.listCatalog.mockResolvedValueOnce([{
    id: "http:github",
    name: "GitHub",
    transports: [{ transport: "http", connectorKey: "github" }],
  }]);
  stubs.pick
    .mockImplementationOnce(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "catalog"))
    .mockImplementationOnce(async (picks: unknown[]) => picks[0]);

  await manageMcpServers({} as never, async () => true);

  expect(stubs.openExternal).toHaveBeenCalledWith("https://builderforce.example/settings/integrations?connector=github");
  expect(stubs.openDialog).not.toHaveBeenCalled();
});

it("imports the selected Synapse launch into native review without asking for credentials", async () => {
  stubs.openDialog.mockResolvedValueOnce(["/workspace/connectors.json"]);
  stubs.readFile.mockImplementation(async (uri) => {
    if (!uri.endsWith("/connectors.json")) throw new Error("file not found");
    return Buffer.from(JSON.stringify([
      { id: "github-12", name: "GitHub", command: "node", args: ["server.js"], env: { MODE: "local" }, secretKeys: ["GITHUB_TOKEN"] },
      { id: "disabled-01", name: "Disabled", command: "node", enabled: false },
    ]));
  });
  stubs.pick
    .mockImplementationOnce(async (picks: Array<{ action: string }>) => picks.find((pick) => pick.action === "import"))
    .mockImplementationOnce(async (picks: unknown[]) => {
      expect(picks).toHaveLength(1);
      return picks[0];
    });
  const ensureSignedIn = vi.fn();
  await manageMcpServers({} as never, ensureSignedIn);

  const uri = stubs.openExternal.mock.calls[0]?.[0] as string;
  expect(JSON.parse(decodeURIComponent(uri.split("?")[1]!))).toEqual({
    name: "github-12",
    command: "node",
    args: ["server.js"],
    env: { MODE: "local", GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
  });
  expect(ensureSignedIn).not.toHaveBeenCalled();
  expect(stubs.command).not.toHaveBeenCalled();
});
