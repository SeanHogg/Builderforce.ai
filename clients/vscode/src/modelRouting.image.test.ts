/**
 * `routeComplete` with an image: it goes to the gateway (a vision-capable model), never to an
 * on-device text model, and it is never silently stripped of the picture. Behavioural: the
 * routing seam runs for real, its collaborators are stubbed (same stubs as the pick tests).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  complete: vi.fn(async () => "gateway answer"),
  completeLocal: vi.fn(async () => "local answer"),
}));

vi.mock("vscode", () => ({}));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  completeLocal: h.completeLocal,
  completeLocalFirst: vi.fn(),
  createHostModelStream: vi.fn(),
  localFirstApplies: () => false,
  pageRuntimePin: () => null,
  NO_LOCAL_MODEL: "no_local_model",
  NO_SPECIFIC_MODEL: "no_specific_model",
  NOT_SIGNED_IN: "not_signed_in",
}));
vi.mock("@builderforce/local-inference", () => ({
  clientPinOf: () => null,
  localRuntime: () => ({ onDevice: false, gatewayVendor: undefined, label: "Local" }),
  formatLocalModelRef: (p: string, m: string) => `local/${p}/${m}`,
}));
vi.mock("./gateway", () => ({
  complete: h.complete,
  getApiKey: vi.fn(async () => "key"),
  getBaseUrl: () => "https://api.example",
  getLocalModelsConfig: () => ({ enabled: false, localFirst: false, endpoints: {} }),
}));
vi.mock("./localEndpointAuth", () => ({ authorizeLocalEndpoint: async () => ({ ok: true }) }));
vi.mock("./providerConnect", () => ({ editorAccounts: () => ({ hybridAccounts: async () => [] }) }));
vi.mock("./errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./localModels", () => ({ probeLocalFirstRuntimes: async () => [], probeOnDeviceRuntimes: async () => [] }));
vi.mock("./modelState", () => ({ resolveEffectiveModelChoice: async () => ({ model: "auto" }) }));
vi.mock("./nativeBrainRun", () => ({ createNativeStream: vi.fn() }));
vi.mock("./hostBfi/provision", () => ({ hostModelProvisioner: { ensure: vi.fn() } }));
vi.mock("./pageEngineBridge", () => ({ hostPageEngines: { connected: () => false, fetch: () => fetch } }));
vi.mock("./localSuccessStorage", () => ({ localSuccessFederation: {}, localSuccessStore: {}, localSuccessTuning: {} }));
vi.mock("./platformPolicy", () => ({ assertPlatformCapability: vi.fn(), platformPolicy: () => ({ allows: () => true }) }));
vi.mock("./inferenceModeSetting", () => ({ currentInferenceMode: () => "hybrid" }));

import { routeComplete, type ModelRoute } from "./modelRouting";
import { IMAGE_NEEDS_GATEWAY, hasImageParts, textOnly } from "./chatContent";
import type { ChatMessage } from "./gateway";

const secrets = {} as never;
const cloud: ModelRoute = { model: "auto", inferenceMode: "hybrid" };
const local: ModelRoute = { model: "local/ollama/m", inferenceMode: "hybrid", local: { provider: "ollama", model: "m", endpoint: { baseUrl: "http://127.0.0.1:11434" } } } as ModelRoute;
const withImage: ChatMessage[] = [
  { role: "system", content: "read it" },
  { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] },
];
const withTextParts: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }];

beforeEach(() => {
  h.complete.mockClear();
  h.completeLocal.mockClear();
});

describe("routeComplete with an image", () => {
  it("goes to the gateway with the image part intact", async () => {
    expect(await routeComplete(cloud, secrets, withImage, undefined, { temperature: 0, maxTokens: 1024 })).toBe("gateway answer");
    // The sampling bounds reach the gateway call (and so its body).
    expect(h.complete).toHaveBeenCalledWith(secrets, withImage, "auto", undefined, { temperature: 0, maxTokens: 1024 });
    expect(h.completeLocal).not.toHaveBeenCalled();
  });

  it("refuses an on-device route, and a local-only one, instead of dropping the image", async () => {
    await expect(routeComplete(local, secrets, withImage)).rejects.toThrow(IMAGE_NEEDS_GATEWAY);
    await expect(routeComplete({ ...cloud, inferenceMode: "local-only" }, secrets, withImage)).rejects.toThrow(IMAGE_NEEDS_GATEWAY);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.completeLocal).not.toHaveBeenCalled();
  });

  it("gives an on-device model text parts joined as text", async () => {
    await routeComplete(local, secrets, withTextParts);
    expect(h.completeLocal).toHaveBeenCalledWith(expect.anything(), "m", [{ role: "user", content: "a\nb" }], undefined, expect.anything());
  });
});

describe("chat content helpers", () => {
  it("sees an image part, and only an image part", () => {
    expect(hasImageParts(withImage)).toBe(true);
    expect(hasImageParts(withTextParts)).toBe(false);
    expect(hasImageParts([{ role: "user", content: "plain" }, { role: "assistant", content: null }])).toBe(false);
  });

  it("textOnly joins text parts, passes strings and null through, and refuses an image", () => {
    expect(textOnly(withTextParts)).toEqual([{ role: "user", content: "a\nb" }]);
    expect(textOnly([{ role: "assistant", content: null }, { role: "user", content: "x" }])).toEqual([{ role: "assistant", content: null }, { role: "user", content: "x" }]);
    expect(() => textOnly(withImage)).toThrow(IMAGE_NEEDS_GATEWAY);
  });
});
