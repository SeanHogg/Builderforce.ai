import { describe, expect, it } from "vitest";
import { resolveToolAlias, TOOL_NAME_ALIASES } from "./toolAliases.js";

describe("resolveToolAlias", () => {
  it("maps list_dir (and close variants) onto list_files", () => {
    expect(resolveToolAlias("list_dir")).toBe("list_files");
    expect(resolveToolAlias("List_Dir")).toBe("list_files");
    expect(resolveToolAlias("listdir")).toBe("list_files");
    expect(resolveToolAlias("list_directory")).toBe("list_files");
  });

  it("maps common shell / search / edit hallucinations", () => {
    expect(resolveToolAlias("bash")).toBe("run_command");
    expect(resolveToolAlias("run_terminal_cmd")).toBe("run_command");
    expect(resolveToolAlias("grep")).toBe("search_code");
    expect(resolveToolAlias("search_replace")).toBe("edit_file");
    expect(resolveToolAlias("write_to_file")).toBe("write_file");
  });

  it("leaves catalog names and unknown names unchanged", () => {
    expect(resolveToolAlias("list_files")).toBe("list_files");
    expect(resolveToolAlias("teleport")).toBe("teleport");
  });

  it("every alias target is a non-empty catalog-style name", () => {
    for (const [from, to] of Object.entries(TOOL_NAME_ALIASES)) {
      expect(from).toMatch(/^[a-z0-9_]+$/);
      expect(to).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(from).not.toBe(to);
    }
  });
});
