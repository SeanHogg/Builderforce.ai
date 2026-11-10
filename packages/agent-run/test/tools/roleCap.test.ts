/**
 * The code/verify turn cap on a closed catalog (`policy/tools/roleCap.ts`). Chats #60338 / #61651 advertised 66–69 tools of ~480 on
 * most turns: the 64-tool relevance set, filled to the brim by the catalog-order backfill, plus pins and the router. A code turn now
 * advertises the surface's required set (always), its role's tools and what matches the request — ticket and platform tools only
 * when the ask is about them. The required set is never narrowed: dropping a prompt-named tool cost a 78-call / 44-minute run.
 */
import { describe, expect, it } from "vitest";
import type { ToolSchema } from "@builderforce/agent-tools";
import type { PlatformTools } from "../../src/index.js";
import { selectPlatformCatalog } from "../../src/policy/tools/platform.js";
import {
  ROLE_GUARANTEED_TOOLS, ROLE_MATCH_ROOM, ROLE_TOOL_LIMIT, roleCappedSelection, roleToolLimit, roleToolNames,
} from "../../src/policy/tools/roleCap.js";
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
/** The coordination/delivery tools a code or verify turn may never lose, as a host catalog names them. */
const COORDINATION = ["output_filter", "wait_agents", "stop_agent", "message_agent", "update_task_state", "hand_off", "builtin_reviews_record"].map((n) => tool(n));
/** A ~480-tool catalog: the workspace, the ticket and coordination tools and hundreds of platform tools. */
const PLATFORM = Array.from({ length: 440 }, (_, i) => tool(`builtin_platform_${i}`, `platform operation ${i} for dashboards and billing`));
const CATALOG = [...PLATFORM.slice(0, 200), ...TICKETS, ...WORKSPACE.map((n) => tool(n)), ...COORDINATION, ...PLATFORM.slice(200)];

function selectFor(role: string | undefined, query: string, opts: { pinned?: string[]; required?: readonly string[] } = {}): string[] {
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => CATALOG,
    // The Brain's selection: the wide limit, the required set held to it, every workspace tool required by default.
    selection: { query, limit: DEFAULT_TOOL_LIMIT, capRequired: true, required: new Set(opts.required ?? WORKSPACE), pinned: opts.pinned ?? [], ...(role ? { role } : {}) },
    execute: async () => ({ data: null }),
  };
  const ctx = policyCtx({ ports: { platform } });
  return (selectPlatformCatalog(ctx, []) ?? []).map((t) => t.function.name);
}

/** The role set the test catalog holds. */
const heldRoleSet = (role: "code" | "verify"): string[] => {
  const held = new Set(CATALOG.map((t) => t.function.name));
  return roleToolNames(role).filter((n) => held.has(n));
};

describe("the code/verify turn cap", () => {
  it("a code turn with a small required set advertises its role set plus at most the match room — never the ~480-tool backfill", () => {
    const names = selectFor("code", "fix the null check in the parser", { required: ["read_file"] });
    expect(names.length).toBeLessThanOrEqual(Math.max(ROLE_TOOL_LIMIT.code, heldRoleSet("code").length + ROLE_MATCH_ROOM.code));
    expect(names.length).toBeLessThan(40);
    for (const must of ["read_file", "search_code", "edit_file", "write_file", "run_command", "git_diff", "find_symbol"]) expect(names).toContain(must);
    expect(names.some((n) => n.startsWith("builtin_platform_"))).toBe(false);
  });

  it("keeps the surface's whole required set: every workspace tool survives a code and a verify turn", () => {
    for (const role of ["code", "verify"] as const) {
      const names = selectFor(role, "fix the null check in the parser");
      for (const must of WORKSPACE) expect(names).toContain(must);
      expect(names.some((n) => n.startsWith("builtin_platform_"))).toBe(false);
    }
  });

  it("a prompt-named tool survives the cap even though no role set holds it", () => {
    for (const role of ["code", "verify"] as const) {
      const names = selectFor(role, "fix the parser", { required: [...WORKSPACE, "builtin_platform_123"] });
      expect(names).toContain("builtin_platform_123");
      expect(roleCappedSelection(role, CATALOG.map((t) => t.function.name), [], ["builtin_platform_123"]).required).toContain("builtin_platform_123");
    }
  });

  it.each(["code", "verify"] as const)("a %s turn always keeps the delivery and coordination tools the catalog holds", (role) => {
    const names = selectFor(role, "fix the null check in the parser", { required: [] });
    for (const must of ["git_commit", "git_push", "output_filter", "wait_agents", "hand_off"]) {
      expect(names).toContain(must);
    }
    expect(ROLE_GUARANTEED_TOOLS.every((n) => roleToolNames(role).includes(n))).toBe(true);
  });

  it("a guaranteed tool the catalog does not hold is simply absent", () => {
    const sel = roleCappedSelection("code", ["read_file", "edit_file"]);
    expect(sel.required).not.toContain("git_push");
    expect(sel.required).not.toContain("hand_off");
  });

  it("keeps ticket and platform tools out of a code turn unless the ask is about tickets (close-out is the finish module's)", () => {
    const plain = selectFor("code", "fix the null check in the parser");
    expect(plain.filter((n) => n.startsWith("builtin_tasks_") || n.startsWith("builtin_tickets_"))).toEqual([]);
    expect(plain.some((n) => n.startsWith("builtin_platform_"))).toBe(false);

    const ticketAsk = selectFor("code", "update the ticket on the board when the fix lands");
    expect(ticketAsk.some((n) => n === "builtin_tasks_list" || n === "builtin_tasks_create" || n === "builtin_tickets_pending_changes")).toBe(true);
    expect(ticketAsk.some((n) => n.startsWith("builtin_platform_"))).toBe(false);
  });

  it("a verify turn is capped tighter", () => {
    const names = selectFor("verify", "check the change", { required: [] });
    expect(names.length).toBeLessThanOrEqual(Math.max(ROLE_TOOL_LIMIT.verify, heldRoleSet("verify").length + ROLE_MATCH_ROOM.verify));
    expect(heldRoleSet("verify").length).toBeLessThan(heldRoleSet("code").length);
    expect(names).toContain("git_diff");
    expect(names.some((n) => n.startsWith("builtin_platform_"))).toBe(false);
  });

  it("a tool found through the router and called stays advertised (pinned beyond the cap)", () => {
    const names = selectFor("code", "fix the parser", { pinned: ["builtin_platform_7"] });
    expect(names).toContain("builtin_platform_7");
  });

  it("planning and unset roles keep the wide relevance set", () => {
    expect(selectFor("plan", "fix the parser").length).toBe(DEFAULT_TOOL_LIMIT);
    expect(selectFor(undefined, "fix the parser").length).toBe(DEFAULT_TOOL_LIMIT);
    expect(roleToolLimit("plan")).toBe(DEFAULT_TOOL_LIMIT);
    expect(roleToolLimit("code")).toBe(ROLE_TOOL_LIMIT.code);
  });

  it("a keep-set or required set larger than the cap widens it instead of dropping tools, with room left for matches", () => {
    const keep = Array.from({ length: 30 }, (_, i) => `canvas_tool_${i}`);
    const sel = roleCappedSelection("code", [...roleToolNames("code"), ...keep], keep);
    expect(sel.limit).toBe(sel.required.length + ROLE_MATCH_ROOM.code);
    expect(sel.required).toEqual(expect.arrayContaining(keep));
  });

  it("the selector's backfill stays on by default and off when asked", () => {
    const catalog = Array.from({ length: 10 }, (_, i) => tool(`t${i}`));
    expect(selectToolsForTurn(catalog, { limit: 4 }).tools).toHaveLength(4);
    expect(selectToolsForTurn(catalog, { limit: 4, required: ["t1"], backfill: false }).tools.map((t) => t.function?.name)).toEqual(["t1"]);
  });
});
