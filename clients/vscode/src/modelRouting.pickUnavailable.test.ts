/**
 * Hybrid's pick that cannot be authorized on this machine is answered with Auto — and the
 * person is TOLD (`ModelRoute.pickUnavailable` → `routeStream`'s `onFallback`), never left
 * with free models answering unexplained. Behavioural: the routing seam runs for real, its
 * collaborators are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mode: "hybrid" as "hybrid" | "specific" | "local-only",
  streamInput: undefined as undefined | Record<string, unknown>,
}));

vi.mock("vscode", () => ({}));
vi.mock("@seanhogg/builderforce-brain-embedded", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  completeLocal: vi.fn(),
  completeLocalFirst: vi.fn(),
  createHostModelStream: (input: Record<string, unknown>) => { h.streamInput = input; return vi.fn(); },
  localFirstApplies: () => false,
  pageRuntimePin: () => null,
  NO_LOCAL_MODEL: "no_local_model",
  NO_SPECIFIC_MODEL: "no_specific_model",
  NOT_SIGNED_IN: "not_signed_in",
}));
vi.mock("@builderforce/local-inference", () => ({
  clientPinOf: (model?: string) => (model?.startsWith("direct/kimi-code/") ? { provider: "kimi-code", model: model.slice(17) } : null),
  localRuntime: () => ({ onDevice: false, gatewayVendor: "kimi-code", label: "Kimi Code" }),
  formatLocalModelRef: (p: string, m: string) => `local/${p}/${m}`,
}));
vi.mock("./gateway", () => ({
  complete: vi.fn(),
  getApiKey: vi.fn(),
  getBaseUrl: () => "https://api.example",
  getLocalModelsConfig: () => ({ enabled: false, localFirst: false, endpoints: { "kimi-code": { baseUrl: "https://kimi.example" } } }),
}));
vi.mock("./localEndpointAuth", () => ({ authorizeLocalEndpoint: async () => ({ ok: false, detail: "Kimi is not connected." }) }));
vi.mock("./providerConnect", () => ({ editorAccounts: () => ({ hybridAccounts: async () => [] }) }));
vi.mock("./errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./localModels", () => ({ probeLocalFirstRuntimes: async () => [], probeOnDeviceRuntimes: async () => [] }));
vi.mock("./modelState", () => ({ resolveEffectiveModelChoice: async () => ({ model: "direct/kimi-code/k3" }) }));
vi.mock("./nativeBrainRun", () => ({ createNativeStream: vi.fn() }));
vi.mock("./hostBfi/provision", () => ({ hostModelProvisioner: { ensure: vi.fn() } }));
vi.mock("./pageEngineBridge", () => ({ hostPageEngines: { connected: () => false, fetch: () => fetch } }));
vi.mock("./localSuccessStorage", () => ({ localSuccessFederation: {}, localSuccessStore: {}, localSuccessTuning: {} }));
vi.mock("./platformPolicy", () => ({ assertPlatformCapability: vi.fn(), platformPolicy: () => ({ allows: () => true }) }));
vi.mock("./inferenceModeSetting", () => ({ currentInferenceMode: () => h.mode }));

import { resolveModelRoute, routeStream } from "./modelRouting";

const secrets = {} as never;

beforeEach(() => {
  h.mode = "hybrid";
  h.streamInput = undefined;
});

describe("a Hybrid pick that cannot be authorized", () => {
  it("is carried on the route for a real turn", async () => {
    const route = await resolveModelRoute(secrets, { turn: true });
    expect(route.pickUnavailable).toEqual({ model: "direct/kimi-code/k3", detail: "Kimi is not connected." });
    expect(route.local).toBeUndefined();
  });

  it("is not carried for a panel refresh (no turn)", async () => {
    expect((await resolveModelRoute(secrets)).pickUnavailable).toBeUndefined();
  });

  it("is not carried in Specific (the turn fails with why) or Local only", async () => {
    h.mode = "specific";
    const specific = await resolveModelRoute(secrets, { turn: true });
    expect(specific.pickUnavailable).toBeUndefined();
    expect(specific.unauthorized).toBeDefined();
    h.mode = "local-only";
    expect((await resolveModelRoute(secrets, { turn: true })).pickUnavailable).toBeUndefined();
  });

  it("is reported once through onFallback when the stream is built", () => {
    const onFallback = vi.fn();
    routeStream({ model: "direct/kimi-code/k3", inferenceMode: "hybrid", pickUnavailable: { model: "direct/kimi-code/k3", detail: "Kimi is not connected." } }, "key", onFallback);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ from: "direct/kimi-code/k3", reason: "Kimi is not connected." });
  });

  it("reports nothing for a route that carries no failure", () => {
    const onFallback = vi.fn();
    routeStream({ model: "m", inferenceMode: "hybrid" }, "key", onFallback);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
