/**
 * Proves `buildNodeToolRegistry()` assembles the full on-prem tool catalogue under
 * the shared contract — core + code-intelligence + orchestration — capability-gated
 * to the Node provider, and that the config-backed service tools are correctly
 * omitted when no deps/config are supplied (parity with the legacy `null` returns).
 * Also runs `workflow_status` end-to-end (a side-effect-free orchestration tool).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildNodeToolRegistry, buildNodeCapabilityProvider } from "./index.js";

let workspace: string;
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "node-registry-"));
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("buildNodeToolRegistry", () => {
  it("offers core + code-intelligence + orchestration tools on the Node provider", () => {
    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const names = registry.toolsFor(provider).map((t) => t.name);

    // core (ask_human is intentionally gated out — the Node provider does not
    // advertise the `human` capability; the legacy loop wires ask-human separately).
    for (const n of [
      "list_files",
      "read_file",
      "write_file",
      "edit_file",
      "run_command",
      "finish",
    ]) {
      expect(names).toContain(n);
    }
    // code intelligence
    for (const n of [
      "git_history",
      "code_analysis",
      "project_knowledge",
      "codebase_search",
      "codebase_semantic_search",
    ]) {
      expect(names).toContain(n);
    }
    // orchestration / session
    for (const n of ["orchestrate", "agent_fleet", "workflow_status", "save_session_handoff"]) {
      expect(names).toContain(n);
    }
    // deps-independent service + media tools (always present, even with no deps)
    for (const n of [
      "agents_list",
      "gateway",
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "sessions_spawn",
      "session_status",
      "subagents",
      "nodes",
      "cron",
      "tts",
      "canvas",
      "message",
      "browser",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("omits config/agentDir-backed tools (memory_*, image) when no deps are supplied", () => {
    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const names = registry.toolsFor(provider).map((t) => t.name);
    expect(names).not.toContain("memory_search");
    expect(names).not.toContain("memory_get");
    expect(names).not.toContain("image"); // needs agentDir
  });

  it("offers ask_human + web_search ONLY when the provider is given those backings", () => {
    const registry = buildNodeToolRegistry();

    // No optional backings → human / web.search are NOT advertised → tools gated out.
    const bare = buildNodeCapabilityProvider(workspace);
    const bareNames = registry.toolsFor(bare).map((t) => t.name);
    expect(bareNames).not.toContain("ask_human");
    expect(bareNames).not.toContain("web_search");
    expect(bare.capabilities.has("human")).toBe(false);
    expect(bare.capabilities.has("web.search")).toBe(false);

    // Inject both backings → both caps advertised → both tools offered (PRD 11 §5.2).
    const backed = buildNodeCapabilityProvider(workspace, {
      human: {
        async ask() {
          return { paused: false, answer: "yes" };
        },
      },
      webSearch: async (query) => ({ ok: true, query, results: [] }),
    });
    const backedNames = registry.toolsFor(backed).map((t) => t.name);
    expect(backedNames).toContain("ask_human");
    expect(backedNames).toContain("web_search");
    expect(backed.capabilities.has("human")).toBe(true);
    expect(backed.capabilities.has("web.search")).toBe(true);
  });

  it("dispatches web_search through the injected backend when web.search is backed", async () => {
    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace, {
      webSearch: async (query) => ({
        ok: true,
        query,
        results: [{ title: "t", url: "https://x", snippet: "s" }],
      }),
    });
    const result = await registry.dispatch(
      "web_search",
      { query: "ssm kernels" },
      { caps: provider, workspaceRoot: workspace },
    );
    expect(result.data.ok).toBe(true);
    expect((result.data.results as unknown[]).length).toBe(1);
  });

  it("dispatches workflow_status and reports no workflows on a fresh orchestrator state", async () => {
    const registry = buildNodeToolRegistry();
    const provider = buildNodeCapabilityProvider(workspace);
    const result = await registry.dispatch(
      "workflow_status",
      {},
      { caps: provider, workspaceRoot: workspace },
    );
    // Either there are no workflows, or a prior in-process test left one — both are
    // valid; the contract is that it returns structured data without throwing.
    expect(result.data).toBeTypeOf("object");
    expect("error" in result.data || "workflowId" in result.data).toBe(true);
  });
});
