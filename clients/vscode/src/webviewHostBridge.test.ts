import { beforeEach, describe, expect, it, vi } from "vitest";

const policyState = vi.hoisted(() => ({
  snapshot: { synchronize: false } as Record<string, boolean>,
  listeners: new Set<() => void>(),
}));

const editor = vi.hoisted(() => ({
  writeText: vi.fn(async () => undefined),
  showInformationMessage: vi.fn(),
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn() },
  env: { clipboard: { writeText: editor.writeText } },
  window: { showInformationMessage: editor.showInformationMessage },
  l10n: { t: (message: string) => message },
}));
const jwt = vi.hoisted(() => ({
  refreshTenantJwt: vi.fn(async () => "fresh"),
  getTenantJwt: vi.fn(async () => "cached"),
  boundToken: vi.fn((token: string | undefined) => (token ? { token } : null)),
}));
vi.mock("./bfApi", () => jwt);
vi.mock("./errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./gateway", () => ({ getBaseUrl: () => "https://api.example", getWebBaseUrl: () => "https://web.example" }));
vi.mock("./localFirstStore", () => ({ localBrainApplication: () => ({ persistence: {}, store: {}, deviceId: "device-test" }) }));
const workRepo = vi.hoisted(() => ({ createLocalWorkRepository: vi.fn() }));
vi.mock("./localWorkRepository", () => workRepo);
vi.mock("./platformPolicy", () => ({
  platformInferenceMode: () => "hybrid",
  platformPolicy: () => ({
    snapshot: () => policyState.snapshot,
    subscribe: (listener: () => void) => {
      policyState.listeners.add(listener);
      return () => policyState.listeners.delete(listener);
    },
  }),
}));
vi.mock("./platformCallGate", () => ({
  assertPlatformSocketAllowed: () => undefined,
  platformSocketUrl: () => null,
  platformPolicyFrame: (baseUrl: string, webUrl: string) => ({
    type: "platform.policy",
    platformPolicy: { ...policyState.snapshot },
    baseUrl,
    webUrl,
  }),
}));

import { handleSharedHostMessage, watchedWebviewCount, webviewErrorLines } from "./webviewHostBridge";
import { logLine } from "./errorReporter";
import { UNKNOWN_PERSISTENCE_METHOD } from "./localPersistenceDispatch";

type Ctx = Parameters<typeof handleSharedHostMessage>[0];
type View = NonNullable<Parameters<typeof handleSharedHostMessage>[1]>;

function surface() {
  const posted: Array<{ type?: string }> = [];
  let disposeListener: (() => void) | undefined;
  const webview = { postMessage: vi.fn(async (message: { type?: string }) => { posted.push(message); return true; }) } as unknown as View;
  const owner = {
    onDidDispose(listener: () => void) {
      disposeListener = listener;
      return { dispose: () => { disposeListener = undefined; } };
    },
  };
  return { webview, owner, posted, dispose: () => disposeListener?.() };
}

const ctx = {} as Ctx;
const policyFrames = (posted: Array<{ type?: string }>) => posted.filter((message) => message.type === "platform.policy");
const changePolicy = (patch: Record<string, boolean>) => {
  policyState.snapshot = { ...policyState.snapshot, ...patch };
  for (const listener of [...policyState.listeners]) listener();
};

describe("webview host bridge policy push", () => {
  beforeEach(() => {
    policyState.snapshot = { synchronize: false };
  });

  it("publishes once on first contact and again only when the policy actually changes", async () => {
    const view = surface();
    for (let index = 0; index < 5; index += 1) {
      await handleSharedHostMessage(ctx, view.webview, { type: "something.else" }, view.owner);
    }
    expect(policyFrames(view.posted)).toHaveLength(1);

    changePolicy({});
    expect(policyFrames(view.posted)).toHaveLength(1);

    changePolicy({ synchronize: true });
    expect(policyFrames(view.posted)).toHaveLength(2);
    view.dispose();
  });

  it("forgets a webview when its owner is disposed", async () => {
    const before = watchedWebviewCount();
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "x" }, view.owner);
    expect(watchedWebviewCount()).toBe(before + 1);

    view.dispose();
    expect(watchedWebviewCount()).toBe(before);
    changePolicy({ gatewayInference: true });
    expect(policyFrames(view.posted)).toHaveLength(1);
  });
});

describe("token.refresh", () => {
  // The webview sends it on a 401. The cached token is unexpired by the client's clock,
  // so answering with it re-sent the token the gateway had just refused on every read.
  it("answers with a FRESH mint, never the cached token", async () => {
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "token.refresh", id: "t1" }, view.owner);
    expect(jwt.refreshTenantJwt).toHaveBeenCalledTimes(1);
    expect(jwt.getTenantJwt).not.toHaveBeenCalled();
    expect(view.posted).toContainEqual({ type: "response", id: "t1", ok: true, result: { token: "fresh" } });
    view.dispose();
  });

  it("answers null for a token that is not bound to the workspace in force (fails closed)", async () => {
    jwt.boundToken.mockReturnValueOnce(null);
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "token.refresh", id: "t2" }, view.owner);
    expect(view.posted).toContainEqual({ type: "response", id: "t2", ok: true, result: { token: null } });
    view.dispose();
  });
});

describe("local.persistence dispatch", () => {
  // The mocked host persistence is `{}` — the shape of the 2026.10.57 bug, where the
  // allowed name existed on the list and not on the object.
  const responses = (posted: Array<{ type?: string }>) =>
    posted.filter((message) => message.type === "response") as Array<{ ok: boolean; error?: string }>;

  it.each(["listChats", "toString", "constructor", "nope", 42, undefined])(
    "answers a method the host object cannot run (%s) with a typed refusal, never a TypeError",
    async (method) => {
      const view = surface();
      await handleSharedHostMessage(ctx, view.webview, { type: "local.persistence", id: "r1", method, args: [] } as never, view.owner);
      expect(responses(view.posted)).toEqual([expect.objectContaining({ ok: false, error: UNKNOWN_PERSISTENCE_METHOD })]);
      expect(responses(view.posted)[0]?.error).not.toMatch(/is not a function/);
      view.dispose();
    },
  );
});

describe("local.tickets dispatch", () => {
  // The webview asks on the `#` typeahead's offline path. A host whose local store is
  // missing/unreadable must still answer `[]`, never a refusal — an empty picker is a
  // correct "no local tickets".
  const ticketRows = [
    { id: 101, payload: { title: "First", status: "open" } },
    { id: 205, payload: { title: "Second", status: "done" } },
  ];

  it("answers with the live local tickets mapped to { id, title, status }", async () => {
    workRepo.createLocalWorkRepository.mockReturnValue({ listTickets: vi.fn(async () => ticketRows) });
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "local.tickets", id: "lt1" } as never, view.owner);
    expect(workRepo.createLocalWorkRepository).toHaveBeenCalledWith({ store: {}, deviceId: "device-test" });
    expect(view.posted).toContainEqual({
      type: "response",
      id: "lt1",
      ok: true,
      result: [
        { id: 101, title: "First", status: "open" },
        { id: 205, title: "Second", status: "done" },
      ],
    });
    view.dispose();
  });

  it("answers [] when the local store cannot serve tickets, never an error", async () => {
    workRepo.createLocalWorkRepository.mockImplementation(() => {
      throw new Error("no local store");
    });
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "local.tickets", id: "lt2" } as never, view.owner);
    expect(view.posted).toContainEqual({ type: "response", id: "lt2", ok: true, result: [] });
    view.dispose();
  });
});

describe("the root error fallback's host messages", () => {
  it("writes a webview error, with every stack, to the output channel", async () => {
    const view = surface();
    const handled = await handleSharedHostMessage(
      ctx,
      view.webview,
      { type: "webview.error", source: "render", message: "boom", stack: "Error: boom\n    at A", componentStack: "\n    in Chat" } as never,
      view.owner,
    );
    expect(handled).toBe(true);
    expect(logLine).toHaveBeenCalledWith("[webview error] render: boom\nError: boom\n    at A\ncomponent stack:\nin Chat");
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
    view.dispose();
  });

  it("formats a report with no stacks or message", () => {
    expect(webviewErrorLines({ type: "webview.error", source: "unhandledrejection" } as never)).toBe("[webview error] unhandledrejection: unknown error");
  });

  it("reloads by assigning the document back with a fresh nonce", async () => {
    const view = surface();
    const html = "<meta content=\"script-src 'nonce-abc123'\"><script nonce=\"abc123\"></script>";
    (view.webview as { html: string }).html = html;
    await handleSharedHostMessage(ctx, view.webview, { type: "webview.reload" }, view.owner);
    const next = (view.webview as { html: string }).html;
    expect(next).not.toBe(html);
    expect(next).not.toContain("abc123");
    view.dispose();
  });

  it("copies the details to the clipboard and confirms it", async () => {
    const view = surface();
    await handleSharedHostMessage(ctx, view.webview, { type: "webview.copy", text: "boom\n\nError: boom" } as never, view.owner);
    expect(editor.writeText).toHaveBeenCalledWith("boom\n\nError: boom");
    expect(editor.showInformationMessage).toHaveBeenCalledWith("Error details copied to clipboard.");
    view.dispose();
  });
});
