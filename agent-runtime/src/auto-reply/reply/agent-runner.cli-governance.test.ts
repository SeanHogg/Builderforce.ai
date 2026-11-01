/**
 * A CLI primary that tenant governance refuses moves the run to the next candidate WITHOUT a lifecycle error: the web chat shows an
 * error for a run whose lifecycle ends in one, and nothing about this run failed (it was routed to an embedded model). The refusal
 * is decided before the CLI attempt announces itself, so no "start" / "error" pair is emitted for it either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FailoverError } from "../../agents/failover-error.js";
import { onAgentEvent, type AgentEventPayload } from "../../infra/agent-events.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const state = vi.hoisted(() => ({
  runEmbeddedAgentMock: vi.fn(),
  runCliAgentMock: vi.fn(),
  governMock: vi.fn(),
}));

// The chain is [the CLI primary, then an embedded model]; a failure moves on, as the real fallback does.
vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({ provider, model, run }: { provider: string; model: string; run: (p: string, m: string) => Promise<unknown> }) => {
    try {
      return { result: await run(provider, model), provider, model };
    } catch {
      return { result: await run("anthropic", "claude"), provider: "anthropic", model: "claude" };
    }
  },
}));
vi.mock("../../agents/embedded.js", () => ({
  queueEmbeddedMessage: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: (params: unknown) => state.runEmbeddedAgentMock(params),
}));
vi.mock("../../agents/cli-runner.js", () => ({ runCliAgent: (params: unknown) => state.runCliAgentMock(params) }));
vi.mock("../../agents/cli-runner/governance.js", () => ({ governCliRun: (target: unknown) => state.governMock(target) }));
vi.mock("./queue.js", () => ({ enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BUILDERFORCE_AGENTS_TEST_FAST", "1");
  state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: { agentMeta: { usage: { input: 1, output: 1 } } } });
  state.runCliAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: { agentMeta: { usage: { input: 1, output: 1 } } } });
});

async function runTurn() {
  const { runReplyAgent } = await import("./agent-runner.js");
  const typing = createMockTypingController();
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
      provider: "codex-cli",
      model: "gpt",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as unknown as FollowupRun;
  const lifecycle: AgentEventPayload[] = [];
  const stop = onAgentEvent((evt) => {
    if (evt.stream === "lifecycle") lifecycle.push(evt);
  });
  try {
    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue: { mode: "interrupt" } as unknown as QueueSettings,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      opts: undefined,
      typing,
      sessionKey: "main",
      sessionCtx: { Provider: "whatsapp", MessageSid: "msg" } as unknown as TemplateContext,
      defaultModel: "anthropic/claude-opus-4-5",
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });
  } finally {
    stop();
  }
  return lifecycle;
}

describe("a governed CLI primary", () => {
  it("falls over to the embedded model with no lifecycle event from the refused attempt", async () => {
    state.governMock.mockRejectedValue(new FailoverError("refused by gate no-shell", { reason: "unknown", provider: "codex-cli" }));

    const lifecycle = await runTurn();

    expect(state.governMock).toHaveBeenCalledWith({ provider: "codex-cli", model: "gpt" });
    expect(state.runCliAgentMock).not.toHaveBeenCalled();
    expect(state.runEmbeddedAgentMock).toHaveBeenCalledTimes(1);
    expect(lifecycle.filter((e) => e.data.phase === "error")).toEqual([]);
    expect(lifecycle.filter((e) => e.data.phase === "start")).toEqual([]);
  });

  it("control: an ungoverned CLI primary runs and announces its lifecycle as before", async () => {
    state.governMock.mockResolvedValue("");

    const lifecycle = await runTurn();

    expect(state.runCliAgentMock).toHaveBeenCalledTimes(1);
    expect(state.runEmbeddedAgentMock).not.toHaveBeenCalled();
    expect(lifecycle.map((e) => e.data.phase)).toEqual(["start", "end"]);
  });
});
