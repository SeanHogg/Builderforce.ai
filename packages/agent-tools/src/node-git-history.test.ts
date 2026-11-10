import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { churnCapWarning, churnOf, type HistoryCommit } from "./knowledge/historyPort.js";
import { AUTHOR_END, COMMIT_MARK, commitFilesParser, gitHistoryPort, parseCommitFiles, parseRecentCommits } from "./node-git-history.js";

/** The commit-header marker the git log format writes (`%x1e`). */
const RS = COMMIT_MARK;
const NOW = Date.parse("2026-11-10T00:00:00Z");
const SHA_A = `${RS}${AUTHOR_END}2026-11-09T10:00:00+00:00`;
const SHA_B = `${RS}${AUTHOR_END}2026-11-08T10:00:00+00:00`;
/** `git log -z --name-only` output: `<header>\0`, then (after a newline) each name NUL-terminated. */
const zlog = (...commits: string[][]) => commits.map(([header, ...names]) => `${header}\0${names.length ? `\n${names.join("\0")}\0` : ""}`).join("");
const churn = (log: string, wanted: string[]) => [...churnOf(parseCommitFiles(log), wanted, 90, NOW)].sort();

describe("parseCommitFiles", () => {
  it("reads each commit's time, its distinct files and its whole-commit file count", () => {
    const log = zlog([SHA_A, "src/a.ts", "src/b.ts", "src/a.ts"], [SHA_B, "src/c.ts"]);
    expect(parseCommitFiles(log)).toEqual([
      { at: "2026-11-09T10:00:00+00:00", paths: ["src/a.ts", "src/b.ts"], fileCount: 2 },
      { at: "2026-11-08T10:00:00+00:00", paths: ["src/c.ts"], fileCount: 1 },
    ]);
  });

  it("makes paths root-relative by the prefix, dropping the rest but counting them in fileCount", () => {
    const log = zlog([SHA_A, "pkg/a.ts", "other/b.ts", "pkg/sub/c.ts", "README.md"]);
    expect(parseCommitFiles(log, "pkg/")).toEqual([{ at: "2026-11-09T10:00:00+00:00", paths: ["a.ts", "sub/c.ts"], fileCount: 4 }]);
  });

  it("regression: a name holding a quote or a backslash is itself (no C-quoting, no slash rewrite)", () => {
    const log = zlog([SHA_A, 'say "hi".ts', "back\\slash.ts"]);
    expect(parseCommitFiles(log)[0]!.paths).toEqual(['say "hi".ts', "back\\slash.ts"]);
  });

  it("reads a commit with no files, and the same commits however the stream is chunked", () => {
    const log = zlog([SHA_A], [SHA_B, "a.ts", "b.ts"]);
    const whole = parseCommitFiles(log);
    expect(whole).toEqual([
      { at: "2026-11-09T10:00:00+00:00", paths: [], fileCount: 0 },
      { at: "2026-11-08T10:00:00+00:00", paths: ["a.ts", "b.ts"], fileCount: 2 },
    ]);
    const parser = commitFilesParser();
    for (const ch of log) parser.push(ch);
    expect(parser.end()).toEqual(whole);
  });
});

describe("churn from the parsed log", () => {
  it("counts commits per wanted path, once per commit", () => {
    const log = zlog([SHA_A, "src/a.ts", "src/b.ts", "src/a.ts"], [SHA_B, "src/a.ts", "other.ts"]);
    expect(churn(log, ["src/a.ts", "src/b.ts"])).toEqual([["src/a.ts", 2], ["src/b.ts", 1]]);
  });

  it("counts only the last 90 days of a longer history", () => {
    const log = zlog([SHA_A, "src/a.ts"], [`${RS}${AUTHOR_END}2026-05-01T00:00:00+00:00`, "src/a.ts"]);
    expect(churn(log, ["src/a.ts"])).toEqual([["src/a.ts", 1]]);
  });

  it("regression: a file NAMED like a sha is a path, not a commit separator", () => {
    const hexName = "c".repeat(40);
    const log = zlog([SHA_A, hexName, "src/a.ts", "src/a.ts"]);
    // Read as a separator, the second src/a.ts would have counted as a second commit.
    expect(churn(log, ["src/a.ts", hexName])).toEqual([[hexName, 1], ["src/a.ts", 1]]);
  });

  it("regression: a path ending (or starting) in spaces keeps them", () => {
    const log = zlog([SHA_A, "notes ", " lead.md", "notes"]);
    expect(churn(log, ["notes ", " lead.md", "notes"])).toEqual([[" lead.md", 1], ["notes ", 1], ["notes", 1]]);
  });
});

describe("churnCapWarning", () => {
  const at = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
  const list = (...days: number[]): HistoryCommit[] => days.map((d) => ({ at: at(d), paths: ["a.ts"], fileCount: 1 }));

  it("warns when the cap is full and its oldest commit is still inside churn's window", () => {
    expect(churnCapWarning(list(1, 2, 80), 3, 90, NOW)).toMatch(/lower bound/);
  });

  it("is quiet under the cap, or when the capped history reaches past the window", () => {
    expect(churnCapWarning(list(1, 2), 3, 90, NOW)).toBeUndefined();
    expect(churnCapWarning(list(1, 2, 120), 3, 90, NOW)).toBeUndefined();
    expect(churnCapWarning([], 0, 90, NOW)).toBeUndefined();
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
      const counts = churnOf(await port!.commits(30, 5000), [hexName, "a.ts"], 30);
      expect([...counts].sort()).toEqual([["a.ts", 2], [hexName, 1]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a sub-folder root: only its commits, paths root-relative, fileCount over the whole commit, odd names intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-git-sub-"));
    const sh = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "ignore" });
    const odd = process.platform === "win32" ? "it's here.ts" : 'say "hi"\\.ts';
    try {
      sh("init", "-q");
      mkdirSync(join(dir, "pkg", "sub"), { recursive: true });
      mkdirSync(join(dir, "other"));
      writeFileSync(join(dir, "pkg", "a.ts"), "1");
      writeFileSync(join(dir, "pkg", "sub", odd), "1");
      writeFileSync(join(dir, "other", "b.ts"), "1");
      sh("add", "-A");
      sh("commit", "-q", "-m", "one");
      writeFileSync(join(dir, "other", "b.ts"), "2");
      sh("commit", "-q", "-am", "outside only");
      const port = await gitHistoryPort(join(dir, "pkg"));
      const commits = await port!.commits(30, 5000);
      expect(commits.map((c) => ({ paths: [...c.paths].sort(), fileCount: c.fileCount }))).toEqual([
        { paths: ["a.ts", `sub/${odd}`].sort(), fileCount: 3 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is undefined for a folder that does not exist", async () => {
    expect(await gitHistoryPort(join(tmpdir(), "bf-missing-folder-xyz"))).toBeUndefined();
  });
});
