/**
 * A governance path through the LIVE attempt: the real `runEmbeddedAttempt` builds the real session, tools and agent, and only the model's
 * stream is scripted (no credentials, no network). A tenant `block` gate on `exec` must (1) withhold the shell tool from what the model is
 * offered, (2) refuse the call a scripted model makes anyway so nothing runs, and (3) report the gate into the RUN's governance scope,
 * which outlives the attempt. This is the hop `attempt.ts` -> `createAgentSession` -> `Agent` -> channel runner that mocked-attempt tests skip.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, Model } from "../../../builderforce/model/types.js";

const seen: Context[] = [];

vi.mock("../../../builderforce/agent-loop/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../builderforce/agent-loop/index.js")>();
  const { AssistantMessageEventStream } = await import("../../../builderforce/agent-loop/event-stream.js");
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const turn = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "p",
    model: "m",
    usage,
    stopReason,
    timestamp: 1,
  });
  let n = 0;
  const nativeStreamSimple = (_model: unknown, context: Context) => {
    seen.push({ ...context, messages: [...context.messages] });
    const message =
      n++ === 0
        ? turn([{ type: "toolCall", id: "c1", name: "exec", arguments: { command: "echo should-not-run" } }], "toolUse")
        : turn([{ type: "text", text: "understood" }], "stop");
    const stream = new AssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
      stream.end();
    });
    return stream;
  };
  return { ...real, nativeStreamSimple };
});

import { createRunGovernance } from "../../../builderforce/agent-loop/run-governance.js";
import { runEmbeddedAttempt } from "./attempt.js";

let root = "";
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-live-attempt-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const model = {
  id: "m",
  name: "m",
  api: "openai-completions",
  provider: "p",
  baseUrl: "http://127.0.0.1:9",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
} as unknown as Model;

describe("the live attempt under a tenant block gate", () => {
  it("withholds the tool, refuses the call, and reports the gate into the run's governance scope", async () => {
    const governance = createRunGovernance();
    const workspaceDir = path.join(root, "workspace");

    const result = await runEmbeddedAttempt({
      sessionId: "live-1",
      sessionKey: "agent:main:live",
      sessionFile: path.join(root, "session.jsonl"),
      workspaceDir,
      agentDir: path.join(root, "agent"),
      config: {},
      prompt: "run the build",
      provider: "p",
      modelId: "m",
      model,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      timeoutMs: 60_000,
      runId: "live-run-1",
      policyGates: [{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off for this tenant" }],
      governance,
    } as never);

    // (1) withheld: the first request the model saw offered no shell tool
    const offered = (seen[0]?.tools ?? []).map((t) => t.name);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain("exec");
    // (2) refused: the call the scripted model made anyway got the gate's refusal, not a command's output
    const refusal = JSON.stringify(result.messagesSnapshot.filter((m) => (m as { role?: string }).role === "toolResult"));
    expect(refusal).toContain("no-shell");
    expect(refusal).not.toContain("should-not-run\\n");
    // (3) reported into the RUN's scope, which outlives this attempt
    expect(governance.refusals()).toEqual(["no-shell"]);
  }, 120_000);
});
