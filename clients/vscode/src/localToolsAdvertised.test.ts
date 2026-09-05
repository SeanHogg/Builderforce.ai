import { describe, it, expect } from "vitest";
import { CORE_TOOLS } from "@builderforce/agent-tools";
import { LOCAL_WORKSPACE_TOOLS, localToolsIn } from "@seanhogg/builderforce-brain-embedded";
import { ideSystemPromptBase } from "./idePersona";

/**
 * THE DRIFT GUARD BEHIND "the tool my prompt promised does not exist".
 *
 * The per-turn selector trims a ~440-tool catalog to ~64 by lexical relevance and pins
 * whatever the system prompt NAMES — but that pin is resolved by a `builtin_*` pattern,
 * which none of the local workspace tools match. So on the turn that said "commit the
 * change and push to main", `run_command` shared no word stem with the request, missed
 * the cut, and the agent — whose persona had just told it to use `run_command` for git —
 * searched its tool list, could not find it, and spent 78 calls and 44 minutes failing
 * to commit a one-line change it had already made.
 *
 * `LOCAL_WORKSPACE_TOOLS` is now pinned unconditionally, which only works while it names
 * the tools this client actually ships. Two ways that can rot, both silent:
 *   1. a tool named in the PERSONA that is not in the pin set — promised, droppable;
 *   2. a name in the pin set that no shared `ToolDefinition` uses — a pin matching
 *      nothing, i.e. the same hole with no symptom.
 * Both are assertions here rather than a convention.
 */
describe("the local workspace tools are always advertised", () => {
  const coreNames = new Set(CORE_TOOLS.map((t) => t.name));

  it("pins only tools that really exist in the shared definitions", () => {
    for (const name of LOCAL_WORKSPACE_TOOLS) expect(coreNames.has(name)).toBe(true);
  });

  it("pins every local tool the IDE persona tells the model to use", () => {
    // The persona names them in prose, which is exactly why the `builtin_*` pattern
    // could not see them. Read them back out of the prompt the client actually sends.
    const prompt = ideSystemPromptBase(true);
    for (const name of ["read_file", "list_files", "write_file", "edit_file", "delete_file", "search_code", "run_command"]) {
      expect(prompt).toContain(name);
      expect(LOCAL_WORKSPACE_TOOLS.has(name)).toBe(true);
    }
  });

  it("pins the publish tools the persona now routes shipping through", () => {
    // The persona used to say "use run_command for git/gh to commit, push and open a
    // PR" — advice with no tool behind it, which is how a one-line change ended up
    // pushed to main by a raw shell. It now names these; the pin is what stops the
    // relevance trim dropping `open_pull_request` on a turn phrased "ship this".
    const prompt = ideSystemPromptBase(true);
    for (const name of ["git_commit", "git_push", "open_pull_request"]) {
      expect(prompt).toContain(name);
      expect(LOCAL_WORKSPACE_TOOLS.has(name)).toBe(true);
      expect(coreNames.has(name)).toBe(true);
    }
  });

  it("survives the trim on the request that started this: 'commit and push to main'", () => {
    const catalog = [...coreNames, "builtin_tasks_create"];
    const pinned = localToolsIn(catalog);
    for (const name of ["git_commit", "git_push", "open_pull_request", "git_status"]) {
      expect(pinned).toContain(name);
    }
  });

  it("survives the trim: a catalog that would drop run_command still keeps it", () => {
    // `run_command` scores zero against this request — no shared stem — so relevance
    // alone dropped it. The pin is what makes that impossible.
    const catalog = [...coreNames, "builtin_tasks_create", "builtin_chats_dispatch_agent"];
    expect(localToolsIn(catalog)).toContain("run_command");
  });
});
