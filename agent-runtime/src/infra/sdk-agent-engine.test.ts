import { describe, expect, it, vi } from "vitest";

// Mock the SDK runner so the test asserts the AgentEngine adapter mapping, not the SDK.
const runMock = vi.fn();
vi.mock("../agents/claude-agent-sdk-runner.js", () => ({
  runClaudeAgentSdkV2: (params: unknown, sinks: unknown) => runMock(params, sinks),
}));

import { ENGINE_IDS } from "@builderforce/agent-tools";
import { ClaudeSdkAgentEngine } from "./sdk-agent-engine.js";

function makeEngine(over?: Partial<ConstructorParameters<typeof ClaudeSdkAgentEngine>[0]>) {
  const abortController = new AbortController();
  const sinks = { onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn() };
  const engine = new ClaudeSdkAgentEngine({
    cwd: "/work",
    anthropicBaseUrl: "https://gw.test/llm",
    gatewayAuthKey: "k",
    abortController,
    sinks,
    ...over,
  });
  return { engine, abortController, sinks };
}

describe("ClaudeSdkAgentEngine", () => {
  it("carries the shared v2 engine id", () => {
    const { engine } = makeEngine();
    expect(engine.id).toBe(ENGINE_IDS.v2);
  });

  it("maps AgentRunInput → SDK params and SDK result → a terminal AgentRunResult", async () => {
    runMock.mockResolvedValueOnce({ ok: true, text: "done" });
    const { engine, abortController, sinks } = makeEngine();

    const result = await engine.run({
      systemPrompt: "persona",
      userContent: "do the task",
      model: "anthropic/claude-sonnet-4.6",
    });

    const [params, passedSinks] = runMock.mock.calls[0];
    expect(params).toMatchObject({
      prompt: "do the task",
      model: "anthropic/claude-sonnet-4.6",
      cwd: "/work",
      anthropicBaseUrl: "https://gw.test/llm",
      gatewayAuthKey: "k",
      // contract systemPrompt → SDK appendSystemPrompt (the runner prepends it)
      appendSystemPrompt: "persona",
      abortController,
    });
    expect(passedSinks).toBe(sinks);
    expect(result).toEqual({ ok: true, output: "done", cancelled: false, finished: true });
  });

  it("reports cancelled when the abort handle fired", async () => {
    runMock.mockResolvedValueOnce({ ok: false, text: "stopped" });
    const { engine, abortController } = makeEngine();
    abortController.abort();

    const result = await engine.run({ systemPrompt: "", userContent: "x" });

    expect(result).toEqual({ ok: false, output: "stopped", cancelled: true, finished: true });
  });
});
