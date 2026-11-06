import { beforeEach, describe, expect, it, vi } from "vitest";

const startProviderConnect = vi.fn();
const showInputBox = vi.fn();

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
  env: { openExternal: vi.fn(async () => true) },
  Uri: { parse: (value: string) => value },
  ProgressLocation: { Notification: 15 },
  window: {
    showInputBox: (...args: unknown[]) => showInputBox(...args),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
  },
}));
vi.mock("@builderforce/provider-connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/provider-connect")>()),
  startProviderConnect: (...args: unknown[]) => startProviderConnect(...args),
}));
vi.mock("./gatewayRequest", () => ({ gatewayRequest: () => vi.fn() }));
vi.mock("./localProviderCredentials", () => ({
  connectedAccounts: () => ({ store: () => ({ resolve: async () => ({ kind: "not_connected" }) }) }),
}));

import { LOCAL_RUNTIMES } from "@builderforce/local-inference";
import {
  ensureLocalProviderCredential,
  resetProviderSignIn,
  signInDeclined,
  signInToAccountProvider,
} from "./providerConnect";

const kimi = LOCAL_RUNTIMES.find((r) => r.id === "kimi-code")!;
const provider = kimi.accountProvider!;
const secrets = {} as never;

describe("the automatic provider sign-in", () => {
  beforeEach(() => {
    resetProviderSignIn();
    startProviderConnect.mockReset();
    showInputBox.mockReset();
    // A paste grant the person cancels at the code box.
    startProviderConnect.mockResolvedValue({ grant: "paste", authorizeUrl: "https://kimi/authorize", state: "s" });
    showInputBox.mockResolvedValue(undefined);
  });

  it("is not relaunched after a cancel, until the banner's Sign-in button asks again", async () => {
    await ensureLocalProviderCredential(secrets, provider, "Kimi", { prompt: true });
    expect(signInDeclined(provider)).toBe(true);
    await ensureLocalProviderCredential(secrets, provider, "Kimi", { prompt: true });
    await ensureLocalProviderCredential(secrets, provider, "Kimi", { prompt: true });
    expect(startProviderConnect).toHaveBeenCalledTimes(1);

    await signInToAccountProvider(secrets, provider);
    expect(startProviderConnect).toHaveBeenCalledTimes(2);
  });

  it("shares ONE flight between a turn's prompt and the banner's button", async () => {
    await Promise.all([
      ensureLocalProviderCredential(secrets, provider, "Kimi", { prompt: true }),
      signInToAccountProvider(secrets, provider),
      ensureLocalProviderCredential(secrets, provider, "Kimi", { prompt: true }),
    ]);
    expect(startProviderConnect).toHaveBeenCalledTimes(1);
  });

  it("ignores a provider no runtime is backed by", async () => {
    await expect(signInToAccountProvider(secrets, "nope")).resolves.toBe(false);
    expect(startProviderConnect).not.toHaveBeenCalled();
  });
});
