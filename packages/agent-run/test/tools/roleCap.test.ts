/**
 * The code/verify turn cap on a closed catalog (`policy/tools/roleCap.ts`). Chats #60338 / #61651 advertised 66–69 tools of ~480 on
 * most turns: the 64-tool relevance set, filled to the brim by the catalog-order backfill, plus pins and the router. A code turn now
 * advertises its role's tools plus what matches the request — ticket and platform tools only when the ask is about them.
 */
import { describe, expect, it } from "vitest";
import type { ToolSchema } from "@builderforce/agent-tools";
import type { PlatformTools } from "../../src/index.js";
import { selectPlatformCatalog } from "../../src/policy/tools/platform.js";
import { ROLE_TOOL_LIMIT, roleCappedSelection, roleToolLimit, roleToolNames } from "../../src/policy/tools/roleCap.js";
import { DEFAULT_TOOL_LIMIT, selectToolsForTurn } from "../../src/policy/tools/selectTools.js";
import { policyCtx } from "../support/policyContext.js";

const tool = (name: string, description = name.replace(/_/g, " ")): ToolSchema => ({
  type: "function", function: { name, description, parameters: { type: "object", properties: {} } },
});

/** The editor's workspace vocabulary (every one of them is "always advertised" by the Brain's preamble). */
const WORKSPACE = [
  "read_file", "list_files", "search_code", "find_symbol", "file_outline", "semantic_search", "repo_map", "read_compressed",
  "local_research", "write_file", "edit_file", "delete_file", "run_command", "command_status", "command_stop", "git_status",
  "git_diff", "git_history", "git_sync_latest", "git_undo", "git_redo", "git_commit", "git_push", "open_pull_request",
  "git_cleanup_merged", "spawn_agent", "spawn_agents", "recall_facts", "remember_fact", "ask_user", "builtin_skills_read",
];
const TICKETS = ["builtin_tasks_list", "builtin_tasks_create", "builtin_tasks_update", "builtin_tickets_pending_changes"].map((n) => tool(n, `${n.replace(/_/g, " ")} ticket board`));
/** A ~480-tool catalog: the workspace, the ticket tools and hundreds of platform tools. */
const PLATFORM = Array.from({ length: 440 }, (_, i) => tool(`builtin_platform_${i}`, `platform operation ${i} for dashboards and billing`));
const CATALOG = [...PLATFORM.slice(0, 200), ...TICKETS, ...WORKSPACE.map((n) => tool(n)), ...PLATFORM.slice(200)];

function selectFor(role: string | undefined, query: string, pinned: string[] = []): string[] {
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => CATALOG,
    // The Brain's selection: the wide limit, the required set held to it, every workspace tool required.
    selection: { query, limit: DEFAULT_TOOL_LIMIT, capRequired: true, required: new Set(WORKSPACE), pinned, ...(role ? { role } : {}) },
    execute: async () => ({ data: null }),
  };
  const ctx = policyCtx({ ports: { platform } });
  return (selectPlatformCatalog(ctx, []) ?? []).map((t) => t.function.name);
}

describe("the code/verify turn cap", () => {
  it("a code turn advertises at most ~25 tools, its role set included", () => {
    const names = selectFor("code", "fix the null check in the parser");
    expect(names.length).toBeLessThanOrEqual(ROLE_TOOL_LIMIT.code);
    expect(names.length).toBeLessThanOrEqual(25);
    for (const must of ["read_file", "search_code", "edit_file", "write_file", "run_command", "git_diff", "find_symbol"]) expect(names).toContain(must);
  });

  it("keeps ticket and platform tools out of a code turn unless the ask is about tickets", () => {
    const plain = selectFor("code", "fix the null check in the parser");
    expect(plain.some((n) => n.startsWith("builtin_tasks_") || n.startsWith("builtin_tickets_"))).toBe(false);
    expect(plain.some((n) => n.startsWith("builtin_platform_"))).toBe(false);

    const ticketAsk = selectFor("code", "update the ticket on the board when the fix lands");
    expect(ticketAsk.some((n) => n.startsWith("builtin_tasks_") || n.startsWith("builtin_tickets_"))).toBe(true);
    expect(ticketAsk.length).toBeLessThanOrEqual(25);
  });

  it("a verify turn is capped tighter", () => {
    const names = selectFor("verify", "check the change");
    expect(names.length).toBeLessThanOrEqual(ROLE_TOOL_LIMIT.verify);
    expect(names).toContain("git_diff");
  });

  it("a tool found through the router and called stays advertised (pinned beyond the cap)", () => {
    const names = selectFor("code", "fix the parser", ["builtin_platform_7"]);
    expect(names).toContain("builtin_platform_7");
  });

  it("planning and unset roles keep the wide relevance set", () => {
    expect(selectFor("plan", "fix the parser").length).toBe(DEFAULT_TOOL_LIMIT);
    expect(selectFor(undefined, "fix the parser").length).toBe(DEFAULT_TOOL_LIMIT);
    expect(roleToolLimit("plan")).toBe(DEFAULT_TOOL_LIMIT);
    expect(roleToolLimit("code")).toBe(ROLE_TOOL_LIMIT.code);
  });

  it("a surface keep-set larger than the cap widens it instead of dropping tools the surface is", () => {
    const keep = Array.from({ length: 30 }, (_, i) => `canvas_tool_${i}`);
    const sel = roleCappedSelection("code", [...roleToolNames("code"), ...keep], keep);
    expect(sel.limit).toBe(sel.required.length);
    expect(sel.required).toEqual(expect.arrayContaining(keep));
  });

  it("the selector's backfill stays on by default and off when asked", () => {
    const catalog = Array.from({ length: 10 }, (_, i) => tool(`t${i}`));
    expect(selectToolsForTurn(catalog, { limit: 4 }).tools).toHaveLength(4);
    expect(selectToolsForTurn(catalog, { limit: 4, required: ["t1"], backfill: false }).tools.map((t) => t.function?.name)).toEqual(["t1"]);
  });
});
