import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureFreshKimiToken = vi.fn();
const ensureLocalProviderCredential = vi.fn();

vi.mock("./gateway", () => ({
  currentKimiInstall: () => ({ home: "/home/.kimi-code", baseUrl: "https://api.kimi.com/coding/v1" }),
}));
vi.mock("./kimiCodeInstall", () => ({ isKimiCodeInstall: () => true }));
vi.mock("./kimiCodeAuth", () => ({ ensureFreshKimiToken: (...args: unknown[]) => ensureFreshKimiToken(...args) }));
vi.mock("./errorReporter", () => ({ logLine: vi.fn(), reportExtensionError: vi.fn(async () => undefined) }));
vi.mock("./providerConnect", () => ({
  editorAccounts: () => ({ providerFor: () => "kimi", credentialFor: () => async () => "ws-token" }),
  ensureLocalProviderCredential: (...args: unknown[]) => ensureLocalProviderCredential(...args),
}));

import { authorizeLocalEndpoint, resetRefusedKimiCliToken } from "./localEndpointAuth";

const secrets = {} as never;

describe("authorizeLocalEndpoint: a CLI token Kimi refused", () => {
  beforeEach(() => {
    resetRefusedKimiCliToken();
    ensureFreshKimiToken.mockReset();
    ensureLocalProviderCredential.mockReset();
    ensureLocalProviderCredential.mockResolvedValue({
      kind: "credential",
      credential: { baseUrl: "https://ws.example/v1", accessToken: "ws-token" },
    });
  });

  it("is not offered back on the retry, and the next authorization falls through to the workspace connection", async () => {
    ensureFreshKimiToken.mockResolvedValue({ kind: "token", accessToken: "cli-1" });
    const first = await authorizeLocalEndpoint("kimi-code", undefined, secrets, { interactive: true });
    expect(first.ok && first.endpoint.token).toBe("cli-1");
    if (!first.ok) throw new Error("expected ok");

    // Kimi refuses cli-1: the per-request retry must not re-send the same token.
    await expect(first.endpoint.credential?.("cli-1")).resolves.toBeNull();

    const second = await authorizeLocalEndpoint("kimi-code", undefined, secrets, { interactive: true });
    expect(second.ok && second.endpoint.token).toBe("ws-token");
    expect(ensureLocalProviderCredential).toHaveBeenCalledTimes(1);
  });

  it("is tried again once the CLI holds a different token", async () => {
    ensureFreshKimiToken.mockResolvedValue({ kind: "token", accessToken: "cli-1" });
    const first = await authorizeLocalEndpoint("kimi-code", undefined, secrets, { interactive: true });
    if (!first.ok) throw new Error("expected ok");
    await first.endpoint.credential?.("cli-1");

    ensureFreshKimiToken.mockResolvedValue({ kind: "token", accessToken: "cli-2" });
    const next = await authorizeLocalEndpoint("kimi-code", undefined, secrets, { interactive: true });
    expect(next.ok && next.endpoint.token).toBe("cli-2");
    expect(ensureLocalProviderCredential).not.toHaveBeenCalled();
  });
});
