import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactEmbeddedSessionDirect } from "./compact.js";
import { runEmbeddedAgent } from "./run.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedRunEmbeddedAttempt = vi.mocked(runEmbeddedAttempt);
const mockedCompactDirect = vi.mocked(compactEmbeddedSessionDirect);

describe("runEmbeddedAgent overflow compaction trigger routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes trigger=overflow when retrying compaction after context overflow", async () => {
    const overflowError = new Error("request_too_large: Request size exceeds model context window");

    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: null }));

    mockedCompactDirect.mockResolvedValueOnce({
      ok: true,
      compacted: true,
      result: {
        summary: "Compacted session",
        firstKeptEntryId: "entry-5",
        tokensBefore: 150000,
      },
    });

    await runEmbeddedAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    expect(mockedCompactDirect).toHaveBeenCalledTimes(1);
    expect(mockedCompactDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "overflow",
        authProfileId: "test-profile",
      }),
    );
  });

  it("hands the attempt's resolved local backings to compaction, so the tool lists match", async () => {
    const overflowError = new Error("request_too_large: Request size exceeds model context window");
    const localBackings = {
      semantic: { repoMap: async () => "map" },
      research: { complete: async () => "answer", fingerprint: async () => [] },
    } as never;

    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError, localBackings }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce({
      ok: true,
      compacted: true,
      result: { summary: "Compacted session", firstKeptEntryId: "entry-5", tokensBefore: 150000 },
    });

    await runEmbeddedAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    expect(mockedCompactDirect).toHaveBeenCalledWith(expect.objectContaining({ trigger: "overflow", localBackings }));
    expect(mockedCompactDirect.mock.calls[0]![0].localBackings).toBe(localBackings);
  });
});
