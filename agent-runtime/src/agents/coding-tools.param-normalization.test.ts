import { describe, expect, it } from "vitest";
import { fixMissingRootSeparator, normalizeToolParams } from "./pi-tools.read.js";

describe("normalizeToolParams", () => {
  it("maps common edit aliases to oldText/newText", () => {
    const normalized = normalizeToolParams({
      path: "src/file.ts",
      search: "old value",
      replace: "new value",
    });

    expect(normalized?.oldText).toBe("old value");
    expect(normalized?.newText).toBe("new value");
  });

  it("extracts structured alias payloads", () => {
    const normalized = normalizeToolParams({
      file_path: "src/file.ts",
      searchText: [{ type: "text", text: "alpha" }],
      replacement: { kind: "text", value: "beta" },
    });

    expect(normalized?.path).toBe("src/file.ts");
    expect(normalized?.oldText).toBe("alpha");
    expect(normalized?.newText).toBe("beta");
  });

  it("keeps explicit oldText/newText when already provided", () => {
    const normalized = normalizeToolParams({
      path: "src/file.ts",
      oldText: "explicit-old",
      newText: "explicit-new",
      search: "alias-old",
      replace: "alias-new",
    });

    expect(normalized?.oldText).toBe("explicit-old");
    expect(normalized?.newText).toBe("explicit-new");
  });

  it("normalizes str_replace_editor style args", () => {
    const normalized = normalizeToolParams({
      relative_path: "src/file.ts",
      old_str: "before",
      new_str: "after",
    });

    expect(normalized?.path).toBe("src/file.ts");
    expect(normalized?.oldText).toBe("before");
    expect(normalized?.newText).toBe("after");
  });
});

describe("fixMissingRootSeparator", () => {
  it("inserts separator when root is directly followed by a dot-prefixed dir", () => {
    const fixed = fixMissingRootSeparator(
      "C:\\code\\project.builderforce\\planning\\ROADMAP.md",
      "C:\\code\\project",
    );
    expect(fixed).toBe("C:\\code\\project\\.builderforce\\planning\\ROADMAP.md");
  });

  it("returns the path unchanged when separator is already present", () => {
    const p = "C:\\code\\project\\.builderforce\\planning\\ROADMAP.md";
    expect(fixMissingRootSeparator(p, "C:\\code\\project")).toBe(p);
  });

  it("returns the path unchanged when it does not start with root", () => {
    const p = "D:\\other\\.builderforce\\file.md";
    expect(fixMissingRootSeparator(p, "C:\\code\\project")).toBe(p);
  });

  it("handles forward-slash separator after root", () => {
    const p = "C:\\code\\project/.builderforce/file.md";
    expect(fixMissingRootSeparator(p, "C:\\code\\project")).toBe(p);
  });

  it("strips trailing separator from root before comparing", () => {
    const fixed = fixMissingRootSeparator(
      "C:\\code\\project.hidden\\file.md",
      "C:\\code\\project\\",
    );
    expect(fixed).toBe("C:\\code\\project\\.hidden\\file.md");
  });

  it("handles posix-style paths", () => {
    const fixed = fixMissingRootSeparator(
      "/home/user/project.builderforce/file.md",
      "/home/user/project",
    );
    expect(fixed).toMatch(/\/home\/user\/project[/\\]\.builderforce\/file\.md/);
  });
});
