import { describe, expect, it } from "vitest";
import { parseRecentCommits } from "@builderforce/agent-tools/node-git-history";
import { historyOf } from "./knowledgeHistory";

const ref = (p: string): string => `src:r::${p}`;

describe("history", () => {
  it("maps each commit's changed paths to node refs", () => {
    const log = ["@@@abc|2026-11-05T10:00:00Z|fix: a | b", "src/a.ts", "src\\b.ts", "", "@@@def|2026-11-04T10:00:00Z|init", "README.md"].join("\n");
    expect(historyOf(parseRecentCommits(log), "r")).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: a | b", refs: [ref("src/a.ts"), ref("src/b.ts")] },
      { sha: "def", at: "2026-11-04T10:00:00Z", title: "init", refs: [ref("README.md")] },
    ]);
  });

  it("carries the commit author through to the view's history", () => {
    const log = ["@@@abc|2026-11-05T10:00:00Z|Sean Hogg\u001ffix: a | b", "src/a.ts"].join("\n");
    expect(historyOf(parseRecentCommits(log), "r")).toEqual([
      { sha: "abc", at: "2026-11-05T10:00:00Z", title: "fix: a | b", author: "Sean Hogg", refs: [ref("src/a.ts")] },
    ]);
  });
});
