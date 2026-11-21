import { describe, expect, it } from "vitest";
import { advertisedToolName, resolveAdvertisedToolName, resolveCallName, toolNameSet } from "./toolNaming.js";

describe("advertisedToolName", () => {
  it("prefixes and flattens a catalog id", () => {
    expect(advertisedToolName("tasks.archive_many")).toBe("builtin_tasks_archive_many");
    expect(advertisedToolName("kanban.signoff")).toBe("builtin_kanban_signoff");
    expect(advertisedToolName("a/b-c.d")).toBe("builtin_a_b_c_d");
  });
});

describe("resolveAdvertisedToolName", () => {
  const known = new Set(["builtin_tasks_archive_many", "builtin_tasks_list", "mcp__github__list_issues", "read_file"]);

  it("returns the exact advertised name", () => {
    expect(resolveAdvertisedToolName("builtin_tasks_archive_many", known)).toBe("builtin_tasks_archive_many");
    expect(resolveAdvertisedToolName("read_file", known)).toBe("read_file");
  });

  it("resolves a dotted or slashed catalog id", () => {
    expect(resolveAdvertisedToolName("tasks.archive_many", known)).toBe("builtin_tasks_archive_many");
    expect(resolveAdvertisedToolName("tasks/list", known)).toBe("builtin_tasks_list");
  });

  it("resolves the bare underscore form without the prefix", () => {
    expect(resolveAdvertisedToolName("tasks_archive_many", known)).toBe("builtin_tasks_archive_many");
  });

  it("resolves an already-prefixed name with other separators", () => {
    expect(resolveAdvertisedToolName("builtin.tasks.list", known)).toBe("builtin_tasks_list");
  });

  it("matches an mcp__ name exactly and never re-prefixes it", () => {
    expect(resolveAdvertisedToolName("mcp__github__list_issues", known)).toBe("mcp__github__list_issues");
    expect(resolveAdvertisedToolName("mcp__github__other", new Set(["builtin_mcp_github_other"]))).toBeNull();
  });

  it("never double-prefixes an advertised name", () => {
    expect(resolveAdvertisedToolName("builtin_x", new Set(["builtin_builtin_x"]))).toBeNull();
  });

  it("returns null for an unknown or empty name", () => {
    expect(resolveAdvertisedToolName("tasks.delete_everything", known)).toBeNull();
    expect(resolveAdvertisedToolName("", known)).toBeNull();
    expect(resolveAdvertisedToolName("...", known)).toBeNull();
  });

  it("accepts any iterable of known names", () => {
    expect(resolveAdvertisedToolName("tasks.list", ["builtin_tasks_list"])).toBe("builtin_tasks_list");
  });

  it("never re-prefixes a name carrying another source's namespace", () => {
    expect(resolveAdvertisedToolName("ext__tasks_list", new Set(["builtin_ext_tasks_list"]))).toBeNull();
  });

  it("prefers the surface's own unprefixed tool over a builtin of the same flattened name", () => {
    expect(resolveAdvertisedToolName("read_file", new Set(["read_file", "builtin_read_file"]))).toBe("read_file");
  });
});

describe("resolveCallName", () => {
  const known = ["list_files", "builtin_tasks_archive_many"];

  it("remaps a synonym, then resolves a catalog id", () => {
    expect(resolveCallName("list_dir", known)).toBe("list_files");
    expect(resolveCallName("tasks.archive_many", known)).toBe("builtin_tasks_archive_many");
  });

  it("returns the alias unchanged when nothing resolves", () => {
    expect(resolveCallName("nope.tool", known)).toBe("nope.tool");
  });
});

describe("toolNameSet", () => {
  it("builds the name set once per list", () => {
    const tools = [{ n: "a" }, { n: "b" }];
    const first = toolNameSet(tools, (t) => t.n);
    expect([...first]).toEqual(["a", "b"]);
    expect(toolNameSet(tools, (t) => t.n)).toBe(first);
  });
});
