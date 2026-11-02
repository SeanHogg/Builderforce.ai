import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { data: unknown }) => void;
let listeners: Listener[];

const fromHost = (frame: Record<string, unknown>): void => {
  for (const listener of listeners) listener({ data: frame });
};

beforeEach(() => {
  listeners = [];
  vi.resetModules();
  const stub = {
    addEventListener: (type: string, cb: Listener) => { if (type === "message") listeners.push(cb); },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
});

describe("the init frame's token", () => {
  it("is set by an init that carries one", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-1" });
    expect(getToken()).toBe("jwt-1");
  });

  it("is KEPT by a degraded init that omits the key (the host's mint was late)", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-1" });
    fromHost({ type: "init", signedIn: true });
    expect(getToken()).toBe("jwt-1");
  });

  it("is cleared by an explicit null (signed out)", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-1" });
    fromHost({ type: "init", token: null });
    expect(getToken()).toBeNull();
  });
});
