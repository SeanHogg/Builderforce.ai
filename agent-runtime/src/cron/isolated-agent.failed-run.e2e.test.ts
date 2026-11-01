/**
 * A cron job whose run FAILED but said why as its reply (`meta.runFailed`, the channel runner's notice after a budget or breaker stop) is
 * recorded as an ERROR with that account, not as a success.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.js";
import { makeCfg, makeJob, withTempCronHome } from "./isolated-agent.test-harness.js";

vi.mock("../agents/embedded.js", () => ({
  abortEmbeddedRun: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));
vi.mock("../agents/model-catalog.js", () => ({ loadModelCatalog: vi.fn() }));

import { loadModelCatalog } from "../agents/model-catalog.js";
import { runEmbeddedAgent } from "../agents/embedded.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";

const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate no-shell refused some of its tool calls.";

const deps = (): CliDeps => ({
  sendMessageSlack: vi.fn(),
  sendMessageWhatsApp: vi.fn(),
  sendMessageTelegram: vi.fn(),
  sendMessageDiscord: vi.fn(),
  sendMessageSignal: vi.fn(),
  sendMessageIMessage: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadModelCatalog).mockResolvedValue([]);
});

async function runJob(meta: Record<string, unknown>) {
  return withTempCronHome(async (home) => {
    const dir = path.join(home, ".builderforce", "sessions");
    await fs.mkdir(dir, { recursive: true });
    const storePath = path.join(dir, "sessions.json");
    await fs.writeFile(storePath, JSON.stringify({ "agent:main:main": { sessionId: "main-session", updatedAt: Date.now() } }));
    vi.mocked(runEmbeddedAgent).mockResolvedValue({ payloads: [{ text: NOTICE }], meta: { durationMs: 5, agentMeta: { sessionId: "s", provider: "p", model: "m" }, ...meta } });
    return runCronIsolatedAgentTurn({
      cfg: makeCfg(home, storePath),
      deps: deps(),
      job: makeJob({ kind: "agentTurn", message: "do it", deliver: false }),
      message: "do it",
      sessionKey: "cron:job-1",
      lane: "cron",
    });
  });
}

describe("a cron job whose run failed and said why as its reply", () => {
  it("is recorded as an error carrying that account, with the text still available as the output", async () => {
    const res = await runJob({ runFailed: true });

    expect(res.status).toBe("error");
    expect(res.error).toBe(NOTICE);
    expect(res.outputText).toBe(NOTICE);
  });

  it("control: an ordinary run is ok", async () => {
    const res = await runJob({});

    expect(res.status).toBe("ok");
    expect(res.error).toBeUndefined();
  });
});
