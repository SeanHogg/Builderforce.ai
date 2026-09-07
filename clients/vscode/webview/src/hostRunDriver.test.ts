import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The panel's end of the host-owned run, where "several chats at once" is decided.
 *
 * Runs execute in the extension host precisely so the user can switch chats — or close
 * the tab — without stopping the work behind them. That makes every panel-wide value a
 * hazard: the Auto-mode switch used to apply to every live run (so turning it on to
 * unblock one refactor also said yes to whatever another conversation was parked on),
 * and the host's tool-count announcement lands on ONE module-level slot the diagnostics
 * report reads. Both are matched against the chat this panel is showing here.
 */

type Listener = (e: { data: unknown }) => void;

let posted: Array<Record<string, unknown>>;
let listeners: Listener[];

/** Deliver a host→webview frame to the module's message listener. */
function fromHost(frame: Record<string, unknown>): void {
  for (const listener of listeners) listener({ data: frame });
}

const autoApproveFrames = (): Array<Record<string, unknown>> => posted.filter((m) => m.type === "run.autoApprove");

beforeEach(() => {
  posted = [];
  listeners = [];
  vi.resetModules();
  const stub = {
    addEventListener: (type: string, cb: Listener) => { if (type === "message") listeners.push(cb); },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: Record<string, unknown>) => { posted.push(m); },
    getState: () => undefined,
    setState: () => {},
  });
});

async function load() {
  return {
    driver: await import("./hostRunDriver"),
    brain: await import("@seanhogg/builderforce-brain-embedded"),
  };
}

describe("the Auto-mode switch", () => {
  it("names the chat it was flipped in, so it cannot answer another chat's confirm", async () => {
    const { driver } = await load();
    driver.setHostRunContext({ chatId: 41, autoApprove: false, modelSurface: null });
    posted.length = 0;
    driver.setHostRunContext({ chatId: 41, autoApprove: true, modelSurface: null });
    expect(autoApproveFrames()).toEqual([{ type: "run.autoApprove", chatId: 41, on: true }]);
  });

  it("re-announces itself when the panel MOVES to another chat", async () => {
    // In reuse mode one panel walks between chats without the switch ever being
    // touched. A chat parked on a confirm has to be answered when the user comes back
    // to it with Auto already on — which the old panel-global switch got for free by
    // shouting at every live run at once.
    const { driver } = await load();
    driver.setHostRunContext({ chatId: 41, autoApprove: true, modelSurface: null });
    posted.length = 0;
    driver.setHostRunContext({ chatId: 77, autoApprove: true, modelSurface: null });
    expect(autoApproveFrames()).toEqual([{ type: "run.autoApprove", chatId: 77, on: true }]);
  });

  it("stays quiet when nothing moved", async () => {
    const { driver } = await load();
    driver.setHostRunContext({ chatId: 41, autoApprove: true, modelSurface: null });
    posted.length = 0;
    driver.setHostRunContext({ chatId: 41, autoApprove: true, modelSurface: null });
    expect(autoApproveFrames()).toEqual([]);
  });

  it("has no chat to speak for before the panel has bound to one", async () => {
    const { driver } = await load();
    driver.setHostRunContext({ chatId: null, autoApprove: true, modelSurface: null });
    expect(autoApproveFrames()).toEqual([]);
  });
});

describe("the host's tool-count announcement", () => {
  it("is taken only from THIS panel's chat", async () => {
    const { driver, brain } = await load();
    const stop = driver.installHostRunDriver();
    driver.setHostRunContext({ chatId: 41, autoApprove: false, modelSurface: null });
    fromHost({ type: "run.tools", chatId: 41, count: 67 });
    expect(brain.getMcpToolStatus().count).toBe(67);
    // A run starting in another chat must not rewrite what this panel reports.
    fromHost({ type: "run.tools", chatId: 77, count: 3 });
    expect(brain.getMcpToolStatus().count).toBe(67);
    stop();
  });
});
