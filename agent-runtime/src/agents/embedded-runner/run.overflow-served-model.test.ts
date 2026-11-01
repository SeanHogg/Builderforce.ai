import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../../builderforce/model/types.js";
import { compactEmbeddedSessionDirect } from "./compact.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import { runEmbeddedAgent } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedRunEmbeddedAttempt = vi.mocked(runEmbeddedAttempt);
const mockedCompactDirect = vi.mocked(compactEmbeddedSessionDirect);

const overflow = new Error("request_too_large: Request size exceeds model context window");
const fallback = { id: "small", provider: "ollama", api: "openai-completions", contextWindow: 16_384, maxTokens: 4_096 } as unknown as Model;
const compacted = { ok: true, compacted: true, result: { summary: "Compacted session", firstKeptEntryId: "entry-5", tokensBefore: 150000 } };
const run = () => runEmbeddedAgent({ sessionId: "s", sessionKey: "k", sessionFile: "/tmp/session.json", workspaceDir: "/tmp/workspace", prompt: "hello", timeoutMs: 30000, runId: "run-1" });

describe("an overflow after a failover is folded and retried for the model that was serving", () => {
  beforeEach(() => vi.clearAllMocks());

  it("folds for the fallback's provider and model, then starts the retry on it", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: overflow, servedModel: fallback })).mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce(compacted as never);

    await run();

    expect(mockedCompactDirect).toHaveBeenCalledWith(expect.objectContaining({ trigger: "overflow", provider: "ollama", model: "small" }));
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedRunEmbeddedAttempt.mock.calls[0]![0]).toMatchObject({ provider: "anthropic", modelId: "test-model" });
    expect(mockedRunEmbeddedAttempt.mock.calls[1]![0]).toMatchObject({ provider: "ollama", modelId: "small", model: fallback });
  });

  it("an overflow on the model the run started on is folded and retried on it, as before", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: overflow })).mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce(compacted as never);

    await run();

    expect(mockedCompactDirect).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic", model: "test-model" }));
    expect(mockedRunEmbeddedAttempt.mock.calls[1]![0]).toMatchObject({ provider: "anthropic", modelId: "test-model" });
  });
});
