import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    onViewState: undefined as undefined | ((e: { webviewPanel: { visible: boolean } }) => void),
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
    visible: true,
    reveal: () => undefined,
    onDidDispose: (listener: () => void) => {
      state.onDispose = listener;
      return { dispose: () => undefined };
    },
    onDidChangeViewState: (listener: (e: { webviewPanel: { visible: boolean } }) => void) => {
      state.onViewState = listener;
      return { dispose: () => undefined };
    },
    dispose: () => {
      state.disposed = true;
      state.onDispose?.();
    },
  };
  return { state, webview, panel };
});

/** The editor events the panel follows: each subscription is recorded so a test can fire it and see it disposed. */
const editorEvents = vi.hoisted(() => {
  type Listener = (e: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string) => (listener: Listener) => {
    const set = listeners.get(name) ?? listeners.set(name, new Set()).get(name)!;
    set.add(listener);
    return { dispose: () => { set.delete(listener); } };
  };
  return {
    listeners,
    fire: (name: string, e: unknown) => { for (const l of [...(listeners.get(name) ?? [])]) l(e); },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    window: {
      onDidChangeTextEditorVisibleRanges: on("visible"),
      onDidChangeTextEditorSelection: on("selection"),
      onDidChangeActiveTextEditor: on("active"),
      activeTextEditor: undefined as unknown,
      visibleTextEditors: [] as unknown[],
    },
  };
});

vi.mock("vscode", () => ({
  window: Object.assign(editorEvents.window, { createWebviewPanel: () => host.panel }),
  ViewColumn: { Active: -1 },
  Uri: { joinPath: (...parts: unknown[]) => parts.join("/") },
  l10n: { t: (message: string) => message },
}));
vi.mock("../gateway/gateway", () => ({ getBaseUrl: () => "https://api.example" }));
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
vi.mock("../workspace/workspaceSession", () => ({ workspaceCanvasSession: async () => ({}) }));
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
  root: undefined as undefined | { rootId: string; title: string; rootPath: string; folderPath: string; rel: string },
}));
vi.mock("../knowledge/knowledgeBridge", () => ({
  setPendingKnowledgeFocus: () => undefined,
  KnowledgeBridge: class {
    constructor(opts: { post: (msg: unknown) => void }) {
      knowledge.post = opts.post;
    }
    handle = (call: unknown) => knowledge.handle(call);
    loadedRoot = () => knowledge.root;
    dispose = () => undefined;
  },
}));

import * as path from "node:path";
import { EDITOR_FEED_MS, VisualizationPanel } from "./visualizationPanel";
import { KNOWLEDGE_CALL, KNOWLEDGE_EDITOR } from "../knowledge/knowledgeProtocol";

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

describe("VisualizationPanel editor feed (knowledge.editor)", () => {
  const rootPath = path.resolve("/ws/app").replace(/\\/g, "/");
  const editorAt = (fsPath: string, first: number, last: number, cursor: number) => ({
    document: { uri: { scheme: "file", fsPath } },
    visibleRanges: [{ start: { line: first }, end: { line: last } }],
    selection: { active: { line: cursor } },
  });
  const inRoot = (rel: string, first: number, last: number, cursor: number) => editorAt(path.join(rootPath, rel), first, last, cursor);
  const editorFrames = () => host.state.posted.filter((m) => (m as { type?: string }).type === KNOWLEDGE_EDITOR);

  beforeEach(async () => {
    vi.useFakeTimers();
    host.state.disposed = false;
    knowledge.root = { rootId: "r1", title: "app", rootPath, folderPath: rootPath, rel: "" };
    await VisualizationPanel.open(ctx);
    // The feed's first look (no editor yet) settles before each test starts from a clean slate.
    vi.advanceTimersByTime(EDITOR_FEED_MS);
    host.state.posted = [];
  });

  afterEach(() => {
    if (!host.state.disposed) host.panel.dispose();
    vi.useRealTimers();
  });

  it("posts ONE trailing frame per window, carrying the last editor state in it (root-relative, 1-based)", () => {
    editorEvents.fire("visible", { textEditor: inRoot("src/a.ts", 0, 30, 4) });
    editorEvents.fire("selection", { textEditor: inRoot("src/a.ts", 10, 40, 12) });
    vi.advanceTimersByTime(EDITOR_FEED_MS - 1);
    expect(editorFrames()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(editorFrames()).toEqual([{ type: KNOWLEDGE_EDITOR, rootId: "r1", path: "src/a.ts", firstLine: 11, lastLine: 41, cursorLine: 13 }]);
  });

  it("posts nothing for a file outside the loaded root, nor a repeat of the last frame", () => {
    editorEvents.fire("visible", { textEditor: editorAt(path.resolve("/elsewhere/b.ts"), 0, 10, 0) });
    vi.advanceTimersByTime(EDITOR_FEED_MS);
    expect(editorFrames()).toEqual([]);
    editorEvents.fire("visible", { textEditor: inRoot("src/a.ts", 0, 10, 0) });
    vi.advanceTimersByTime(EDITOR_FEED_MS);
    editorEvents.fire("selection", { textEditor: inRoot("src/a.ts", 0, 10, 0) });
    vi.advanceTimersByTime(EDITOR_FEED_MS);
    expect(editorFrames()).toHaveLength(1);
  });

  it("stops listening while the panel is hidden", () => {
    host.state.onViewState?.({ webviewPanel: { visible: false } });
    expect(editorEvents.count()).toBe(0);
    host.state.onViewState?.({ webviewPanel: { visible: true } });
    expect(editorEvents.count()).toBe(3);
  });

  it("disposes its listeners and its pending post with the panel", () => {
    editorEvents.fire("visible", { textEditor: inRoot("src/a.ts", 0, 30, 4) });
    host.panel.dispose();
    expect(editorEvents.count()).toBe(0);
    vi.advanceTimersByTime(EDITOR_FEED_MS);
    expect(editorFrames()).toEqual([]);
  });
});
