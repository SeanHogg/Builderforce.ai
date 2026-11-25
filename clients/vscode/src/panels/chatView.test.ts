import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Meta = (chatId: number | undefined, title: string | undefined) => void;
type FakeSurface = {
  host: { onSessionMeta?: Meta };
  intent: unknown;
  handle: ReturnType<typeof vi.fn>;
  sendIntent: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({
  provider: undefined as undefined | { resolveWebviewView(view: unknown): void },
  surfaces: [] as FakeSurface[],
  /** One pending board lookup per resolved view, settled by the test. */
  lookups: [] as Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>,
  shared: { calls: 0 },
}));
const notices = vi.hoisted(() => ({ warn: vi.fn(async () => undefined) }));
const reporter = vi.hoisted(() => ({ reportExtensionError: vi.fn(async () => undefined), logLine: vi.fn() }));

vi.mock("vscode", () => ({
  version: "1.110.0",
  commands: { executeCommand: vi.fn(async () => undefined) },
  window: {
    registerWebviewViewProvider: (_id: string, provider: { resolveWebviewView(view: unknown): void }) => {
      registry.provider = provider;
      return { dispose: () => undefined };
    },
    showWarningMessage: notices.warn,
  },
  Uri: { joinPath: (...parts: unknown[]) => parts.join("/") },
  l10n: { t: (message: string) => message },
}));
vi.mock("../diagnostics/errorReporter", () => reporter);
vi.mock("./webviewShared", () => ({ renderWebviewHtml: () => "<html></html>" }));
vi.mock("./webviewHostBridge", () => ({
  handleSharedHostMessage: async () => {
    registry.shared.calls += 1;
    return false;
  },
}));
vi.mock("../workspace/workspaceSession", () => ({
  workspaceCanvasSession: () => new Promise((resolve, reject) => { registry.lookups.push({ resolve, reject }); }),
}));
vi.mock("../workspace/workspaceSurface", () => ({
  WorkspaceSurface: class {
    handle = vi.fn(async () => undefined);
    sendIntent = vi.fn();
    refresh = () => undefined;
    dispose = () => undefined;
    constructor(
      _ctx: unknown,
      readonly host: { onSessionMeta?: Meta },
      _session: unknown,
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastLookup = () => registry.lookups[registry.lookups.length - 1]!;
const intent = { kind: "seed", text: "hello" } as never;

describe("chat view after its view is disposed", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

  beforeEach(() => {
    registry.surfaces.length = 0;
    registry.lookups.length = 0;
    registry.shared.calls = 0;
    unhandled.length = 0;
    notices.warn.mockClear();
    reporter.reportExtensionError.mockClear();
    process.on("unhandledRejection", onUnhandled);
    registerChatView(ctx);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("regression: a session-meta update after dispose does not write the dead view's description", async () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    lastLookup().resolve({});
    await flush();
    const meta = registry.surfaces[0]?.host.onSessionMeta;
    expect(meta).toBeTypeOf("function");
    meta?.(1, "Live chat");
    expect(view.description).toBe("Live chat");

    view.dispose();
    expect(() => meta?.(1, "Late title")).not.toThrow();
    expect(view.description).toBe("Live chat");
  });

  it("regression: a view closed before the board lookup answers never builds a surface", async () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    view.dispose();
    lastLookup().resolve({});
    await flush();
    expect(registry.surfaces).toHaveLength(0);
  });

  it("regression: a message that arrives after dispose reaches neither the bridge nor the surface", async () => {
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    lastLookup().resolve({});
    await flush();
    view.dispose();
    await view.send({ type: "ready" });
    expect(registry.shared.calls).toBe(0);
    expect(registry.surfaces[0]?.handle).not.toHaveBeenCalled();
  });

  it("regression: a failed board lookup is reported, rejects nothing, and keeps the pending intent", async () => {
    await revealChatView(intent);
    const view = fakeView();
    registry.provider?.resolveWebviewView(view);
    const message = view.send({ type: "ready" });
    lastLookup().reject(new Error("network denied"));
    await message;
    await flush();
    expect(unhandled).toEqual([]);
    expect(registry.surfaces).toHaveLength(0);
    expect(reporter.reportExtensionError).toHaveBeenCalledWith(expect.any(Error), { operation: "chatView.resolveSession" });
    expect(notices.warn).toHaveBeenCalledTimes(1);

    // The intent was not spent on the failed lookup: the next view's surface opens with it.
    view.dispose();
    registry.provider?.resolveWebviewView(fakeView());
    lastLookup().resolve({});
    await flush();
    expect(registry.surfaces[0]?.intent).toBe(intent);
  });

  it("regression: an intent delivered while the lookup is in flight survives that view closing", async () => {
    const first = fakeView();
    registry.provider?.resolveWebviewView(first);
    await revealChatView(intent);
    first.dispose();
    lastLookup().resolve({});
    await flush();
    expect(registry.surfaces).toHaveLength(0);

    registry.provider?.resolveWebviewView(fakeView());
    lastLookup().resolve({});
    await flush();
    expect(registry.surfaces).toHaveLength(1);
    expect(registry.surfaces[0]?.intent).toBe(intent);
    expect(unhandled).toEqual([]);
  });
});
