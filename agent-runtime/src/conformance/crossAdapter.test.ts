/**
 * The on-prem entry points under the ONE scripted task (PRD 35 §3.3): tickets (`runOnPremAgent`) and channels / cron
 * (`Agent` -> `runChannelAgent`) are held to the SAME `RunEvent` trace and `RunOutcome` as the cloud, canvas and Brain
 * adapters (the task, script, trace and answer are `@builderforce/agent-run`'s `conformanceTask.ts`). Both adapters build
 * their own ports and call `runAgent`; this spies on that one call to read the trace the adapter's ports received, and
 * changes nothing about the run.
 */

import { Type } from "@sinclair/typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent, RunOutcome } from "@builderforce/agent-run";
import {
  CONFORMANCE_ANSWER,
  CONFORMANCE_PROMPT,
  CONFORMANCE_SCRIPT,
  CONFORMANCE_TRACE,
  CONFORMANCE_TOOL,
  conformanceCapabilities,
  conformanceTrace,
} from "@builderforce/agent-run";
import type { ModelCompletion, ModelRequest, ModelTransport } from "@builderforce/agent-run";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { AssistantMessageEventStream } from "../builderforce/agent-loop/event-stream.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentTool } from "../builderforce/model/agent-types.js";
import type { AssistantMessage } from "../builderforce/model/types.js";
import { runOnPremAgent } from "../run/onPremAdapter.js";

const seen = vi.hoisted(() => ({ events: [] as RunEvent[], outcome: undefined as RunOutcome | undefined }));

// Observe the one call every adapter makes: the agent runs exactly as it would, with the adapter's own event sink wrapped to
// copy what it is told into `seen.events`.
vi.mock("@builderforce/agent-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@builderforce/agent-run")>();
  return {
    ...actual,
    runAgent: async (input: Parameters<typeof actual.runAgent>[0]) => {
      const outcome = await actual.runAgent({ ...input, ports: { ...input.ports, events: actual.teeEvents(input.ports.events, seen.events) } });
      seen.outcome = outcome;
      return outcome;
    },
  };
});

beforeEach(() => {
  seen.events.length = 0;
  seen.outcome = undefined;
});

/** A model that replays the shared script and records what it was asked. */
function scripted(requests: ModelRequest[] = []): ModelTransport {
  let n = 0;
  return {
    complete: async (request): Promise<ModelCompletion> => {
      requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
      const answer = CONFORMANCE_SCRIPT[n++];
      if (!answer) throw new Error("script exhausted");
      return answer;
    },
  };
}

describe("on-prem tickets under the shared scripted task", () => {
  it("emits the shared RunEvent trace and the shared answer", async () => {
    const sinks = { onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn(), onSteerApplied: vi.fn(), onOutcome: vi.fn() };
    const result = await runOnPremAgent(
      { prompt: CONFORMANCE_PROMPT, cwd: "/work/ticket", anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k", transport: scripted(), capabilities: conformanceCapabilities() },
      sinks,
    );

    expect(conformanceTrace(seen.events)).toEqual(CONFORMANCE_TRACE);
    expect(result).toEqual({ ok: true, text: CONFORMANCE_ANSWER });
    expect(seen.outcome).toMatchObject({ kind: "finished", output: CONFORMANCE_ANSWER });
  });
});

// ── channels / cron: the Agent over a scripted provider stream ────────────────────────────────────────────────────────

const model = {
  id: "fake-model",
  name: "fake-model",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1000,
};
const usage = { input: 7, output: 11, cacheRead: 2, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return { role: "assistant", content, api: "openai-completions", provider: "p", model: "fake-model", usage, stopReason, timestamp: 1 };
}

/** The shared script as the provider stream speaks it. */
const providerTurns: AssistantMessage[] = CONFORMANCE_SCRIPT.map((c) =>
  c.toolCalls?.length
    ? assistant(c.toolCalls.map((call) => ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: JSON.parse(call.arguments) as Record<string, unknown> })), "toolUse")
    : assistant([{ type: "text", text: c.content }], "stop"),
);

describe("channels and cron under the shared scripted task", () => {
  it("emits the shared RunEvent trace and the shared answer", async () => {
    let n = 0;
    const streamFn: StreamFn = () => {
      const stream = new AssistantMessageEventStream();
      const msg = providerTurns[n++]!;
      queueMicrotask(() => {
        stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
        stream.end();
      });
      return stream;
    };
    // The channel's catalog is its own: the runner's tools, here one of the shared tool's name.
    const listFiles: AgentTool = {
      name: CONFORMANCE_TOOL,
      label: CONFORMANCE_TOOL,
      description: "lists files",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, paths: [] }) }], details: {} }),
    };
    const agent = new Agent({ model, tools: [listFiles], systemPrompt: "sys" });
    agent.streamFn = streamFn;

    const produced = await agent.prompt([{ role: "user", content: CONFORMANCE_PROMPT, timestamp: 0 }]);

    // FINDING (reported, pinned as it is): the ONE difference from the golden is that the channel's model port names a model
    // `<provider>/<id>` (`p/fake-model`), where the gateway and the cloud report the bare id. The run keys its pins and fallbacks on the
    // ref, so the trace keeps it; the outcome row is normalised to the bare id (`channelAdapter.ts`, `channelOutcome.test.ts`).
    const expected = CONFORMANCE_TRACE.map((fact) => fact.replace("model.completed:fake-model", "model.completed:p/fake-model"));
    expect(conformanceTrace(seen.events)).toEqual(expected);
    // ...and the run ends the same way: the agent's own outcome, not just the reply the session recorded.
    expect(seen.outcome).toMatchObject({ kind: "finished", output: CONFORMANCE_ANSWER });
    expect(JSON.stringify(produced.at(-1))).toContain(CONFORMANCE_ANSWER);
  });
});
