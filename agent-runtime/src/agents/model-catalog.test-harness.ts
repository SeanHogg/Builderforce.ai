import { afterEach, beforeEach, vi } from "vitest";
import { __setModelCatalogImportForTest, resetModelCatalogCacheForTest } from "./model-catalog.js";

export type ModelSdkModule = typeof import("./model-discovery.js");

vi.mock("./models-config.js", () => ({
  ensureBuilderForceAgentsModelsJson: vi.fn().mockResolvedValue({ agentDir: "/tmp", wrote: false }),
}));

vi.mock("./agent-paths.js", () => ({
  resolveBuilderForceAgentsAgentDir: () => "/tmp/builderforce",
}));

export function installModelCatalogTestHooks() {
  beforeEach(() => {
    resetModelCatalogCacheForTest();
  });

  afterEach(() => {
    __setModelCatalogImportForTest();
    resetModelCatalogCacheForTest();
    vi.restoreAllMocks();
  });
}

export function mockCatalogImportFailThenRecover() {
  let call = 0;
  __setModelCatalogImportForTest(async () => {
    call += 1;
    if (call === 1) {
      throw new Error("boom");
    }
    return {
      AuthStorage: class {},
      ModelRegistry: class {
        getAll() {
          return [{ id: "gpt-4.1", name: "GPT-4.1", provider: "openai" }];
        }
      },
    } as unknown as ModelSdkModule;
  });
  return () => call;
}
