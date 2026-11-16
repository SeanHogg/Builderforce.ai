/**
 * Tests for the A2A serve handler (`buildA2AHandler` in `inbound.ts`).
 *
 * Focus: the handler must satisfy the embedded-agent runner's contract
 * (`RunEmbeddedAgentParams` requires `runId` and `timeoutMs`) — the exact gap
 * the roadmap called out — and must surface the agent's text reply.
 *
 * The runner is injected through `__setA2aTestRunner` because
 * `loadRunEmbeddedAgent` resolves it via a runtime-computed dynamic import
 * that `vi.mock` cannot intercept.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildA2AHandler, __setA2aTestRunner } from "./inbound.js";
import { setA2aRuntime } from "./runtime.js";

const runnerCalls: Array<Record<string, unknown>> = [];

function mockApi() {
  return {
    config: { agents: { defaults: { workspace: "/tmp/a2a-test-ws" } } },
    resolvePath: (input: string) => `/tmp/a2a-test/${input}`,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe("buildA2AHandler", () => {
  afterEach(() => {
    runnerCalls.length = 0;
    __setA2aTestRunner(null);
  });

  it("passes the required runId and timeoutMs to the embedded runner", async () => {
    __setA2aTestRunner((params) => {
      runnerCalls.push(params);
      return Promise.resolve({ payloads: [{ text: "ok" }] });
    });
    setA2aRuntime(mockApi() as never);
    const handler = buildA2AHandler();
    const res = await handler({
      message: { role: "user", parts: [{ type: "text", text: "hello" }] },
    } as never);
    expect(res.kind).toBe("reply");
    expect(runnerCalls).toHaveLength(1);
    const params = runnerCalls[0];
    expect(typeof params.runId).toBe("string");
    expect((params.runId as string).length).toBeGreaterThan(0);
    expect(typeof params.timeoutMs).toBe("number");
    expect(params.timeoutMs as number).toBeGreaterThan(0);
  });

  it("returns the agent's text reply and echoes the sessionId", async () => {
    __setA2aTestRunner(() => Promise.resolve({ payloads: [{ text: "the answer" }] }));
    setA2aRuntime(mockApi() as never);
    const handler = buildA2AHandler();
    const res = await handler({
      message: { role: "user", parts: [{ type: "text", text: "q" }] },
      sessionId: "sess-1",
    } as never);
    expect(res.kind).toBe("reply");
    if (res.kind === "reply") {
      const text = res.message.parts.map((p) => ("text" in p ? p.text : "")).join("");
      expect(text).toBe("the answer");
      expect(res.sessionId).toBe("sess-1");
    }
  });

  it("rejects an empty message body without invoking the runner", async () => {
    __setA2aTestRunner((params) => {
      runnerCalls.push(params);
      return Promise.resolve({ payloads: [{ text: "unused" }] });
    });
    setA2aRuntime(mockApi() as never);
    const handler = buildA2AHandler();
    const res = await handler({
      message: { role: "user", parts: [{ type: "text", text: "   " }] },
    } as never);
    expect(res.kind).toBe("reply");
    expect(runnerCalls).toHaveLength(0);
  });
});
