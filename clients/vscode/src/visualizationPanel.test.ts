import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The panel as VS Code's ext host builds it: once disposed, the `webview` getter
 * THROWS ("Webview is disposed"), while `postMessage` on an already-captured webview
 * just resolves false. A late post that re-reads `panel.webview` is the production crash.
 */
const host = vi.hoisted(() => {
  const state = {
    disposed: false,
    onDispose: undefined as undefined | (() => void),
    onMessage: undefined as undefined | ((m: unknown) => void),
    posted: [] as unknown[],
  };
  const webview = {
    html: "",
    cspSource: "",
    postMessage: async (message: unknown) => {
      if (state.disposed) return false;
      state.posted.push(message);
      return true;
    },
    onDidReceiveMessage: (listener: (m: unknown) => void) => {
      state.onMessage = listener;
      return { dispose: () => undefined };
    },
  };
  const panel = {
    get webview() {
      if (state.disposed) throw new Error("Webview is disposed");
      return webview;
    },
    iconPath: undefined as unknown,
    reveal: () => undefined,
    onDidDispose: (listener: () => void) => {
      state.onDispose = listener;
      return { dispose: () => undefined };
    },
    onDidChangeViewState: () => ({ dispose: () => undefined }),
    dispose: () => {
      state.disposed = true;
      state.onDispose?.();
    },
  };
  return { state, webview, panel };
});

vi.mock("vscode", () => ({
  window: { createWebviewPanel: () => host.panel },
  ViewColumn: { Active: -1 },
  Uri: { joinPath: (...parts: unknown[]) => parts.join("/") },
  l10n: { t: (message: string) => message },
}));
vi.mock("./gateway", () => ({ getBaseUrl: () => "https://api.example" }));
vi.mock("./errorReporter", () => ({ logLine: vi.fn(), reportExtensionError: vi.fn(async () => undefined) }));
vi.mock("./webviewBundleShell", () => ({ makeNonce: () => "n", renderBundleShell: () => "<html></html>" }));
vi.mock("./webviewHostBridge", () => ({
  handleSharedHostMessage: async () => false,
  postToWebview: (webview: { postMessage(m: unknown): Promise<boolean> } | undefined, msg: unknown) => {
    void webview?.postMessage(msg);
  },
  respondToWebview: (webview: { postMessage(m: unknown): Promise<boolean> } | undefined, id: string | undefined, ok: boolean, result?: unknown, error?: string) => {
    if (id) void webview?.postMessage({ type: "response", id, ok, result, ...(error ? { error } : {}) });
  },
}));
vi.mock("./workspaceSession", () => ({ workspaceCanvasSession: async () => ({}) }));
vi.mock("./workspaceSurface", () => ({
  WorkspaceSurface: class {
    handle = async () => undefined;
    dispose = () => undefined;
  },
}));
vi.mock("./visualizationInitFrame", () => ({ asVisualizationFrame: (frame: unknown) => frame }));
const knowledge = vi.hoisted(() => ({
  post: undefined as undefined | ((msg: unknown) => void),
  handle: vi.fn<(call: unknown) => Promise<unknown>>(async () => "ok"),
}));
vi.mock("./knowledge/knowledgeBridge", () => ({
  setPendingKnowledgeFocus: () => undefined,
  KnowledgeBridge: class {
    constructor(opts: { post: (msg: unknown) => void }) {
      knowledge.post = opts.post;
    }
    handle = (call: unknown) => knowledge.handle(call);
    dispose = () => undefined;
  },
}));

import { VisualizationPanel } from "./visualizationPanel";
import { KNOWLEDGE_CALL } from "./knowledge/knowledgeProtocol";

const ctx = { extensionUri: "ext" } as never;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("VisualizationPanel after its panel is disposed", () => {
  beforeEach(async () => {
    host.state.disposed = false;
    host.state.posted = [];
    knowledge.handle.mockReset();
    await VisualizationPanel.open(ctx);
  });

  it("regression: a knowledge review event that outlives the panel does not throw 'Webview is disposed'", () => {
    host.panel.dispose();
    expect(() => knowledge.post?.({ type: "knowledge.event", stream: "s1" })).not.toThrow();
  });

  it("regression: a knowledge call answered after the panel closed replies on the captured webview", async () => {
    let finish: (value: unknown) => void = () => undefined;
    knowledge.handle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const respond = vi.spyOn(host.webview, "postMessage");
    host.state.onMessage?.({ type: KNOWLEDGE_CALL, id: "k1", op: "run" });
    await flush();
    host.panel.dispose();
    finish("report");
    await flush();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ type: "response", id: "k1", ok: true }));
    respond.mockRestore();
  });

  it("regression: a message dispatched after teardown is dropped, never handed to the subclass", async () => {
    host.panel.dispose();
    host.state.onMessage?.({ type: KNOWLEDGE_CALL, id: "k2", op: "run" });
    await flush();
    expect(knowledge.handle).not.toHaveBeenCalled();
  });

  it("regression: an openKnowledge focus post on a panel VS Code already disposed does not throw", async () => {
    // The ext host marks the panel disposed (its `webview` getter throws) before our
    // dispose listener runs; the focus post must use the captured webview.
    host.state.disposed = true;
    await expect(VisualizationPanel.openKnowledge(ctx, { focus: [] } as never)).resolves.toBeUndefined();
    host.panel.dispose();
  });
});
