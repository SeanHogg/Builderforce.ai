import { describe, expect, it, vi } from "vitest";
import { createConnectedAccounts } from "@builderforce/provider-connect/accounts";
import type { GatewayRequest } from "@builderforce/provider-connect";

/**
 * The shared connected accounts (`@builderforce/provider-connect/accounts`) — the ONE client
 * implementation the editor and Rovr both run. Lives in this suite because its vitest config
 * aliases every source package.
 */
const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    get: async (key: string) => data.get(key),
    set: async (key: string, value: string) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
  };
};

const credential = (now: number) => ({
  provider: "kimi",
  runtime: "kimi-code",
  accessToken: "kc-token",
  expiresAt: now + 15 * 60_000,
  baseUrl: "https://api.kimi.ai/coding/v1",
  models: [{ model: "k3", displayName: "Kimi K3" }],
});

describe("createConnectedAccounts", () => {
  const now = 1_000_000;

  it("needs no init step: a store is created on first use and resolves", async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 200, body: credential(now) }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    expect(await accounts.store("kimi").resolve()).toMatchObject({ kind: "credential" });
    expect(request).toHaveBeenCalledWith("/llm/provider-keys/kimi/local-credential", { method: "POST" });
  });

  it("resolves a Kimi pick in either spelling to its endpoint and wire model", async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 200, body: credential(now) }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    for (const ref of ["direct/kimi-code/k3", "local/kimi-code/k3"]) {
      expect(await accounts.pinFor(ref)).toEqual({
        kind: "endpoint",
        provider: "kimi",
        endpoint: { baseUrl: "https://api.kimi.ai/coding/v1", token: "kc-token", credential: expect.any(Function) },
        model: "k3",
      });
    }
  });

  it("asks the host to offer the sign-in when nothing is connected, or the grant is dead", async () => {
    const notConnected = createConnectedAccounts({
      request: async () => ({ status: 404, body: { code: "provider_not_connected" } }),
      store: memoryStore(),
      now: () => now,
    });
    expect(await notConnected.endpointFor("kimi-code")).toEqual({ kind: "connect", provider: "kimi", reason: "not_connected" });
    const dead = createConnectedAccounts({
      request: async () => ({ status: 409, body: { code: "provider_reconnect_required", error: "revoked" } }),
      store: memoryStore(),
      now: () => now,
    });
    expect(await dead.endpointFor("kimi-code")).toMatchObject({ kind: "connect", provider: "kimi", reason: "reconnect" });
  });

  // A change listener re-renders the editor's panel, which resolves again: notifying on an
  // unchanged "not connected" looped it and reset the model pick (VSIX 2026.10.85).
  it("does not notify when the credential did not change", async () => {
    const onChange = vi.fn();
    const accounts = createConnectedAccounts({
      request: async () => ({ status: 404, body: { code: "provider_not_connected" } }),
      store: memoryStore(),
      now: () => now,
      onChange,
    });
    await accounts.store("kimi").resolve();
    await accounts.store("kimi").resolve();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("credentialFor drops a token the provider refused and fetches the next", async () => {
    let issued = 0;
    const request = vi.fn<GatewayRequest>(async () => ({ status: 200, body: { ...credential(now), accessToken: `kc-${++issued}` } }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    const token = accounts.credentialFor("kimi");
    expect(await token()).toBe("kc-1");
    expect(await token()).toBe("kc-1");
    expect(await token("kc-1")).toBe("kc-2");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("leaves every ref and runtime without a connected account alone", async () => {
    const request = vi.fn<GatewayRequest>();
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    expect(await accounts.pinFor("local/ollama/qwen3:8b")).toBeNull();
    expect(await accounts.pinFor("direct/minimax/MiniMax-M3.1-Flash-Preview")).toBeNull();
    expect(await accounts.endpointFor("ollama")).toBeNull();
    expect(accounts.providers).toEqual(["kimi"]);
    expect(request).not.toHaveBeenCalled();
  });
});
