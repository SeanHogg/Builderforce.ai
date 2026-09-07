import { describe, expect, it, vi } from "vitest";

// Mock the SDK runner so the test asserts the AgentEngine adapter mapping, not the SDK.
const runMock = vi.fn();
vi.mock("../agents/claude-agent-sdk-runner.js", () => ({
  runClaudeAgentSdkV2: (params: unknown, sinks: unknown) => runMock(params, sinks),
}));

import { CURRENT_ENGINE_ID } from "@builderforce/agent-tools";
import { createSteeringChannel } from "./relay-steering.js";
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
  it("carries the shared current engine id", () => {
    const { engine } = makeEngine();
    expect(engine.id).toBe(CURRENT_ENGINE_ID);
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

/**
 * GAP-B2/B4 — the gateway can only apply its fail-closed BYO rule to a CLOUD agent
 * execution if the runner declares what it is. The SDK exposes no header hook other
 * than `ANTHROPIC_CUSTOM_HEADERS`, so that string is the contract.
 */
describe("gateway surface declaration", () => {
  it("passes the surface + execution id through to the SDK runner", async () => {
    runMock.mockResolvedValueOnce({ ok: true, text: "done" });
    const { engine } = makeEngine({ surface: "on_prem", executionId: 77 });

    await engine.run({ systemPrompt: "", userContent: "x" });

    expect(runMock.mock.calls.at(-1)![0]).toMatchObject({ surface: "on_prem", executionId: 77 });
  });

  it("omits both when the caller declares neither (unchanged behaviour)", async () => {
    runMock.mockResolvedValueOnce({ ok: true, text: "done" });
    const { engine } = makeEngine();

    await engine.run({ systemPrompt: "", userContent: "x" });

    const params = runMock.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect("surface" in params).toBe(false);
    expect("executionId" in params).toBe(false);
  });
});

/** GAP A3 — the steering channel is a construction collaborator like the abort handle. */
describe("mid-run steering channel", () => {
  it("passes the channel through to the SDK runner", async () => {
    runMock.mockResolvedValueOnce({ ok: true, text: "done" });
    const steering = createSteeringChannel();
    const { engine } = makeEngine({ steering });

    await engine.run({ systemPrompt: "", userContent: "x" });

    expect(runMock.mock.calls.at(-1)![0]).toMatchObject({ steering });
  });

  it("omits it when the caller supplies none (single-turn run)", async () => {
    runMock.mockResolvedValueOnce({ ok: true, text: "done" });
    const { engine } = makeEngine();

    await engine.run({ systemPrompt: "", userContent: "x" });

    expect("steering" in (runMock.mock.calls.at(-1)![0] as object)).toBe(false);
  });
});
