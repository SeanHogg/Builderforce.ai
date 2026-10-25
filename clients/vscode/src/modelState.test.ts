import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));
vi.mock("./bfApi", () => ({ getProjectEvermindHead: async () => undefined }));
vi.mock("./gateway", () => ({ getModels: async () => undefined, isModelAllowed: () => true }));
vi.mock("./localModels", () => ({ isLocalModelRef: (model: string) => model.startsWith("local/") }));
vi.mock("./projectState", () => ({ getSelectedProject: () => undefined }));
vi.mock("./roleModelPin", () => ({ NATIVE_RUN_ROLE: "coder", roleModelPin: () => undefined }));

const memento = () => {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key: string, value: unknown) => void data.set(key, value),
    keys: () => [...data.keys()],
  };
};

// The mode (`builderforce.inferenceMode`) is a setting and survives a reload; a pick kept
// only in memory did not, so Specific came back with nothing picked and every turn failed
// `no_specific_model` while the `/` menu still showed Kimi K3.
describe("the model pick survives a reload", () => {
  beforeEach(() => vi.resetModules());

  it("restores the saved pick at activation", async () => {
    const store = memento();
    const before = await import("./modelState");
    before.bindModelPickStore(store as never);
    before.setSelectedModel("direct/kimi-code/k3");

    vi.resetModules();
    const after = await import("./modelState");
    after.bindModelPickStore(store as never);
    expect(await after.resolveEffectiveModelChoice({} as never)).toMatchObject({ model: "direct/kimi-code/k3", modelStrict: true });
  });

  it("restores Auto and the BYO pool as explicit choices too", async () => {
    const store = memento();
    const before = await import("./modelState");
    before.bindModelPickStore(store as never);
    before.setSelectedModelPool();

    vi.resetModules();
    const after = await import("./modelState");
    after.bindModelPickStore(store as never);
    expect(await after.resolveEffectiveModelChoice({} as never)).toEqual({ routingMode: "byo_pool" });
  });

  it("ignores a malformed saved value", async () => {
    const store = memento();
    await store.update("builderforce.modelPick", { mode: "model" });
    const state = await import("./modelState");
    state.bindModelPickStore(store as never);
    expect(await state.resolveEffectiveModelChoice({} as never)).toEqual({});
  });
});
