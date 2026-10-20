import { beforeEach, describe, expect, it, vi } from "vitest";

const policyState = vi.hoisted(() => ({
  snapshot: { synchronize: false } as Record<string, boolean>,
  listeners: new Set<() => void>(),
}));

vi.mock("vscode", () => ({ commands: { executeCommand: vi.fn() } }));
vi.mock("./bfApi", () => ({ getTenantJwt: async () => null }));
vi.mock("./errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./gateway", () => ({ getBaseUrl: () => "https://api.example", getWebBaseUrl: () => "https://web.example" }));
vi.mock("./localFirstStore", () => ({ localBrainApplication: () => ({ persistence: {} }) }));
vi.mock("./platformPolicy", () => ({
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

import { handleSharedHostMessage, watchedWebviewCount } from "./webviewHostBridge";

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
