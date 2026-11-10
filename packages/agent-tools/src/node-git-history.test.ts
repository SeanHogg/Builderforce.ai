import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMIT_MARK, countCommitsPerPath, gitHistoryPort, parseRecentCommits } from "./node-git-history.js";

/** The commit-header marker the git log format writes (`%x1e`). */
const RS = COMMIT_MARK;
const SHA_A = `${RS}${"a".repeat(40)}`;
const SHA_B = `${RS}${"b".repeat(40)}`;

describe("countCommitsPerPath", () => {
  it("counts commits per wanted path, once per commit", () => {
    const log = [SHA_A, "src/a.ts", "src/b.ts", "src/a.ts", "", SHA_B, "src/a.ts", "other.ts", ""].join("\n");
    expect([...countCommitsPerPath(log, new Set(["src/a.ts", "src/b.ts"]))].sort()).toEqual([["src/a.ts", 2], ["src/b.ts", 1]]);
  });

  it("regression: a file NAMED like a sha is a path, not a commit separator", () => {
    const hexName = "c".repeat(40);
    const log = [SHA_A, hexName, "src/a.ts", "src/a.ts", ""].join("\n");
    // Read as a separator, the second src/a.ts would have counted as a second commit.
    expect([...countCommitsPerPath(log, new Set(["src/a.ts", hexName]))].sort()).toEqual([[hexName, 1], ["src/a.ts", 1]]);
  });

  it("regression: a path ending (or starting) in spaces keeps them", () => {
    const log = [SHA_A, "notes ", " lead.md", "notes", ""].join("\r\n");
    expect([...countCommitsPerPath(log, new Set(["notes ", " lead.md", "notes"]))].sort()).toEqual([[" lead.md", 1], ["notes ", 1], ["notes", 1]]);
  });
});

describe("parseRecentCommits", () => {
  it("reads the author before the unit separator, and keeps a | in the subject or name", () => {
    const log = [`${RS}abc|2026-11-05T10:00:00Z|A | B\u001ffix: x | y`, "src/a.ts", `${RS}def|2026-11-04T10:00:00Z|old subject | with bar`, "b.ts"].join("\n");
    expect(parseRecentCommits(log)).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: x | y", paths: ["src/a.ts"], author: "A | B" },
      { sha: "def", at: "2026-11-04T10:00:00Z", title: "old subject | with bar", paths: ["b.ts"] },
    ]);
  });

  it("regression: a file named like the old @@@ marker, or ending in a space, is a path of the commit", () => {
    const log = [`${RS}abc|2026-11-05T10:00:00Z|A\u001fsubject`, "", "@@@x|y|z", "trailing ", ""].join("\n");
    expect(parseRecentCommits(log)).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "subject", paths: ["@@@x|y|z", "trailing "], author: "A" },
    ]);
  });
});

describe("gitHistoryPort", () => {
  it("is undefined outside a git work tree (never throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-nogit-"));
    try {
      expect(await gitHistoryPort(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("regression: counts real commits through git, with a sha-named file in the tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-git-"));
    const hexName = "d".repeat(40);
    const sh = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "ignore" });
    try {
      sh("init", "-q");
      writeFileSync(join(dir, hexName), "1");
      writeFileSync(join(dir, "a.ts"), "1");
      sh("add", "-A");
      sh("commit", "-q", "-m", "one");
      writeFileSync(join(dir, "a.ts"), "2");
      sh("commit", "-q", "-am", "two");
      const port = await gitHistoryPort(dir);
      const counts = await port!.commitsTouching([hexName, "a.ts"], 30);
      expect([...counts].sort()).toEqual([["a.ts", 2], [hexName, 1]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is undefined for a folder that does not exist", async () => {
    expect(await gitHistoryPort(join(tmpdir(), "bf-missing-folder-xyz"))).toBeUndefined();
  });
});
