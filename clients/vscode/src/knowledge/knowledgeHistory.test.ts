import { describe, expect, it } from "vitest";
import { AUTHOR_END, COMMIT_MARK, PARENT_SEP, parseRecentCommits } from "@builderforce/agent-tools/node-git-history";
import { historyOf } from "./knowledgeHistory";

const ref = (p: string): string => `src:r::${p}`;

describe("history", () => {
  it("maps each commit's changed paths to node refs", () => {
    const log = [`${COMMIT_MARK}abc|2026-11-05T10:00:00Z|fix: a | b`, "src/a.ts", "src\\b.ts", "", `${COMMIT_MARK}def|2026-11-04T10:00:00Z|init`, "README.md"].join("\n");
    expect(historyOf(parseRecentCommits(log), "r")).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: a | b", refs: [ref("src/a.ts"), ref("src/b.ts")] },
      { sha: "def", at: "2026-11-04T10:00:00Z", title: "init", refs: [ref("README.md")] },
    ]);
  });

  it("carries the commit author through to the view's history", () => {
    const log = [`${COMMIT_MARK}abc|2026-11-05T10:00:00Z|Sean Hogg${AUTHOR_END}fix: a | b`, "src/a.ts"].join("\n");
    expect(historyOf(parseRecentCommits(log), "r")).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: a | b", author: "Sean Hogg", refs: [ref("src/a.ts")] },
    ]);
  });

  it("carries the first parent's sha, and drops one that is not a sha", () => {
    const parent = "a".repeat(40);
    const log = [`${COMMIT_MARK}abc1234${PARENT_SEP}${parent} ${"b".repeat(40)}|2026-11-05T10:00:00Z|Ann${AUTHOR_END}merge`, "a.ts",
      `${COMMIT_MARK}def5678${PARENT_SEP}--output=x|2026-11-04T10:00:00Z|Ann${AUTHOR_END}odd`, "b.ts",
      `${COMMIT_MARK}0123456${PARENT_SEP}|2026-11-03T10:00:00Z|Ann${AUTHOR_END}root`, "c.ts"].join("\n");
    const commits = historyOf(parseRecentCommits(log), "r");
    expect(commits.map((c) => c.parent)).toEqual([parent, undefined, undefined]);
  });
});
