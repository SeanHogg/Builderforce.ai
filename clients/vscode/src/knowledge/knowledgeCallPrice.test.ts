import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onDevice: vi.fn(async () => false),
  mode: vi.fn(() => "hybrid"),
  client: vi.fn(),
}));
vi.mock("../modelRouting", () => ({ onDeviceModelAvailable: mocks.onDevice }));
vi.mock("../inferenceModeSetting", () => ({ currentInferenceMode: mocks.mode }));
vi.mock("./knowledgeService", () => ({ linkedKnowledgeClient: mocks.client }));

import { editorCallPrice } from "./knowledgeCallPrice";

const secrets = {} as never;
const ESTIMATE = { perCallUsd: 0.004, model: "anthropic/claude-haiku-5-5", local: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onDevice.mockResolvedValue(false);
  mocks.mode.mockReturnValue("hybrid");
  mocks.client.mockReturnValue({ judgeEstimate: vi.fn(async () => ESTIMATE) });
});

describe("the editor's confirm-chip price", () => {
  it("is local and free when an on-device engine judges first", async () => {
    mocks.onDevice.mockResolvedValue(true);
    expect(await editorCallPrice(secrets)()).toEqual({ perCallUsd: 0, local: true });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("is the server's estimate when the workspace is linked", async () => {
    expect(await editorCallPrice(secrets)()).toEqual(ESTIMATE);
  });

  it("is unknown when unlinked with no local engine (the gateway is called directly)", async () => {
    mocks.client.mockReturnValue(undefined);
    expect(await editorCallPrice(secrets)()).toBeUndefined();
  });

  it("is unknown in local-only mode with no engine — nothing judges, nothing is priced", async () => {
    mocks.mode.mockReturnValue("local-only");
    expect(await editorCallPrice(secrets)()).toBeUndefined();
  });
});
