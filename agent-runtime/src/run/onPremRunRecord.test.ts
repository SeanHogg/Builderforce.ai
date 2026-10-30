import type { CapabilityProvider, RunKnowledgeLog } from "@builderforce/agent-tools";
import type { ModelCompletion, ModelTransport } from "@builderforce/agent-run";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On-prem runs record knowledge: every SUCCESSFUL tool call lands in the run's record, so
 * the run end can write a code map like every runtime. (Retargeted from the deleted Claude
 * Agent SDK runner to the public seam that carries the same behaviour, PRD 35 §5.1: the
 * scripted model replaces the SDK's scripted `query()`, and the SDK's `Read` / `file_path`
 * are the catalog's `read_file` / `path`.)
 */

/** Scripted model output: one completion per model call. */
let script: ModelCompletion[] = [];

import { runOnPremAgent } from "../run/onPremAdapter.js";

const ROOT = "/work/ticket";

/** A model turn that makes one tool call. */
function toolUse(id: string, name: string, input: Record<string, unknown>): ModelCompletion {
  return { content: "", toolCalls: [{ id, name, arguments: JSON.stringify(input) }] };
}

const scriptedModel = (): ModelTransport => {
  let call = 0;
  return { complete: async () => script[call++] ?? { content: "" } };
};

/** A working tree whose files all exist; a whole-file write fails, so that call is a failed call. */
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

describe("runOnPremAgent — the run's record", () => {
  it("records the task and successful calls, so the run consolidates into a code map", async () => {
    script = [
      toolUse("1", "read_file", { path: `${ROOT}/api/src/run/a.ts` }),
      toolUse("2", "read_file", { path: `${ROOT}/api/src/run/b.ts` }),
      toolUse("3", "edit_file", { path: `${ROOT}/api/src/run/c.ts`, old_string: "x", new_string: "y" }),
      toolUse("4", "write_file", { path: `${ROOT}/api/src/run/failed.ts`, content: "y" }),
      { content: "done" },
    ];
    let knowledge: RunKnowledgeLog | undefined;
    const out = await runOnPremAgent(
      {
        prompt: "fix the run loop",
        cwd: ROOT,
        anthropicBaseUrl: "https://gw/llm",
        gatewayAuthKey: "k",
        transport: scriptedModel(),
        capabilities: workspace(),
        onRunRecord: (record) => {
          knowledge = record;
        },
      },
      sinks(),
    );
    expect(out.ok).toBe(true);
    expect(knowledge?.activity.prompt).toBe("fix the run loop");
    const map = knowledge?.consolidate({ root: ROOT });
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
