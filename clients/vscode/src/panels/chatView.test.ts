import { beforeEach, describe, expect, it, vi } from "vitest";

type Meta = (chatId: number | undefined, title: string | undefined) => void;
type FakeSurface = {
  host: { onSessionMeta?: Meta };
  intent: unknown;
  session: unknown;
  handle: ReturnType<typeof vi.fn>;
  sendIntent: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({
  provider: undefined as undefined | { resolveWebviewView(view: unknown): void },
  surfaces: [] as FakeSurface[],
  lookup: vi.fn(() => new Promise(() => {})),
  shared: { calls: 0 },
}));

vi.mock("vscode", () => ({
  version: "1.110.0",
  commands: { executeCommand: vi.fn(async () => undefined) },
  window: {
    registerWebviewViewProvider: (_id: string, provider: { resolveWebviewView(view: unknown): void }) => {
      registry.provider = provider;
      return { dispose: () => undefined };
    },
  },
  Uri: { joinPath: (...parts: unknown[]) => parts.join("/") },
  l10n: { t: (message: string) => message },
}));
vi.mock("./webviewShared", () => ({ renderWebviewHtml: () => "<html></html>" }));
vi.mock("./webviewHostBridge", () => ({
  handleSharedHostMessage: async () => {
    registry.shared.calls += 1;
    return false;
  },
}));
vi.mock("../workspace/workspaceSession", () => ({
  workspaceCanvasSession: registry.lookup,
}));
vi.mock("../workspace/workspaceSurface", () => ({
  WorkspaceSurface: class {
    handle = vi.fn(async () => undefined);
    sendIntent = vi.fn();
    refresh = () => undefined;
    dispose = vi.fn();
    constructor(
      _ctx: unknown,
      readonly host: { onSessionMeta?: Meta },
      readonly session: unknown,
      _surface: unknown,
      readonly intent: unknown,
    ) {
      registry.surfaces.push(this as unknown as FakeSurface);
    }
  },
}));

import { registerChatView, revealChatView } from "./chatView";

/** A WebviewView as the ext host builds it: `webview` and `description` THROW once disposed. */
function fakeView() {
  let disposed = false;
  let onDispose: (() => void) | undefined;
  let onMessage: ((m: unknown) => Promise<void>) | undefined;
  let description: string | undefined;
  const webview = {
    options: {},
    html: "",
    postMessage: async () => !disposed,
    onDidReceiveMessage: (listener: (m: unknown) => Promise<void>) => {
      onMessage = listener;
      return { dispose: () => undefined };
    },
  };
  return {
    visible: true,
    get webview() {
      if (disposed) throw new Error("Webview is disposed");
      return webview;
    },
    get description() {
      return description;
    },
    set description(value: string | undefined) {
      if (disposed) throw new Error("Webview is disposed");
      description = value;
    },
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: (listener: () => void) => {
      onDispose = listener;
      return { dispose: () => undefined };
    },
    dispose: () => {
      disposed = true;
      onDispose?.();
    },
    /** What the webview would send — the listener the view registered. */
    send: (m: unknown) => onMessage?.(m),
  };
}

const ctx = { extensionUri: "ext", subscriptions: [] as unknown[] } as never;
const intent = { kind: "seed", text: "hello" } as never;

describe("sidebar chat view", () => {
  beforeEach(() => {
    registry.surfaces.length = 0;
    registry.lookup.mockClear();
    registry.shared.calls = 0;
    registerChatView(ctx);
  });

  it("handles ready without looking up or creating a board", async () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    expect(registry.lookup).not.toHaveBeenCalled();
    expect(registry.surfaces[0]?.session).toBeUndefined();
    await view.send({ type: "ready" });
    expect(registry.surfaces[0]?.handle).toHaveBeenCalledWith({ type: "ready" });
  });

  it("ignores session-meta updates after disposal", () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    const meta = registry.surfaces[0]?.host.onSessionMeta;
    expect(meta).toBeTypeOf("function");
    meta?.(1, "Live chat");
    expect(view.description).toBe("Live chat");

    view.dispose();
    expect(() => meta?.(1, "Late title")).not.toThrow();
    expect(view.description).toBe("Live chat");
  });

  it("disposes the surface and ignores messages after disposal", async () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    view.dispose();
    expect(registry.surfaces[0]?.dispose).toHaveBeenCalledOnce();
    await view.send({ type: "ready" });
    expect(registry.shared.calls).toBe(0);
    expect(registry.surfaces[0]?.handle).not.toHaveBeenCalled();
  });

  it("passes a pending intent to the next view and sends later intents to the live view", async () => {
    await revealChatView(intent);
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    expect(registry.surfaces[0]?.intent).toBe(intent);
    await revealChatView(intent);
    expect(registry.surfaces[0]?.sendIntent).toHaveBeenCalledWith(intent);

    view.dispose();
    await revealChatView(intent);
    registry.provider?.resolveWebviewView(fakeView());
    expect(registry.surfaces[1]?.intent).toBe(intent);
  });
});
