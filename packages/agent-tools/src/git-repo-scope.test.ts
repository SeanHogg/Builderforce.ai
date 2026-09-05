import { describe, it, expect } from "vitest";
import { buildGitCommand } from "./core-tools.js";

/**
 * The workspace root is not always the repository root. A folder holding several
 * checkouts side by side (`/code/`, with `/code/app` and `/code/api` each a repo)
 * makes `git status` fail with a bare "not a git repository" — which the agent read
 * as "git is unusable here" and gave up on. `repo` scopes the command into the right
 * checkout instead.
 */
describe("buildGitCommand repo scoping", () => {
  it("is byte-for-byte unchanged when no repo is given", () => {
    // The Container image's execTool runs these exact strings; drift here is a
    // cross-surface behaviour change.
    expect(buildGitCommand("status")).toBe("git status --short --branch");
    expect(buildGitCommand("diff")).toBe("git --no-pager diff");
    expect(buildGitCommand("history", { limit: 5 })).toBe("git --no-pager log --oneline -n 5");
  });

  it("scopes the read-only actions into the named checkout", () => {
    expect(buildGitCommand("status", { repo: "Builderforce.ai" })).toBe('cd "Builderforce.ai" && git status --short --branch');
    expect(buildGitCommand("diff", { repo: "app", path: "src" })).toBe('cd "app" && git --no-pager diff -- "src"');
  });

  it("refuses a repo that would walk OUT of the workspace", () => {
    // `cd` makes traversal an escape, not merely a wider scope.
    for (const repo of ["../elsewhere", "a/../../etc", "..", "/etc"]) {
      expect(buildGitCommand("status", { repo })).toBe("git status --short --branch");
    }
  });

  it("still accepts a directory whose name contains dots", () => {
    expect(buildGitCommand("status", { repo: "Builderforce.ai" })).toContain('cd "Builderforce.ai"');
  });
});
