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
  /** The chain has no embedded candidate: a failure is the run's. */
  noFallback: false,
}));

// The chain is [the CLI primary, then an embedded model]; a failure moves on, as the real fallback does.
vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({ provider, model, run }: { provider: string; model: string; run: (p: string, m: string) => Promise<unknown> }) => {
    try {
      return { result: await run(provider, model), provider, model };
    } catch (err) {
      if (state.noFallback) throw err;
      return { result: await run("anthropic", "claude"), provider: "anthropic", model: "claude" };
    }
  },
}));
vi.mock("../../agents/embedded.js", () => ({
  queueEmbeddedMessage: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: (params: unknown) => state.runEmbeddedAgentMock(params),
}));
vi.mock("../../agents/cli-runner.js", () => ({ runCliAgent: (params: unknown) => state.runCliAgentMock(params) }));
vi.mock("../../agents/cli-runner/governance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/cli-runner/governance.js")>()),
  governCliRun: (target: unknown) => state.governMock(target),
}));
vi.mock("./queue.js", () => ({ enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  state.noFallback = false;
  vi.stubEnv("BUILDERFORCE_AGENTS_TEST_FAST", "1");
  state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: { agentMeta: { usage: { input: 1, output: 1 } } } });
  state.runCliAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: { agentMeta: { usage: { input: 1, output: 1 } } } });
});

async function runTurn(opts?: Record<string, unknown>) {
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
  let reply: unknown;
  try {
    reply = await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue: { mode: "interrupt" } as unknown as QueueSettings,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      opts: opts as never,
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
  return { lifecycle, reply };
}

describe("a governed CLI primary", () => {
  it("falls over to the embedded model with no lifecycle event from the refused attempt", async () => {
    state.governMock.mockRejectedValue(new FailoverError("refused by gate no-shell", { reason: "unknown", provider: "codex-cli" }));

    const { lifecycle } = await runTurn();

    expect(state.governMock).toHaveBeenCalledWith({ provider: "codex-cli", model: "gpt" });
    expect(state.runCliAgentMock).not.toHaveBeenCalled();
    expect(state.runEmbeddedAgentMock).toHaveBeenCalledTimes(1);
    expect(lifecycle.filter((e) => e.data.phase === "error")).toEqual([]);
    expect(lifecycle.filter((e) => e.data.phase === "start")).toEqual([]);
  });

  it("is not announced as the selected model when governance refuses it", async () => {
    state.governMock.mockRejectedValue(new FailoverError("refused by gate no-shell", { reason: "unknown", provider: "codex-cli" }));
    const selected: string[] = [];

    await runTurn({ onModelSelected: (m: { provider: string }) => selected.push(m.provider) });

    expect(selected).toEqual(["anthropic"]);
  });

  it("with no embedded candidate the failure names the gates and is NOT mistaken for a context overflow, whatever the gate is called", async () => {
    state.noFallback = true;
    state.governMock.mockRejectedValue(
      new FailoverError("The codex-cli CLI backend cannot be held to this tenant's governance gates, so it was not used. Gates in force: «prompt-limit (block exec)».", {
        reason: "unknown",
        provider: "codex-cli",
      }),
    );

    const { reply } = await runTurn();

    const text = JSON.stringify(reply);
    expect(text).toContain("Agent failed before reply");
    expect(text).toContain("prompt-limit");
    expect(text).not.toContain("Context overflow");
  });

  it("control: an ungoverned CLI primary runs and announces its lifecycle as before", async () => {
    state.governMock.mockResolvedValue("");

    const { lifecycle } = await runTurn();

    expect(state.runCliAgentMock).toHaveBeenCalledTimes(1);
    expect(state.runEmbeddedAgentMock).not.toHaveBeenCalled();
    expect(lifecycle.map((e) => e.data.phase)).toEqual(["start", "end"]);
  });
});
