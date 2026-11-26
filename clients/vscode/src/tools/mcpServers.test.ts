import { beforeEach, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  listRemote: vi.fn(async () => []),
  readFile: vi.fn<(uri: string) => Promise<Uint8Array>>(),
  pick: vi.fn(),
  open: vi.fn(),
  command: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: { joinPath: (...parts: string[]) => parts.join("/") },
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
  window: { showQuickPick: stubs.pick, showTextDocument: stubs.open, showErrorMessage: stubs.showError },
}));
vi.mock("../bfApi", () => ({ listMcpExtensions: stubs.listRemote }));
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
  stubs.pick.mockImplementation(async (picks: Array<{ kind: string }>) => picks.find((pick) => pick.kind === "local"));

  await manageMcpServers({} as never, ensureSignedIn);

  const picks: Array<{ kind: string }> = stubs.pick.mock.calls[0]?.[0];
  expect(picks.filter((pick) => pick.kind === "local")).toHaveLength(1);
  expect(stubs.open).toHaveBeenCalledWith("/workspace/.vscode/mcp.json");
  expect(ensureSignedIn).not.toHaveBeenCalled();
  expect(stubs.command).not.toHaveBeenCalled();
});

it("opens the native MCP manager when the tenant catalog is unavailable", async () => {
  stubs.listRemote.mockRejectedValueOnce(new Error("HTTP 403"));
  stubs.pick.mockImplementation(async (picks: Array<{ kind: string }>) => picks.find((pick) => pick.kind === "native"));

  await manageMcpServers({} as never, async () => false);

  expect(stubs.command).toHaveBeenCalledWith("workbench.mcp.listServer");
});
