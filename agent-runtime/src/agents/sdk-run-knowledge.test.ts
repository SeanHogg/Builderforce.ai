import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BuilderForce-V2 (Claude Agent SDK) runs record knowledge: every SUCCESSFUL tool call
 * lands in the run's record, so the run end can write a code map like every runtime.
 */

/** Scripted SDK output for one turn. */
let script: unknown[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: { prompt: AsyncIterable<unknown> }) =>
    (async function* () {
      for await (const _input of params.prompt) {
        for (const msg of script) yield msg;
      }
    })(),
}));
vi.mock("./sdk-memory-server.js", () => ({
  buildSdkMemoryServer: async () => null,
  SDK_MEMORY_SERVER: "builderforce_memory",
  SDK_MEMORY_TOOLS: "mcp__builderforce_memory",
}));

import { mapSdkMessage } from "./claude-agent-v2-events.js";
import { runClaudeAgentSdkV2 } from "./claude-agent-sdk-runner.js";
import { sdkKnowledgeFeed, sdkToolName } from "./sdk-run-knowledge.js";

const ROOT = "/work/ticket";

function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } };
}
function toolResult(id: string, isError = false) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "x" }] } };
}

const sinks = () => ({ onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn() });

beforeEach(() => {
  script = [];
});

describe("mapSdkMessage — tool results", () => {
  it("maps a user turn's tool_result blocks to tool_result events", () => {
    expect(mapSdkMessage(toolResult("t1"))).toEqual([{ kind: "tool_result", toolUseId: "t1", isError: false }]);
    expect(mapSdkMessage(toolResult("t2", true))).toEqual([{ kind: "tool_result", toolUseId: "t2", isError: true }]);
    expect(mapSdkMessage({ type: "user", message: { content: "plain steer" } })).toEqual([]);
  });
});

describe("sdkKnowledgeFeed", () => {
  it("records a call only once its result succeeded, in the record's tool vocabulary", () => {
    const log = new RunKnowledgeRecorder();
    const feed = sdkKnowledgeFeed(log);
    feed.toolUse("Read", "a", { file_path: "src/a.ts" });
    feed.toolUse("Write", "b", { file_path: "src/b.ts", content: "" });
    feed.toolUse("Edit", "c", { file_path: "src/c.ts" });
    feed.toolResult("a", false);
    feed.toolResult("b", true);
    feed.toolResult("c", false);
    feed.toolResult("unknown", false);
    expect(log.activity.read).toEqual(["src/a.ts"]);
    expect(log.activity.created).toEqual([]);
    expect(log.activity.edited).toEqual(["src/c.ts"]);
    expect(sdkToolName(" Grep ")).toBe("grep");
  });
});

describe("runClaudeAgentSdkV2 — the run's record", () => {
  it("records the task and successful calls, so the run consolidates into a code map", async () => {
    script = [
      toolUse("1", "Read", { file_path: `${ROOT}/api/src/run/a.ts` }),
      toolResult("1"),
      toolUse("2", "Read", { file_path: `${ROOT}/api/src/run/b.ts` }),
      toolResult("2"),
      toolUse("3", "Edit", { file_path: `${ROOT}/api/src/run/c.ts` }),
      toolResult("3"),
      toolUse("4", "Write", { file_path: `${ROOT}/api/src/run/failed.ts` }),
      toolResult("4", true),
      { type: "result", subtype: "success", result: "done" },
    ];
    const knowledge = new RunKnowledgeRecorder();
    const out = await runClaudeAgentSdkV2(
      { prompt: "fix the run loop", cwd: ROOT, anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k", knowledge },
      sinks(),
    );
    expect(out.ok).toBe(true);
    expect(knowledge.activity.prompt).toBe("fix the run loop");
    const map = knowledge.consolidate({ root: ROOT });
    expect(map?.key).toBe("codemap:api/src/run");
    expect(map?.content).toContain("- api/src/run/c.ts (changed)");
    expect(map?.content).not.toContain("failed.ts");
  });

  it("records nothing without a record, and still forwards tool use", async () => {
    script = [toolUse("1", "Read", { file_path: "a.ts" }), toolResult("1"), { type: "result", subtype: "success", result: "ok" }];
    const s = sinks();
    await runClaudeAgentSdkV2({ prompt: "p", cwd: ROOT, anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k" }, s);
    expect(s.onToolUse).toHaveBeenCalledWith("Read", "1", { file_path: "a.ts" });
  });
});
