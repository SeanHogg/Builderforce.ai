import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../model/agent-types.js";
import { defaultConvertToLlm } from "./agent-loop.js";
import { estimateTokens, serializeConversation } from "./compaction.js";

describe("native compaction helpers", () => {
  it("estimateTokens uses the char/4 heuristic per role", () => {
    expect(estimateTokens({ role: "user", content: "x".repeat(40), timestamp: 0 })).toBe(10);
    expect(
      estimateTokens({
        role: "bashExecution",
        command: "ls",
        output: "x".repeat(38),
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 0,
      }),
    ).toBe(10);
    expect(
      estimateTokens({ role: "compactionSummary", summary: "abcd", tokensBefore: 0, timestamp: 0 }),
    ).toBe(1);
  });

  it("serializeConversation renders user/assistant/tool turns into a readable transcript", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "do the thing", timestamp: 0 },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        api: "openai-completions",
        provider: "p",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    const text = serializeConversation(defaultConvertToLlm(messages));
    expect(text).toContain("[User]: do the thing");
    expect(text).toContain("[Assistant]: ok");
  });
});
