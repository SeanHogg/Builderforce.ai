import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { ModelCompletion, ModelTransport } from "@builderforce/agent-run";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On-prem runs record knowledge: every SUCCESSFUL tool call lands in the run's record, so
 * the run end can write a code map like every runtime. (The run-level cases are retargeted
 * from the deleted Claude Agent SDK runner to the public seam that carries the same
 * behaviour, PRD 35 §5.1: the scripted model replaces the SDK's scripted `query()`.)
 */

/** Scripted model output: one completion per model call. */
let script: ModelCompletion[] = [];

import { mapSdkMessage } from "./claude-agent-v2-events.js";
import { runOnPremAgent } from "../run/onPremAdapter.js";
import { sdkKnowledgeFeed, sdkToolName } from "./sdk-run-knowledge.js";

const ROOT = "/work/ticket";

/** A model turn that makes one tool call. */
function toolUse(id: string, name: string, input: Record<string, unknown>): ModelCompletion {
  return { content: "", toolCalls: [{ id, name, arguments: JSON.stringify(input) }] };
}
function toolResult(id: string, isError = false) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "x" }] } };
}

const scriptedModel = (): ModelTransport => {
  let call = 0;
  return { complete: async () => script[call++] ?? { content: "" } };
};

/** A working tree whose files all exist; a whole-file write is refused, so the failed call is a failed call. */
const workspace = (): CapabilityProvider => ({
  capabilities: new Set(["repo.read", "repo.edit", "repo.write"]),
  repoRead: {
    listFiles: async () => ({ ok: true, paths: [] }),
    readFile: async (path: string) => ({ ok: true, path, content: "x" }),
    searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
  },
  repoWrite: {
    writeFile: async () => ({ ok: false, error: "disk full" }),
    editFile: async () => ({ ok: true, change: "modified", replaced: 1 }),
    deleteFile: async () => ({ ok: true, deleted: true }),
  },
});

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

describe("runOnPremAgent — the run's record", () => {
  it("records the task and successful calls, so the run consolidates into a code map", async () => {
    script = [
      toolUse("1", "read_file", { path: `${ROOT}/api/src/run/a.ts` }),
      toolUse("2", "read_file", { path: `${ROOT}/api/src/run/b.ts` }),
      toolUse("3", "edit_file", { path: `${ROOT}/api/src/run/c.ts`, old_string: "x", new_string: "y" }),
      toolUse("4", "write_file", { path: `${ROOT}/api/src/run/failed.ts`, content: "y" }),
      { content: "done" },
    ];
    const committed: unknown[] = [];
    const out = await runOnPremAgent(
      {
        prompt: "fix the run loop",
        cwd: ROOT,
        anthropicBaseUrl: "https://gw/llm",
        gatewayAuthKey: "k",
        transport: scriptedModel(),
        capabilities: workspace(),
        commitMemory: (consolidated) => {
          committed.push(consolidated);
        },
      },
      sinks(),
    );
    expect(out.ok).toBe(true);
    const map = committed[0] as { key?: string; content?: string } | undefined;
    expect(map?.content).toContain('asked: "fix the run loop"');
    expect(map?.key).toBe("codemap:api/src/run");
    expect(map?.content).toContain("- api/src/run/c.ts (changed)");
    expect(map?.content).not.toContain("failed.ts");
  });

  it("records nothing without a record, and still forwards tool use", async () => {
    script = [toolUse("1", "read_file", { path: "a.ts" }), { content: "ok" }];
    const s = sinks();
    await runOnPremAgent(
      { prompt: "p", cwd: ROOT, anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k", transport: scriptedModel(), capabilities: workspace() },
      s,
    );
    expect(s.onToolUse).toHaveBeenCalledWith("read_file", "1", { path: "a.ts" });
  });
});
