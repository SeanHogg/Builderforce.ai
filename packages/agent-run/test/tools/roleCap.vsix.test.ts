/**
 * The code-turn cap over a VSIX-shaped catalog (chat #61651, VSIX 2026.10.153): every code turn advertised 54–57 tools of 481 because
 * the Brain handed the cap its whole surface vocabulary (`localToolsIn`, memory, skills) as REQUIRED, and the cap widens to fit a
 * required set. The Brain now requires only what the prompt names, `ask_user` and `hand_off` on a capped turn
 * (`brain-embedded/src/run/brainPlatformTools.ts`); the role set keeps the vocabulary a coder needs and the rest competes on relevance.
 */
import { describe, expect, it } from "vitest";
import type { ToolSchema } from "@builderforce/agent-tools";
import type { PlatformTools } from "../../src/index.js";
import { selectPlatformCatalog } from "../../src/policy/tools/platform.js";
import { ROLE_MATCH_ROOM, roleToolNames } from "../../src/policy/tools/roleCap.js";
import { DEFAULT_TOOL_LIMIT } from "../../src/policy/tools/selectTools.js";
import { policyCtx } from "../support/policyContext.js";

const tool = (name: string, description = name.replace(/_/g, " ")): ToolSchema => ({
  type: "function", function: { name, description, parameters: { type: "object", properties: {} } },
});

/** The VS Code host's whole workspace vocabulary (`brain-embedded/src/localWorkspaceTools.ts` LOCAL_WORKSPACE_TOOLS). */
const LOCAL_WORKSPACE = [
  "read_file", "list_files", "search_code", "find_symbol", "file_outline", "semantic_search", "repo_map", "read_compressed",
  "local_research", "write_file", "edit_file", "delete_file", "run_command", "command_status", "command_stop", "git_status",
  "git_diff", "git_history", "git_sync_latest", "git_undo", "git_redo", "git_commit", "git_push", "open_pull_request",
  "git_cleanup_merged", "spawn_agent", "spawn_agents", "wait_agents", "message_agent", "stop_agent",
];
/** Memory and skill vocabulary the Brain's preamble also always advertised. */
const MEMORY_AND_SKILLS = ["recall_facts", "remember_fact", "builtin_skills_read"];
/** The vocabulary a code turn's role set does not hold: these compete on relevance now. */
const UNNAMED_OFF_ROLE = ["read_compressed", "local_research", "git_history", "git_sync_latest", "git_undo", "git_redo", "git_cleanup_merged", "spawn_agents"];
/** ~15 builtin tools a VSIX persona + directives name on a code turn (some overlap the role set). */
const PROMPT_NAMED = [
  "builtin_tasks_update", "builtin_reviews_record", "builtin_skills_read", "builtin_tasks_create", "builtin_tasks_get",
  "builtin_tasks_list", "builtin_chats_link_ticket", "builtin_chats_list_tickets", "builtin_tickets_pending_changes",
  "builtin_tasks_comment", "builtin_projects_get", "builtin_reviews_list", "builtin_specs_read", "builtin_docs_read", "builtin_knowledge_search",
];
const NAMED_TOOLS = PROMPT_NAMED.map((n) => tool(n, `${n.replace(/_/g, " ")} for the board`));
const SURFACE = [...LOCAL_WORKSPACE, ...MEMORY_AND_SKILLS.filter((n) => !PROMPT_NAMED.includes(n)), "ask_user", "hand_off", "output_filter"].map((n) => tool(n));
const PLATFORM = Array.from({ length: 481 - SURFACE.length - NAMED_TOOLS.length }, (_, i) => tool(`builtin_platform_${i}`, `platform operation ${i} for dashboards and billing`));
const CATALOG = [...PLATFORM.slice(0, 200), ...NAMED_TOOLS, ...SURFACE, ...PLATFORM.slice(200)];

function selectFor(query: string, required: readonly string[], role = "code"): string[] {
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => CATALOG,
    selection: { query, limit: DEFAULT_TOOL_LIMIT, capRequired: true, required: new Set(required), pinned: [], role },
    execute: async () => ({ data: null }),
  };
  return (selectPlatformCatalog(policyCtx({ ports: { platform } }), []) ?? []).map((t) => t.function.name);
}

/** What the Brain required before the fix: the prompt-named tools plus the whole vocabulary plus `ask_user`. */
const BEFORE = [...PROMPT_NAMED, ...LOCAL_WORKSPACE, ...MEMORY_AND_SKILLS, "ask_user"];
/** What it requires on a capped turn now: what the prompt names, plus `ask_user`. */
const AFTER = [...PROMPT_NAMED, "ask_user"];

describe("the code-turn cap over a VSIX-shaped catalog", () => {
  it("holds ~481 tools", () => {
    expect(CATALOG).toHaveLength(481);
  });

  it("drops the unnamed vocabulary the role does not hold, and advertises fewer tools than before", () => {
    const before = selectFor("fix the null check in the parser", BEFORE);
    const after = selectFor("fix the null check in the parser", AFTER);
    const held = new Set(CATALOG.map((t) => t.function.name));
    const roleHeld = roleToolNames("code").filter((n) => held.has(n));
    const required = new Set([...AFTER, ...roleHeld]);
    expect(after.length).toBeLessThan(before.length);
    // The trimmed role set (22 held here) plus what the prompt names: 15 named builtin tools put a code turn at 37. Under 32 needs a
    // prompt that names 10 or fewer, which is the prompt's contract, not the cap's.
    expect(roleHeld.length).toBeLessThanOrEqual(22);
    expect(after.length).toBeLessThanOrEqual(roleHeld.length + PROMPT_NAMED.length);
    expect(after.length).toBeLessThanOrEqual(required.size + ROLE_MATCH_ROOM.code);
    for (const off of UNNAMED_OFF_ROLE) expect(after).not.toContain(off);
    expect(after.some((n) => n.startsWith("builtin_platform_"))).toBe(false);
  });

  it("keeps every prompt-named tool, the coder's file and shell tools and the conversational tools", () => {
    const after = selectFor("fix the null check in the parser", AFTER);
    for (const must of [...PROMPT_NAMED, "run_command", "read_file", "edit_file", "write_file", "search_code", "ask_user", "hand_off"]) {
      expect(after).toContain(must);
    }
  });

  it("a request about undoing still surfaces git_undo through relevance", () => {
    expect(selectFor("undo the last change to the parser", AFTER)).toContain("git_undo");
  });

  it("a request to open a PR still surfaces open_pull_request through relevance", () => {
    expect(selectFor("open a pull request for the parser fix", AFTER)).toContain("open_pull_request");
  });

  it("a planning turn keeps the wide set whatever it is handed", () => {
    expect(selectFor("fix the parser", BEFORE, "plan")).toHaveLength(DEFAULT_TOOL_LIMIT);
  });
});
