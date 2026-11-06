import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countCommitsPerPath, gitHistoryPort, parseRecentCommits } from "./node-git-history.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("countCommitsPerPath", () => {
  it("counts commits per wanted path, once per commit", () => {
    const log = [SHA_A, "src/a.ts", "src/b.ts", "src/a.ts", "", SHA_B, "src/a.ts", "other.ts", ""].join("\n");
    expect([...countCommitsPerPath(log, new Set(["src/a.ts", "src/b.ts"]))].sort()).toEqual([["src/a.ts", 2], ["src/b.ts", 1]]);
  });
});

describe("parseRecentCommits", () => {
  it("reads the author before the unit separator, and keeps a | in the subject or name", () => {
    const log = ["@@@abc|2026-11-05T10:00:00Z|A | B\u001ffix: x | y", "src/a.ts", "@@@def|2026-11-04T10:00:00Z|old subject | with bar", "b.ts"].join("\n");
    expect(parseRecentCommits(log)).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: x | y", paths: ["src/a.ts"], author: "A | B" },
      { sha: "def", at: "2026-11-04T10:00:00Z", title: "old subject | with bar", paths: ["b.ts"] },
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

  it("is undefined for a folder that does not exist", async () => {
    expect(await gitHistoryPort(join(tmpdir(), "bf-missing-folder-xyz"))).toBeUndefined();
  });
});
