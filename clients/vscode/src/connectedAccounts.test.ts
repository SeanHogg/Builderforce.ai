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
    // The gateway is told which token was refused, so it rotates the grant instead of
    // handing the same revoked token back.
    expect(request).toHaveBeenLastCalledWith("/llm/provider-keys/kimi/local-credential", { method: "POST", json: { rejected: "kc-1" } });
    // A refusal of a token no longer held is answered by the one held now — no fetch.
    expect(await token("kc-1")).toBe("kc-2");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("hybridAccounts lists a connected account on its lead model, with the per-request token", async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 200, body: credential(now) }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    expect(await accounts.hybridAccounts()).toEqual([{
      ref: "local/kimi-code/k3",
      provider: "kimi-code",
      model: "k3",
      endpoint: { baseUrl: "https://api.kimi.ai/coding/v1", token: "kc-token", credential: expect.any(Function) },
    }]);
  });

  // Read on every Hybrid call: an unconnected workspace must not cost a round trip each time.
  it("hybridAccounts asks the gateway once per session when nothing is connected, and never prompts", async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 404, body: { code: "provider_not_connected" } }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
    expect(await accounts.hybridAccounts()).toEqual([]);
    expect(await accounts.hybridAccounts()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  describe("hybridAccounts places the account in the server's BYO order for the call's role", () => {
    const entry = (ref: string, provider: string, healthy = true) => ({ ref, vendor: ref.split("/")[1], provider, healthy });
    const orders: Record<string, unknown[]> = {
      code: [entry("direct/anthropic/claude-sonnet", "anthropic"), entry("direct/kimi-code/k3", "kimi")],
      plan: [entry("direct/kimi-code/k3", "kimi"), entry("direct/anthropic/claude-opus", "anthropic")],
      verify: [entry("direct/anthropic/claude-haiku", "anthropic", false), entry("direct/kimi-code/k3", "kimi")],
    };
    const twoModels = { ...credential(now), models: [{ model: "kimi-for-coding", displayName: "Kimi for Coding" }, { model: "k3", displayName: "Kimi K3" }] };
    const serving = (order: (role: string) => { status: number; body: unknown }) =>
      vi.fn<GatewayRequest>(async (path) => {
        if (path.startsWith("/llm/byo-order")) return order(new URL(path, "https://x").searchParams.get("role") ?? "");
        return { status: 200, body: twoModels };
      });
    const byRole = (role: string) => ({ status: 200, body: { role, models: orders[role] ?? [] } });
    const orderCalls = (request: ReturnType<typeof serving>) => request.mock.calls.filter(([path]) => path.startsWith("/llm/byo-order"));

    it("a code turn whose order leads with another provider TRAILS, on the k3 the order names", async () => {
      const accounts = createConnectedAccounts({ request: serving(byRole), store: memoryStore(), now: () => now });
      expect(await accounts.hybridAccounts("code")).toEqual([expect.objectContaining({ ref: "local/kimi-code/k3", model: "k3", placement: "trail" })]);
    });

    it("an absent role is a code turn", async () => {
      const request = serving(byRole);
      const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
      expect(await accounts.hybridAccounts()).toEqual([expect.objectContaining({ model: "k3", placement: "trail" })]);
      expect(orderCalls(request)[0]?.[0]).toBe("/llm/byo-order?role=code");
    });

    it("a plan turn whose order leads with Kimi LEADS on k3, not the credential's first model", async () => {
      const accounts = createConnectedAccounts({ request: serving(byRole), store: memoryStore(), now: () => now });
      expect(await accounts.hybridAccounts("plan")).toEqual([expect.objectContaining({ ref: "local/kimi-code/k3", model: "k3", placement: "lead" })]);
    });

    it("an unhealthy first entry is passed over: the first HEALTHY one decides the lead", async () => {
      const accounts = createConnectedAccounts({ request: serving(byRole), store: memoryStore(), now: () => now });
      expect(await accounts.hybridAccounts("verify")).toEqual([expect.objectContaining({ model: "k3", placement: "lead" })]);
    });

    it("an account the order does not list trails", async () => {
      const accounts = createConnectedAccounts({ request: serving(() => ({ status: 200, body: { role: "code", models: [entry("direct/anthropic/claude-sonnet", "anthropic")] } })), store: memoryStore(), now: () => now });
      expect(await accounts.hybridAccounts("code")).toEqual([expect.objectContaining({ model: "kimi-for-coding", placement: "trail" })]);
    });

    it("an order the client cannot read (403) leads on the credential's first model, as before", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const accounts = createConnectedAccounts({ request: serving(() => ({ status: 403, body: { error: "forbidden" } })), store: memoryStore(), now: () => now });
      const [account] = await accounts.hybridAccounts("code");
      expect(account).toMatchObject({ model: "kimi-for-coding" });
      expect(account).not.toHaveProperty("placement");
      await accounts.hybridAccounts("code");
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("reuses a role's order within the TTL, asks again after it, and keeps each role apart", async () => {
      let at = now;
      const request = serving(byRole);
      const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => at });
      await accounts.hybridAccounts("code");
      await accounts.hybridAccounts("code");
      expect(orderCalls(request)).toHaveLength(1);
      await accounts.hybridAccounts("plan");
      expect(orderCalls(request).map(([path]) => path)).toEqual(["/llm/byo-order?role=code", "/llm/byo-order?role=plan"]);
      at += 61_000;
      await accounts.hybridAccounts("code");
      expect(orderCalls(request)).toHaveLength(3);
    });

    it("forgets the order on clear()", async () => {
      const request = serving(byRole);
      const accounts = createConnectedAccounts({ request, store: memoryStore(), now: () => now });
      await accounts.hybridAccounts("code");
      await accounts.clear();
      await accounts.hybridAccounts("code");
      expect(orderCalls(request)).toHaveLength(2);
    });
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
