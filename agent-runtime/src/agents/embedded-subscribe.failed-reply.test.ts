/**
 * A run that FAILED but says why as an ordinary reply (`runFailed`, the channel runner's notice after a budget or breaker stop) still
 * ends its lifecycle in the ERROR phase, as an errored turn did, so the consumers that watch for a failed run are told: the parent of a
 * sub-agent, `agent.wait`, the web chat. No classifier or friendly-error rewrite reads the reply's text.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../builderforce/model/types.js";
import { createStubSessionHarness } from "./embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedSession } from "./embedded-subscribe.js";

vi.mock("../gateway/call.js", () => ({ callGateway: vi.fn(async () => ({ status: "pending" })) }));
vi.mock("../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/config.js")>()),
  loadConfig: vi.fn(() => ({ agents: { defaults: { subagents: { archiveAfterMinutes: 0 } } } })),
}));
vi.mock("./subagent-announce.js", () => ({ runSubagentAnnounceFlow: vi.fn(async () => true) }));
vi.mock("./subagent-registry.store.js", () => ({
  loadSubagentRegistryFromDisk: vi.fn(() => new Map()),
  saveSubagentRegistryToDisk: vi.fn(() => {}),
}));

/** The notice's text reads like an error class on purpose: nothing may classify or rewrite it. */
const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate rate-limit-exceeded refused some of its tool calls.";

const reply = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({
    role: "assistant",
    content: [{ type: "text", text: NOTICE }],
    stopReason: "stop",
    provider: "p",
    model: "m",
    api: "openai-completions",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: 1,
    ...over,
  }) as AssistantMessage;

function endRun(runId: string, message: AssistantMessage) {
  const { session, emit } = createStubSessionHarness();
  const onAgentEvent = vi.fn();
  subscribeEmbeddedSession({ session, runId, onAgentEvent, sessionKey: "agent:main:subagent:child" });
  emit({ type: "message_start", message });
  emit({ type: "message_end", message });
  emit({ type: "agent_end" });
  return onAgentEvent.mock.calls.map((c) => c[0] as { stream?: string; data?: { phase?: string; error?: string } }).filter((e) => e.stream === "lifecycle");
}

describe("the lifecycle of a run that failed but said why as its reply", () => {
  it("ends in the error phase carrying the text exactly as written", () => {
    const lifecycle = endRun("run-failed-reply", reply({ runFailed: true }));

    expect(lifecycle.map((e) => e.data?.phase)).toEqual(["error"]);
    expect(lifecycle[0]!.data?.error).toBe(NOTICE);
  });

  it("an ordinary reply still ends the lifecycle", () => {
    expect(endRun("run-ok", reply()).map((e) => e.data?.phase)).toEqual(["end"]);
  });
});

describe("the parent of a sub-agent whose run failed this way", () => {
  let registry: typeof import("./subagent-registry.js");
  beforeAll(async () => {
    registry = await import("./subagent-registry.js");
  });
  afterEach(() => registry.resetSubagentRegistryForTests({ persist: false }));

  const register = (runId: string) =>
    registry.registerSubagentRun({
      runId,
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "do the thing",
      cleanup: "keep",
    });

  it("is told the sub-agent FAILED, with the reason", () => {
    register("run-sub-failed");
    endRun("run-sub-failed", reply({ runFailed: true }));

    const run = registry.listSubagentRunsForRequester("agent:main:main")[0];
    expect(run?.outcome).toEqual({ status: "error", error: NOTICE });
  });

  it("control: a sub-agent whose reply is an ordinary one finished ok", () => {
    register("run-sub-ok");
    endRun("run-sub-ok", reply());

    expect(registry.listSubagentRunsForRequester("agent:main:main")[0]?.outcome).toEqual({ status: "ok" });
  });
});
