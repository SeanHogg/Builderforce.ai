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

  // The multi-line actions took no `repo` at all, so in a folder that CONTAINS
  // checkouts they could only ever run at the root — where there is no repository.
  // `git_status` accepted `repo` and worked; these failed one call later and said
  // nothing about why.
  describe("multi-line actions", () => {
    for (const action of ["sync_latest", "undo", "redo"] as const) {
      it(`${action} enters the checkout on its own line, before anything else`, () => {
        const lines = buildGitCommand(action, { repo: "app" }).split("\n");
        // A `cd X && Y` prefix would scope only the FIRST line of the script.
        expect(lines[0]).toBe('cd "app" || exit 1');
        expect(lines.length).toBeGreaterThan(1);
      });

      it(`${action} is byte-for-byte unchanged with no repo`, () => {
        expect(buildGitCommand(action)).toBe(buildGitCommand(action, {}));
        expect(buildGitCommand(action).startsWith("cd ")).toBe(false);
      });

      it(`${action} refuses a repo that would walk out of the workspace`, () => {
        expect(buildGitCommand(action, { repo: "../elsewhere" })).toBe(buildGitCommand(action));
      });
    }

    it("sync_latest still aborts the whole script when the cd fails", () => {
      // `set -e` follows the cd, so the guard has to be on the cd itself.
      expect(buildGitCommand("sync_latest", { repo: "app" })).toContain("|| exit 1");
    });
  });
});
