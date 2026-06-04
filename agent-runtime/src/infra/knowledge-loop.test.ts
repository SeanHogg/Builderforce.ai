import { describe, expect, it } from "vitest";
import { buildKnowledgeMemoryEntry, deriveActivitySummary } from "./knowledge-loop.js";

describe("deriveActivitySummary", () => {
  it("returns empty string when no activity", () => {
    expect(deriveActivitySummary({ created: [], edited: [], tools: [] })).toBe("");
  });

  it("identifies multi-agent workflow execution", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["orchestrate"],
    });
    expect(result).toBe("Multi-agent workflow execution");
  });

  it("identifies code review / analysis", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["git_history", "view"],
    });
    expect(result).toBe("Code review / analysis");
  });

  it("identifies test suite creation", () => {
    const result = deriveActivitySummary({
      created: ["src/foo.test.ts"],
      edited: [],
      tools: ["create", "bash"],
    });
    expect(result).toBe("Test suite created");
  });

  it("identifies test updates", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: ["src/bar.test.ts"],
      tools: ["edit"],
    });
    expect(result).toBe("Tests updated");
  });

  it("identifies read-only codebase analysis", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["grep", "glob", "view"],
    });
    expect(result).toBe("Codebase exploration / read-only analysis");
  });

  it("identifies feature implementation with new files and edits", () => {
    const result = deriveActivitySummary({
      created: ["src/feature.ts"],
      edited: ["src/index.ts"],
      tools: ["create", "edit"],
    });
    expect(result).toBe("Feature implementation: new files + edits");
  });

  it("identifies new file creation only", () => {
    const result = deriveActivitySummary({
      created: ["src/a.ts", "src/b.ts"],
      edited: [],
      tools: ["create"],
    });
    expect(result).toBe("New file(s) created: 2");
  });

  it("identifies code modifications only", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: ["src/a.ts", "src/b.ts", "src/c.ts"],
      tools: ["edit"],
    });
    expect(result).toBe("Code modifications: 3 file(s) changed");
  });

  it("identifies agent activity with no file changes", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["bash"],
    });
    expect(result).toBe("Agent activity (no file changes)");
  });

  it("orchestration takes priority over everything else", () => {
    const result = deriveActivitySummary({
      created: ["src/foo.ts"],
      edited: ["src/bar.ts"],
      tools: ["create", "edit", "orchestrate", "git_history"],
    });
    expect(result).toBe("Multi-agent workflow execution");
  });
});

describe("buildKnowledgeMemoryEntry", () => {
  it("skips empty heading-only entries", () => {
    expect(
      buildKnowledgeMemoryEntry({
        sessionKey: "agent:main:main",
        ts: "2026-03-14T00:04:29.680Z",
      }),
    ).toBeNull();
  });

  it("persists entries when there is meaningful activity", () => {
    const entry = buildKnowledgeMemoryEntry({
      sessionKey: "agent:main:main",
      ts: "2026-03-14T00:04:29.680Z",
      acc: {
        sessionKey: "agent:main:main",
        filesCreated: [],
        filesEdited: ["src/app.ts"],
        toolNames: ["edit"],
      },
    });

    expect(entry).toContain("**Edited**: src/app.ts");
    expect(entry).toContain("**Summary**: Code modifications: 1 file(s) changed");
  });
});
