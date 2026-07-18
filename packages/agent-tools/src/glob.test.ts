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
      "src/board/Card.test.ts",
      "src/boardroom/Table.ts",
    ]);
    expect(matchGlob("packages/agent-tools/src/glob.ts", "packages/**/*.ts")).toBe(true);
  });

  // KNOWN BUG (see report): `**` compiles to `.*`, so `src/**/*.ts` becomes
  // `^src/.*/[^/]*\.ts$` — the pattern's literal slash after `**` forces at least one
  // intermediate directory. Every mainstream glob (minimatch, bash globstar, ripgrep
  // --glob, VS Code) lets `**` match ZERO segments, so `src/**/*.ts` matches
  // `src/index.ts` there. `list_files`' own tool description advertises
  // `src/**/*.test.ts` as an example, so an agent following that documentation silently
  // misses every file sitting directly in the scoped directory.
  // Flip to a plain `it` once globToRegExp handles the zero-segment case.
  it.fails("`**` should match ZERO path segments (src/**/*.ts finds src/index.ts)", () => {
    expect(matchGlob("src/index.ts", "src/**/*.ts")).toBe(true);
  });

  it("currently requires at least one intermediate directory after `**`", () => {
    // Pins today's behaviour so the bug above cannot change unnoticed in either direction.
    expect(matchGlob("src/index.ts", "src/**/*.ts")).toBe(false);
    // The documented workaround an agent must use instead.
    expect(matchGlob("src/index.ts", "src/*.ts")).toBe(true);
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
