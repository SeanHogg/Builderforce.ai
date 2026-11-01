/**
 * A CLI primary that tenant governance refuses is not an ATTEMPT: the fallback candidate runs the person's own prompt and images,
 * not "Continue where you left off" (which `agentCommand` sends to a retry of an attempt that started). Every gateway entry (the
 * `agent` RPC, OpenAI-compatible HTTP, OpenResponses, boot, node events) reaches this one function.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";

const state = vi.hoisted(() => ({ govern: vi.fn() }));

vi.mock("../agents/embedded.js", () => ({
  abortEmbeddedRun: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));
vi.mock("../agents/cli-runner.js", () => ({ runCliAgent: vi.fn() }));
vi.mock("../agents/cli-runner/governance.js", () => ({ governCliRun: (target: unknown) => state.govern(target) }));
vi.mock("../agents/model-catalog.js", () => ({ loadModelCatalog: vi.fn() }));

import { runCliAgent } from "../agents/cli-runner.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { runEmbeddedAgent } from "../agents/embedded.js";
import { FailoverError, GOVERNANCE_REFUSAL_CODE } from "../agents/failover-error.js";
import * as configModule from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = { log: vi.fn(), error: vi.fn(), exit: vi.fn(() => { throw new Error("exit"); }) };
const configSpy = vi.spyOn(configModule, "loadConfig");
const IMAGE = { type: "image" as const, data: "AAAA", mimeType: "image/png" };

function mockConfig(home: string, storePath: string) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        model: { primary: "claude-cli/opus", fallbacks: ["anthropic/claude-opus-4-5"] },
        models: { "claude-cli/opus": {}, "anthropic/claude-opus-4-5": {} },
        workspace: path.join(home, "builderforce"),
      },
    },
    session: { store: storePath, mainKey: "main" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runEmbeddedAgent).mockResolvedValue({ payloads: [{ text: "ok" }], meta: { durationMs: 5, agentMeta: { sessionId: "s", provider: "p", model: "m" } } });
  vi.mocked(runCliAgent).mockResolvedValue({ payloads: [{ text: "ok" }], meta: { durationMs: 5, agentMeta: { sessionId: "s", provider: "p", model: "m" } } });
  vi.mocked(loadModelCatalog).mockResolvedValue([]);
});

async function run(message: string) {
  await withTempHomeBase(
    async (home) => {
      const store = path.join(home, "sessions.json");
      fs.mkdirSync(path.dirname(store), { recursive: true });
      mockConfig(home, store);
      await agentCommand({ message, to: "+1555", images: [IMAGE] }, runtime);
    },
    { prefix: "builderforce-agent-gov-" },
  );
}

describe("a governed CLI primary under agentCommand", () => {
  it("falls over to the embedded model with the person's own prompt and images", async () => {
    state.govern.mockRejectedValue(new FailoverError("refused by gate no-shell", { reason: "unknown", code: GOVERNANCE_REFUSAL_CODE, provider: "claude-cli" }));

    await run("fix the login bug");

    expect(runCliAgent).not.toHaveBeenCalled();
    expect(runEmbeddedAgent).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runEmbeddedAgent).mock.calls[0]![0];
    expect(call.prompt).toBe("fix the login bug");
    expect(call.prompt).not.toContain("Continue where you left off");
    expect(call.images).toEqual([IMAGE]);
  });

  it("control: a CLI run that STARTED and failed still retries with the continue prompt and no images", async () => {
    state.govern.mockResolvedValue("");
    vi.mocked(runCliAgent).mockRejectedValue(new FailoverError("cli crashed", { reason: "unknown", code: GOVERNANCE_REFUSAL_CODE, provider: "claude-cli" }));

    await run("fix the login bug");

    const call = vi.mocked(runEmbeddedAgent).mock.calls[0]![0];
    expect(call.prompt).toContain("Continue where you left off");
    expect(call.images).toBeUndefined();
  });
});
