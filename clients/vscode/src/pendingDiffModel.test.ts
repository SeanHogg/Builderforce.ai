import { describe, expect, it } from "vitest";
import { boundDiff, pendingDiffCommands } from "./pendingDiffModel";

const section = (path: string, rows: number): string =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${rows} +1,${rows} @@\n${" x\n".repeat(rows)}`;

describe("pendingDiffCommands", () => {
  it("diffs against HEAD once when the repository has a commit", () => {
    const cmds = pendingDiffCommands(true);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatch(/^diff HEAD /);
  });

  it("asks the index AND the worktree in a repository with no commit yet", () => {
    // Plain `git diff` alone is worktree-vs-index: files only `git add`ed would vanish.
    const cmds = pendingDiffCommands(false);
    expect(cmds[0]).toMatch(/^diff --cached /);
    expect(cmds[1]).toMatch(/^diff --no-color/);
  });

  it("pins the a/ b/ prefixes the parser reads, whatever the user's gitconfig says", () => {
    for (const cmd of [...pendingDiffCommands(true), ...pendingDiffCommands(false)]) {
      expect(cmd).toContain("--src-prefix=a/ --dst-prefix=b/");
    }
  });
});

describe("boundDiff", () => {
  it("passes a diff within both limits through untouched", () => {
    const text = section("src/a.ts", 3) + section("src/b.ts", 3);
    expect(boundDiff(text)).toBe(text);
  });

  it("drops an oversized FIRST file and keeps the rest", () => {
    const big = section("api/bundle.js", 500);
    const small = section("src/a.ts", 2);
    const out = boundDiff(big + small, { perFile: 1_000 });
    expect(out).toBe(small);
  });

  it("stops at the total cap on a file boundary", () => {
    const a = section("a.ts", 10);
    const b = section("b.ts", 10);
    const out = boundDiff(a + b, { total: a.length + 5 });
    expect(out).toBe(a);
  });

  it("keeps a trailing blank context row", () => {
    const text = `${section("a.ts", 1)} \n`;
    expect(boundDiff(text).endsWith(" \n")).toBe(true);
  });
});
