/**
 * An attachment's whole round trip through the REAL bridge envelope: the webview's
 * persistence adapter → `bridgeTransport.request` → the frame `postMessage` carries →
 * `WorkspaceSurface.handle`'s switch → the host's attachment ingress → the `response`
 * frame back through the webview's `message` listener.
 *
 * A fake ingress port cannot catch the bug this pins: the upload payload once named the
 * MIME type `type`, which overwrote the frame's envelope `type`, so the host switch never
 * matched `attachment.ingress` and the request hung for its 300 s timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const target = new EventTarget();
  const posted: Array<Record<string, unknown>> = [];
  const state = { toHost: (_m: Record<string, unknown>): void => undefined };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = target;
  g.acquireVsCodeApi = () => ({
    postMessage: (m: Record<string, unknown>) => {
      posted.push(m);
      state.toHost(m);
    },
    getState: () => undefined,
    setState: () => undefined,
  });
  return { target, posted, state };
});

const ingressPorts = vi.hoisted(() => ({
  admit: vi.fn(),
  upload: vi.fn(async (f: { name: string; mime: string; bytes: Uint8Array }) => ({ key: `7/u/${f.name}`, name: f.name, type: f.mime, url: `https://api/api/brain/uploads/7/u/${f.name}` })),
}));

vi.mock("vscode", () => ({
  window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }), showWarningMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
  l10n: { t: (s: string) => s },
}));
vi.mock("./bfApi", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("./gateway", () => ({ getWebBaseUrl: () => "https://web" }));
vi.mock("./personalityLimbic", () => ({ turnLimbicBlock: vi.fn() }));
vi.mock("./chatDeletion", () => ({ confirmChatDelete: vi.fn() }));
vi.mock("./editorContext", () => ({ getEditorContext: vi.fn(), watchEditorContext: () => ({ dispose() {} }) }));
vi.mock("./gitChanges", () => ({ detectPendingChanges: vi.fn(), detectPendingDiff: vi.fn(), watchPendingChanges: () => ({ dispose() {} }) }));
vi.mock("./modelState", () => ({ setSelectedModel: vi.fn(), setSelectedModelPool: vi.fn() }));
vi.mock("./pageEngineBridge", () => ({ hostPageEngines: { attach: () => () => undefined } }));
vi.mock("./canvasHostActions", () => ({ captureFromEditor: vi.fn(), navigateFromCanvas: vi.fn(), openCapturedFile: vi.fn() }));
vi.mock("./workspaceInit", () => ({ buildWorkspaceInit: vi.fn() }));
vi.mock("./contextPicker", () => ({ pickWorkspaceContext: vi.fn() }));
vi.mock("./localFetchProxy", () => ({
  LocalFetchProxy: class {
    dispose(): void {}
    fetch(): void {}
    abort(): void {}
  },
}));
// The host's two frame writers, as `webviewHostBridge.ts` writes them (that module pulls
// the whole local-first store in, which this test has no use for).
vi.mock("./webviewHostBridge", () => ({
  postToWebview: (webview: { postMessage(m: unknown): unknown } | undefined, msg: unknown) => void webview?.postMessage(msg),
  respondToWebview: (webview: { postMessage(m: unknown): unknown } | undefined, id: string | undefined, ok: boolean, result?: unknown, error?: string) => {
    if (!id || !webview) return;
    void webview.postMessage({ type: "response", id, ok, result, ...(error ? { error } : {}) });
  },
}));
// The REAL ingress (`attachmentIngress.ts`) behind the surface; only its network is faked.
vi.mock("./hostIngress", async () => {
  const { createAttachmentIngress } = await vi.importActual<typeof import("./attachmentIngress")>("./attachmentIngress");
  const { mentionBudget } = await import("@builderforce/tool-output-policy");
  const ingress = createAttachmentIngress({
    admit: ingressPorts.admit,
    upload: ingressPorts.upload,
    sign: async (key) => `https://signed/${key}`,
    budget: async () => mentionBudget("cloud"),
    textTooLarge: (name) => `${name} is too large`,
  });
  return { hostAttachmentIngress: () => ingress };
});

import { WorkspaceSurface } from "./workspaceSurface";
import { request } from "../webview/src/bridgeTransport";
import { createHostPersistence } from "../webview/src/hostPersistence";

/** A surface whose webview delivers each host frame to the webview's `message` listener. */
function mountSurface(): WorkspaceSurface {
  const webview = {
    postMessage: async (m: unknown) => {
      env.target.dispatchEvent(new MessageEvent("message", { data: m }));
      return true;
    },
  };
  const surface = new WorkspaceSurface({ secrets: {} } as never, { webview, owner: {} } as never, {} as never, "chat");
  env.state.toHost = (m) => void surface.handle(m as never);
  return surface;
}

describe("an attachment through the real bridge envelope", () => {
  let surface: WorkspaceSurface;
  beforeEach(() => {
    env.posted.length = 0;
    ingressPorts.admit.mockClear();
    ingressPorts.upload.mockClear();
    surface = mountSurface();
  });
  afterEach(() => surface.dispose());

  it("uploads a PDF: every frame stays `attachment.ingress`, and the host receives its MIME type", async () => {
    const saved = await createHostPersistence().upload(new File([new Uint8Array([37, 80, 68, 70, 0])], "a.pdf", { type: "application/pdf" }));
    expect(saved).toEqual({ key: "7/u/a.pdf", name: "a.pdf", type: "application/pdf" });
    expect(env.posted.map((m) => [m.type, m.op])).toEqual([["attachment.ingress", "admit"], ["attachment.ingress", "upload"]]);
    expect(ingressPorts.admit).toHaveBeenCalledWith({ name: "a.pdf", mime: "application/pdf", size: 5 });
    expect(ingressPorts.upload.mock.calls[0]![0]).toMatchObject({ name: "a.pdf", mime: "application/pdf" });
  });

  it("answers a refusal with the host's sentence, not a timeout", async () => {
    ingressPorts.admit.mockImplementationOnce(() => { throw new Error("Local only is on, so a.pdf stays on this machine"); });
    await expect(createHostPersistence().upload(new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }))).rejects.toThrow("Local only is on");
    expect(ingressPorts.upload).not.toHaveBeenCalled();
  });

  it("never lets a payload field re-address the frame", async () => {
    const answer = await request<{ ok: boolean }>("attachment.ingress", { type: "application/pdf", op: "admit", name: "a.pdf", mime: "application/pdf", size: 1 });
    expect(answer).toEqual({ ok: true });
    expect(env.posted.at(-1)!.type).toBe("attachment.ingress");
  });
});
