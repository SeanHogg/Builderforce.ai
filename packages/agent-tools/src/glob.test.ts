import { describe, expect, it } from "vitest";
import {
  dirMayContainGlobMatch,
  emptyGlobListingNote,
  filterByGlob,
  filterByGlobInScope,
  isUnderScopeDir,
  matchGlob,
  matchGlobInScope,
  normalizeScopeDir,
  selectPathsWithinCap,
} from "./glob.js";

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

describe("matchGlobInScope / filterByGlobInScope", () => {
  // Regression lock: list_files walks from the `path` scope but every provider filtered
  // the REPO-ROOT-relative path. A glob written the natural way for the folder you asked
  // about -- {path: "frontend/src/lib", glob: "**/*.test.ts"} -- then matched nothing, and
  // the tool's own zero-match note told the model those 223 files did not exist.
  it("resolves a scope-relative glob against the scoped folder", () => {
    const paths = ["frontend/src/lib/a.test.ts", "frontend/src/lib/nested/b.test.ts", "frontend/src/other/c.ts"];
    expect(filterByGlobInScope(paths, "**/*.test.ts", "frontend/src/lib")).toEqual([
      "frontend/src/lib/a.test.ts",
      "frontend/src/lib/nested/b.test.ts",
    ]);
    // Same glob, unscoped, is the root-relative reading.
    expect(filterByGlobInScope(paths, "**/*.test.ts", undefined)).toEqual([
      "frontend/src/lib/a.test.ts",
      "frontend/src/lib/nested/b.test.ts",
    ]);
  });

  it("still accepts a repo-root-relative glob when a scope is set", () => {
    // The pattern names the repo-root path even though the walk started deeper; it must
    // still match, so a caller who knows the full path is never punished for scoping.
    expect(filterByGlobInScope(TREE, "src/**/*.ts", "src")).toEqual([
      "src/index.ts",
      "src/board/Card.test.ts",
      "src/boardroom/Table.ts",
    ]);
  });

  it("normalizes the scope before matching", () => {
    expect(matchGlobInScope("src/board/Card.tsx", "*.tsx", "./src/board/")).toBe(true);
    expect(matchGlobInScope("src/board/Card.tsx", "*.tsx", " /src/board ")).toBe(true);
  });

  it("never matches a path outside the scope (a sibling sharing a prefix is not inside)", () => {
    expect(matchGlobInScope("src/boardroom/Table.ts", "**/*.ts", "src/board")).toBe(false);
    expect(matchGlobInScope("docs/ROADMAP.md", "ROADMAP.md", "src")).toBe(false);
  });

  it("keeps the case-insensitive basename-anywhere rule inside a scope", () => {
    expect(filterByGlobInScope(TREE, "ROADMAP.md", "docs")).toEqual(["docs/ROADMAP.md"]);
  });
});

describe("selectPathsWithinCap", () => {
  it("keeps a glob match that sits past the size cap", () => {
    const paths = [
      ...Array.from({ length: 400 }, (_, i) => `noise/f${String(i).padStart(4, "0")}.ts`),
      "frontend/src/lib/widget.test.ts",
    ];
    const selected = selectPathsWithinCap(paths, {
      glob: "frontend/src/lib/**/*.test.ts",
      cap: 400,
    });
    expect(selected.paths).toEqual(["frontend/src/lib/widget.test.ts"]);
    expect(selected.truncated).toBe(false);
  });

  it("resolves a scope-relative glob before the cap", () => {
    const paths = [
      ...Array.from({ length: 400 }, (_, i) => `frontend/src/lib/noise${i}.ts`),
      "frontend/src/lib/a.test.ts",
      "frontend/src/other/b.test.ts",
    ];
    const selected = selectPathsWithinCap(paths, {
      glob: "**/*.test.ts",
      scopeDir: "frontend/src/lib",
      cap: 400,
    });
    expect(selected.paths).toEqual(["frontend/src/lib/a.test.ts"]);
    expect(selected.truncated).toBe(false);
  });

  it("reports an incomplete search when the source listing was cut off and nothing matched", () => {
    const selected = selectPathsWithinCap(["a.ts"], {
      glob: "**/*.test.ts",
      scopeDir: "frontend/src/lib",
      cap: 400,
      sourceTruncated: true,
    });
    expect(selected.paths).toEqual([]);
    expect(selected.truncated).toBe(true);
  });

  it("still slices an unscoped listing at the cap", () => {
    const paths = Array.from({ length: 401 }, (_, i) => `f${i}.ts`);
    const selected = selectPathsWithinCap(paths, { cap: 400 });
    expect(selected.paths).toHaveLength(400);
    expect(selected.truncated).toBe(true);
  });
});

describe("emptyGlobListingNote", () => {
  it("never claims a truncated empty search is absence", () => {
    const note = emptyGlobListingNote("**/*.test.ts", "frontend/src/lib", true);
    expect(note).toContain("NOT proof the file does not exist");
    expect(note).toContain("cut off");
    expect(note).toContain('under "frontend/src/lib"');
    expect(note).not.toContain("0 matches means no such file exists");
  });

  it("may claim absence only when the walk finished", () => {
    const note = emptyGlobListingNote("*.rs", undefined, false);
    expect(note).toContain("0 matches means no such file exists");
    expect(note).toContain("broader pattern");
  });
});

describe("dirMayContainGlobMatch", () => {
  it("prunes directories a rooted glob cannot reach", () => {
    expect(dirMayContainGlobMatch("agent-runtime", "frontend/src/lib/**/*.test.ts")).toBe(false);
    expect(dirMayContainGlobMatch("frontend", "frontend/src/lib/**/*.test.ts")).toBe(true);
    expect(dirMayContainGlobMatch("frontend/src/lib", "frontend/src/lib/**/*.test.ts")).toBe(true);
  });

  it("keeps the scope-relative reading so a relative glob still descends", () => {
    expect(dirMayContainGlobMatch("frontend/src/lib", "**/*.test.ts", "frontend/src/lib")).toBe(true);
    expect(dirMayContainGlobMatch("frontend/src/board", "lib/**/*.ts", "frontend/src")).toBe(false);
    expect(dirMayContainGlobMatch("frontend/src/lib", "lib/**/*.ts", "frontend/src")).toBe(true);
  });

  it("does not prune on a slash-free pattern", () => {
    expect(dirMayContainGlobMatch("anywhere", "*.test.ts")).toBe(true);
  });
});
