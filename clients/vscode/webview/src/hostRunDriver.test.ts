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

describe("the host's Hybrid-fallback announcement", () => {
  it("raises the notice only for THIS panel's chat, and retires it on a chat change", async () => {
    const { driver } = await load();
    const stop = driver.installHostRunDriver();
    driver.setHostRunContext({ chatId: 41, autoApprove: false, modelSurface: null });
    // Another chat's fallback is not this panel's to show.
    fromHost({ type: "run.modelFallback", chatId: 77, from: "openai/gpt-5" });
    expect(driver.hostModelFallback.latest()).toBeNull();
    fromHost({ type: "run.modelFallback", chatId: 41, from: "anthropic/claude-sonnet-4" });
    expect(driver.hostModelFallback.latest()?.from).toBe("anthropic/claude-sonnet-4");
    driver.setHostRunContext({ chatId: 77, autoApprove: false, modelSurface: null });
    expect(driver.hostModelFallback.latest()).toBeNull();
    stop();
  });
});

describe("the run.sync frames", () => {
  const ev = (label: string) => ({ ts: "t", category: "tool", label, result: "ok" });
  const frame = (chatId: number, over: Record<string, unknown>) => ({
    type: "run.sync", chatId,
    snapshot: { running: true, error: "", errorAction: null, pendingConfirm: null, messagesEpoch: 0, appended: [], hasTrace: true, activity: null, byoUnresolved: [], providerCap: [], turn: null },
    appendedDrop: 0, appendedFrom: 0, traceDrop: 0, traceFrom: 0, trace: [], textFrom: 0, text: "",
    ...over,
  });

  it("a token frame keeps the trace the transcript already holds", async () => {
    const { driver, brain } = await load();
    const stop = driver.installHostRunDriver();
    fromHost(frame(51, { trace: [ev("a"), ev("b")] }));
    const held = brain.getRunSnapshot(51).trace;
    fromHost(frame(51, { traceFrom: 2, text: "Now I" }));
    expect(brain.getRunSnapshot(51).trace).toBe(held);
    expect(brain.getRunSnapshot(51).streamingText).toBe("Now I");
    stop();
  });

  it("a delta this panel cannot be in step with asks for the run whole instead of applying it", async () => {
    const { driver, brain } = await load();
    const stop = driver.installHostRunDriver();
    posted.length = 0;
    fromHost(frame(52, { traceFrom: 3, trace: [ev("d")] }));
    expect(posted).toContainEqual({ type: "run.resync", chatId: 52 });
    expect(brain.getRunSnapshot(52).trace).toEqual([]);
    stop();
  });
});
