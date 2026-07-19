import { describe, expect, it } from "vitest";
import { filterByGlob, isUnderScopeDir, matchGlob, normalizeScopeDir } from "./glob.js";

const TREE = [
  "README.md",
  "docs/ROADMAP.md",
  "src/index.ts",
  "src/board/Card.tsx",
  "src/board/Card.test.ts",
  "src/boardroom/Table.ts",
  "packages/agent-tools/src/glob.ts",
];

describe("matchGlob / filterByGlob", () => {
  it("matches a slash-free pattern against the BASENAME at any depth", () => {
    expect(filterByGlob(TREE, "ROADMAP.md")).toEqual(["docs/ROADMAP.md"]);
    expect(matchGlob("a/b/c/ROADMAP.md", "ROADMAP.md")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(filterByGlob(TREE, "roadmap.MD")).toEqual(["docs/ROADMAP.md"]);
  });

  it("anchors a pattern that contains a slash to the full path", () => {
    expect(filterByGlob(TREE, "src/*.ts")).toEqual(["src/index.ts"]);
    // A single star must NOT cross a directory boundary.
    expect(matchGlob("src/board/Card.tsx", "src/*.tsx")).toBe(false);
  });

  it("crosses directories with a double star", () => {
    expect(filterByGlob(TREE, "src/**/*.ts")).toEqual([
      "src/index.ts",
      "src/board/Card.test.ts",
      "src/boardroom/Table.ts",
    ]);
    expect(matchGlob("packages/agent-tools/src/glob.ts", "packages/**/*.ts")).toBe(true);
  });

  // Regression lock: `**/` used to compile with a LITERAL slash (`^src/.*/[^/]*\.ts$`),
  // forcing at least one intermediate directory. `list_files`' own tool description
  // advertises `src/**/*.test.ts`, so an agent following the documentation silently
  // missed every file sitting directly in the scoped dir — and the zero-match note then
  // told it the file did not exist.
  it("matches ZERO path segments across `**` (src/**/*.ts finds src/index.ts)", () => {
    expect(matchGlob("src/index.ts", "src/**/*.ts")).toBe(true);
    expect(matchGlob("a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("src/board/Card.test.ts", "src/**/*.test.ts")).toBe(true);
    // Still anchored: `**` after `src/` must not escape the scoped directory.
    expect(matchGlob("docs/index.ts", "src/**/*.ts")).toBe(false);
    // A single star must still not cross a boundary.
    expect(matchGlob("src/board/Card.tsx", "src/*.tsx")).toBe(false);
  });

  it("matches a single character with ?", () => {
    expect(matchGlob("a/b.ts", "?.ts")).toBe(true);
    expect(matchGlob("a/bc.ts", "?.ts")).toBe(false);
  });

  it("treats a dot as a literal, not a regex wildcard", () => {
    expect(matchGlob("srcXindex.ts", "src.index.ts")).toBe(false);
    expect(matchGlob("src.index.ts", "src.index.ts")).toBe(true);
  });

  it("returns an empty list for a non-matching pattern (no accidental match-all)", () => {
    expect(filterByGlob(TREE, "*.rs")).toEqual([]);
  });
});

describe("normalizeScopeDir", () => {
  it("normalizes separators, leading ./ and surrounding slashes", () => {
    expect(normalizeScopeDir("./src/board/")).toBe("src/board");
    expect(normalizeScopeDir("src\\board")).toBe("src/board");
    expect(normalizeScopeDir("/src/board/")).toBe("src/board");
    expect(normalizeScopeDir("  src/board  ")).toBe("src/board");
  });

  it("maps a blank or absent scope to the empty (no-scope) string", () => {
    expect(normalizeScopeDir(undefined)).toBe("");
    expect(normalizeScopeDir(null)).toBe("");
    expect(normalizeScopeDir("   ")).toBe("");
  });
});

describe("isUnderScopeDir", () => {
  it("matches the dir itself and its descendants", () => {
    expect(isUnderScopeDir("src/board", "src/board")).toBe(true);
    expect(isUnderScopeDir("src/board/Card.tsx", "src/board")).toBe(true);
  });

  it("does NOT match a sibling that merely shares a string prefix", () => {
    expect(isUnderScopeDir("src/boardroom/Table.ts", "src/board")).toBe(false);
  });

  it("accepts a backslash path (Windows providers)", () => {
    expect(isUnderScopeDir("src\\board\\Card.tsx", "src/board")).toBe(true);
  });

  it("an empty scope matches everything", () => {
    expect(isUnderScopeDir("anything/at/all.ts", "")).toBe(true);
  });
});
