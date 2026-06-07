import { describe, expect, it } from "vitest";
import { parseGitPorcelain, taskWorkspaceDir, buildTaskCloneUrl, taskBranchName } from "./task-workspace.js";

describe("task-workspace pure helpers", () => {
  it("builds a stable per-task workspace dir", () => {
    expect(taskWorkspaceDir("/work", 23).replace(/\\/g, "/")).toBe("/work/.builderforce/tasks/23");
  });

  it("builds the git-proxy clone url (trims trailing slash)", () => {
    expect(buildTaskCloneUrl("https://api.builderforce.ai/", "12", "repo-abc")).toBe(
      "https://api.builderforce.ai/api/agent-hosts/12/git-proxy/repo-abc",
    );
  });

  it("builds a deterministic branch name", () => {
    expect(taskBranchName(23)).toBe("builderforce/task-23");
  });
});

describe("parseGitPorcelain", () => {
  it("maps untracked + added to created, attributed to the agent", () => {
    const out = parseGitPorcelain("?? src/new.ts\nA  src/added.ts", "Audit Agent");
    expect(out).toEqual([
      { path: "src/new.ts", change: "created", agent: "Audit Agent" },
      { path: "src/added.ts", change: "created", agent: "Audit Agent" },
    ]);
  });

  it("maps modified and deleted", () => {
    const out = parseGitPorcelain(" M src/a.ts\n D src/b.ts\nD  src/c.ts", "X");
    expect(out.map((c) => [c.path, c.change])).toEqual([
      ["src/a.ts", "modified"],
      ["src/b.ts", "deleted"],
      ["src/c.ts", "deleted"],
    ]);
  });

  it("attributes the new path on a rename", () => {
    const out = parseGitPorcelain("R  old/path.ts -> new/path.ts", "Y");
    expect(out).toEqual([{ path: "new/path.ts", change: "modified", agent: "Y" }]);
  });

  it("strips surrounding quotes from paths with spaces", () => {
    const out = parseGitPorcelain('?? "src/a b.ts"', "Z");
    expect(out[0].path).toBe("src/a b.ts");
  });

  it("ignores blank / too-short lines", () => {
    expect(parseGitPorcelain("\n\n x\n?? real.ts", "A")).toEqual([
      { path: "real.ts", change: "created", agent: "A" },
    ]);
  });
});
