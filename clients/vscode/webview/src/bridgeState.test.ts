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

describe("a token-less init for another tenant", () => {
  it("keeps the held token when the frame names the same tenant", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-a", tenantId: 1 });
    fromHost({ type: "init", tenantId: 1 });
    expect(getToken()).toBe("jwt-a");
  });

  it("drops the old tenant's token when the frame names a different tenant (the root then mints)", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-a", tenantId: 1 });
    fromHost({ type: "init", tenantId: 2 });
    expect(getToken()).toBeNull();
  });

  it("keeps the token when the frame names no tenant yet (before the first mint)", async () => {
    const { getToken } = await import("./bridgeState");
    fromHost({ type: "init", token: "jwt-a", tenantId: 1 });
    fromHost({ type: "init" });
    expect(getToken()).toBe("jwt-a");
  });
});
