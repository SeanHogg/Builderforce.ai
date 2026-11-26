import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { registerWorkspaceMcp } from "./registerWorkspaceMcp";
import { startWorkspaceMcpListener } from "./workspaceMcpListener";

const mock = vi.hoisted(() => ({
  trusted: false,
  folderChange: undefined as (() => void) | undefined,
  trustGranted: undefined as (() => void) | undefined,
  provider: undefined as vscode.McpServerDefinitionProvider | undefined,
  changed: vi.fn(),
  disposeListener: vi.fn(),
}));

vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = mock.changed; dispose() {} },
  McpHttpServerDefinition: class {
    constructor(readonly label: string, readonly uri: string, readonly headers: Record<string, string>) {}
  },
  Uri: { parse: (value: string) => value },
  l10n: { t: (value: string) => value },
  lm: {
    registerMcpServerDefinitionProvider: (id: string, provider: vscode.McpServerDefinitionProvider) => {
      expect(id).toBe("builderforce.workspace");
      mock.provider = provider;
      return { dispose() {} };
    },
  },
  workspace: {
    get isTrusted() { return mock.trusted; },
    workspaceFolders: [{ uri: { scheme: "file", fsPath: process.cwd() } }],
    onDidChangeWorkspaceFolders(fn: () => void) { mock.folderChange = fn; return { dispose() {} }; },
    onDidGrantWorkspaceTrust(fn: () => void) { mock.trustGranted = fn; return { dispose() {} }; },
  },
}));
vi.mock("./workspaceMcpListener", () => ({
  startWorkspaceMcpListener: vi.fn(async () => ({
    url: "http://127.0.0.1:4321/mcp",
    authorization: "Bearer test",
    dispose: mock.disposeListener,
  })),
}));

describe("Workspace MCP provider lifecycle", () => {
  it("waits for trust, starts one listener for concurrent discovery, and disposes it", async () => {
    const subscriptions: vscode.Disposable[] = [];
    registerWorkspaceMcp({ subscriptions } as unknown as vscode.ExtensionContext);
    const provide = mock.provider!.provideMcpServerDefinitions;
    const token = { isCancellationRequested: false } as vscode.CancellationToken;
    expect(await provide(token)).toEqual([]);
    expect(startWorkspaceMcpListener).not.toHaveBeenCalled();

    mock.trusted = true;
    mock.trustGranted?.();
    mock.folderChange?.();
    expect(mock.changed).toHaveBeenCalledTimes(2);
    const [first, second] = await Promise.all([provide(token), provide(token)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject([{
      uri: "http://127.0.0.1:4321/mcp",
      headers: { Authorization: "Bearer test" },
    }]);
    expect(startWorkspaceMcpListener).toHaveBeenCalledTimes(1);
    for (const subscription of subscriptions) subscription.dispose();
    await Promise.resolve();
    expect(mock.disposeListener).toHaveBeenCalledOnce();
    expect(await provide(token)).toEqual([]);
  });
});
