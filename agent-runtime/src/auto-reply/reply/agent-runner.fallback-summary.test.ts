/**
 * A fallback chain that ends in "all models failed" with a governance refusal among its attempts. The summary joins the attempts, so
 * the refusal's gate ids sit inside the text the classifiers read, and `cause` is only the LAST attempt. The turn must classify the
 * attempts that really ran (see agents/fallback-summary.ts): a gate called `prompt-limit` is not a context overflow, a gate called
 * `compaction-...` does not reset the session, and an embedded 502 followed by a refused CLI fallback is read as the transient 502 it
 * was (a refusal-free chain's summary is read as before).
 * The single-candidate path (which names the gate id) stays in agent-runner.cli-governance.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailoverError, GOVERNANCE_REFUSAL_CODE } from "../../agents/failover-error.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun } from "./queue.js";
import type { TypingSignaler } from "./typing-mode.js";

const state = vi.hoisted(() => ({
  runEmbeddedAgentMock: vi.fn(),
  runCliAgentMock: vi.fn(),
  governMock: vi.fn(),
  /** The chain the real model fallback walks: the run's own model first, then these. */
  fallbacks: [] as string[],
}));

// The REAL fallback, with the chain injected (no config, so no auth store is read).
vi.mock("../../agents/model-fallback.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../agents/model-fallback.js")>();
  return {
    ...real,
    runWithModelFallback: (params: Parameters<typeof real.runWithModelFallback>[0]) =>
      real.runWithModelFallback({ ...params, cfg: undefined, fallbacksOverride: state.fallbacks }),
  };
});
vi.mock("../../agents/embedded.js", () => ({
  queueEmbeddedMessage: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: (params: unknown) => state.runEmbeddedAgentMock(params),
}));
vi.mock("../../agents/cli-runner.js", () => ({ runCliAgent: (params: unknown) => state.runCliAgentMock(params) }));
vi.mock("../../agents/cli-runner/governance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/cli-runner/governance.js")>()),
  governCliRun: (target: unknown) => state.governMock(target),
}));

const refusal = (gate: string) =>
  new FailoverError(`The codex-cli CLI backend cannot be held to this tenant's governance gates, so it was not used. Gates in force: ${gate} (block exec).`, {
    reason: "unknown",
    code: GOVERNANCE_REFUSAL_CODE,
    provider: "codex-cli",
  });
const embeddedFailure = (message: string, status?: number) => new FailoverError(message, { reason: "timeout", provider: "anthropic", ...(status ? { status } : {}) });
const OK = { payloads: [{ text: "ok" }], meta: { agentMeta: { usage: { input: 1, output: 1 } } } };

beforeEach(() => {
  vi.clearAllMocks();
  state.fallbacks = [];
  state.runEmbeddedAgentMock.mockResolvedValue(OK);
  state.runCliAgentMock.mockResolvedValue(OK);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** One turn of the real execution loop; `provider/model` is the run's own (primary) model. */
async function runTurn(primary: { provider: string; model: string }) {
  const { runAgentTurnWithFallback } = await import("./agent-runner-execution.js");
  const resetCompaction = vi.fn().mockResolvedValue(true);
  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      sessionId: "session",
      sessionKey: "main",
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: primary.provider,
      model: primary.model,
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as unknown as FollowupRun;
  const outcome = await runAgentTurnWithFallback({
    commandBody: "hello",
    followupRun,
    sessionCtx: { Provider: "whatsapp", MessageSid: "msg" } as unknown as TemplateContext,
    typingSignals: {
      shouldStartOnReasoning: false,
      signalTextDelta: vi.fn(),
      signalMessageStart: vi.fn(),
      signalReasoningDelta: vi.fn(),
      signalToolStart: vi.fn(),
    } as unknown as TypingSignaler,
    blockReplyPipeline: null,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    applyReplyToMode: (payload) => payload,
    shouldEmitToolResult: () => false,
    shouldEmitToolOutput: () => false,
    pendingToolTasks: new Set(),
    resetSessionAfterCompactionFailure: resetCompaction,
    resetSessionAfterRoleOrderingConflict: vi.fn().mockResolvedValue(false),
    isHeartbeat: false,
    sessionKey: "main",
    getActiveSessionEntry: () => undefined,
    resolvedVerboseLevel: "off",
  });
  return { outcome, resetCompaction };
}

const finalText = (outcome: Awaited<ReturnType<typeof runTurn>>["outcome"]): string => (outcome.kind === "final" ? (outcome.payload.text ?? "") : "");

describe("a fallback chain with a governance refusal among its attempts", () => {
  it("CLI primary refused, embedded fallback failed: reports the real failure, not a context overflow", async () => {
    state.fallbacks = ["anthropic/claude"];
    state.governMock.mockRejectedValue(refusal("prompt-limit"));
    state.runEmbeddedAgentMock.mockRejectedValue(embeddedFailure("upstream exploded"));

    const { outcome } = await runTurn({ provider: "codex-cli", model: "gpt" });

    const text = finalText(outcome);
    expect(text).toContain("Agent failed before reply");
    expect(text).toContain("upstream exploded");
    expect(text).not.toContain("Context overflow");
  });

  it("a compaction-looking gate id does not reset the session", async () => {
    state.fallbacks = ["anthropic/claude"];
    state.governMock.mockRejectedValue(refusal("compaction-prompt-limit"));
    state.runEmbeddedAgentMock.mockRejectedValue(embeddedFailure("upstream exploded"));

    const { outcome, resetCompaction } = await runTurn({ provider: "codex-cli", model: "gpt" });

    expect(resetCompaction).not.toHaveBeenCalled();
    expect(finalText(outcome)).toContain("Agent failed before reply");
    expect(finalText(outcome)).not.toContain("reset our conversation");
  });

  it("embedded primary gets a 502, then the CLI fallback is refused: the 502 is read as transient and the chain is retried", async () => {
    state.fallbacks = ["codex-cli/gpt"];
    state.governMock.mockRejectedValue(refusal("no-shell"));
    // The first cycle fails on the 502 and the refusal; the retried cycle's embedded primary answers.
    state.runEmbeddedAgentMock.mockRejectedValueOnce(embeddedFailure("502 Bad Gateway", 502)).mockResolvedValue(OK);
    // The retry waits 2.5 s between cycles: collapse it.
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const { outcome } = await runTurn({ provider: "anthropic", model: "claude" });

    expect(state.runEmbeddedAgentMock).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe("success");
  });

  it("every attempt refused: still a refusal that names the gates, never a context overflow", async () => {
    state.fallbacks = ["claude-cli/opus"];
    state.governMock.mockRejectedValue(refusal("prompt-limit"));

    const { outcome } = await runTurn({ provider: "codex-cli", model: "gpt" });

    const text = finalText(outcome);
    expect(state.runEmbeddedAgentMock).not.toHaveBeenCalled();
    expect(text).toContain("Agent failed before reply");
    expect(text).toContain("prompt-limit");
    expect(text).not.toContain("Context overflow");
  });
});
