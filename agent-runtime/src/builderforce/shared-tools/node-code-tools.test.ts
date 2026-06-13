/**
 * Proves the Node-native code-intelligence tools are wired into the shared contract:
 * `buildNodeToolRegistry()` exposes them, they are capability-gated to the Node
 * provider, and the {@link LocalAgentEngine} dispatches one (project_knowledge /
 * codebase_search) end-to-end against a real temp workspace — pi-free.
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildNodeToolRegistry, buildNodeCapabilityProvider } from "./index.js";
import { LocalAgentEngine, type LlmComplete, type RawToolCall } from "./local-agent-engine.js";
import { runCodebaseSearch, runGitHistory } from "./node-code-tools.js";

let workspace: string;
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "node-code-tools-"));
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function call(name: string, args: Record<string, unknown>): RawToolCall {
  return { id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("Node code-intelligence tools (shared contract, pi-free)", () => {
  it("registers all five tools and gates them to the Node provider's capabilities", () => {
    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const names = registry.toolsFor(provider).map((t) => t.name);
    for (const expected of ["git_history", "code_analysis", "project_knowledge", "codebase_search", "codebase_semantic_search"]) {
      expect(names).toContain(expected);
    }
    // Plus the core tools are still present.
    expect(names).toContain("write_file");
    expect(names).toContain("finish");
  });

  it("runs codebase_search through the engine against a real workspace, using ctx.workspaceRoot", async () => {
    await fs.writeFile(path.join(workspace, "auth.ts"), "export function authenticateUser() { return true; }\n", "utf8");

    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    let captured: Record<string, unknown> | undefined;

    const turns: Array<{ content: string; toolCalls: RawToolCall[] }> = [
      { content: "searching", toolCalls: [call("codebase_search", { query: "authenticate user" })] },
      { content: "", toolCalls: [call("finish", { summary: "done" })] },
    ];
    let turn = 0;
    const complete: LlmComplete = async () => turns[turn++] ?? { content: "", toolCalls: [] };

    const engine = new LocalAgentEngine({
      registry,
      provider,
      workspaceRoot: workspace,
      complete,
      sinks: { onToolResult: (name, _id, result) => { if (name === "codebase_search") captured = result; } },
    });
    const result = await engine.run({ systemPrompt: "s", userContent: "find auth" });

    expect(result.finished).toBe(true);
    expect(captured).toBeDefined();
    // Either it matched the file, or rg/grep is unavailable — but it must not error on the root.
    expect(captured?.error).toBeUndefined();
    expect(captured).toHaveProperty("query", "authenticate user");
  });

  it("runGitHistory reads a real repo's log", () => {
    execSync("git init -q", { cwd: workspace });
    execSync('git config user.email "t@t.dev" && git config user.name "T"', { cwd: workspace });
    execSync("git commit -q --allow-empty -m seed", { cwd: workspace });
    const r = runGitHistory(workspace, {}) as { totalCommits?: number; error?: string };
    expect(r.error).toBeUndefined();
    expect(r.totalCommits).toBeGreaterThanOrEqual(1);
  });

  it("runCodebaseSearch reports a missing root cleanly instead of throwing", async () => {
    const r = (await runCodebaseSearch(path.join(workspace, "does-not-exist"), { query: "anything" })) as {
      error?: string;
    };
    expect(typeof r.error).toBe("string");
  });
});
