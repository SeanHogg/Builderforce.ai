import { describe, it, expect } from "vitest";
import { buildCoreToolRegistry } from "./core-tools.js";
import { commitPathCandidates, gitCleanupMergedTool } from "./git-tools.js";
import type { ToolResult } from "./tool.js";

/**
 * Two gaps a real run exposed, both of them "the agent had no verb, so it hand-rolled
 * one and the hand-rolled one was wrong":
 *
 *  1. Nothing put the checkout back after work landed, so the agent reached for
 *     `run_command` and ran `git push origin --delete <branch>` — which failed with
 *     `remote ref does not exist`, because the host had already deleted the branch when
 *     the pull request merged. Cleanup that errors on its own goal state is worse than
 *     none, so `git_cleanup_merged` is idempotent by construction.
 *  2. `git_commit` was handed workspace-root-relative paths while `repo` scoped git into
 *     a subdirectory; git warned `could not open directory 'api/api/src/…'`, staged
 *     nothing, and the agent was told "nothing to commit" — a wrong-path failure wearing
 *     an empty-diff message.
 */

/** A shell that records the script it was handed and reports success. */
function recordingShell() {
  const scripts: string[] = [];
  return {
    scripts,
    caps: {
      shell: {
        async run(command: string) {
          scripts.push(command);
          return { ok: true, exitCode: 0, stdout: "ok" };
        },
      },
    },
  };
}

/** A shell that fails with one of the scripts' sentinel exit codes. */
function failingShell(exitCode: number, stdout: string) {
  return { caps: { shell: { async run() { return { ok: false, exitCode, stdout }; } } } };
}

const data = (r: ToolResult) => r.data as { ok?: boolean; error?: string };

describe("git_cleanup_merged", () => {
  it("is advertised to surfaces that can publish, and gated on git.write", () => {
    const registry = buildCoreToolRegistry();
    const names = registry.toolsForCapabilities(new Set(["shell", "git.write"] as never)).map((t) => t.name);
    expect(names).toContain("git_cleanup_merged");
    // `shell` alone must NOT reach it: destroying a branch leaves the machine, exactly
    // like a push, and the cloud surfaces publish by a different mechanism.
    const shellOnly = registry.toolsForCapabilities(new Set(["shell"] as never)).map((t) => t.name);
    expect(shellOnly).not.toContain("git_cleanup_merged");
  });

  it("deletes the remote branch ONLY when it still exists", async () => {
    const sh = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "fix/section-state" }, sh as never);
    // The exact failure from the reported run: an unconditional `push --delete` against
    // a branch the host had already removed.
    expect(sh.scripts[0]).toContain('[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"');
    expect(sh.scripts[0]).not.toMatch(/^git push origin --delete/m);
  });

  it("returns to the base branch and brings it up to date", async () => {
    const sh = recordingShell();
    await gitCleanupMergedTool.execute({}, sh as never);
    expect(sh.scripts[0]).toContain('git checkout "$BASE"');
    expect(sh.scripts[0]).toContain('git merge --ff-only "origin/$BASE"');
    expect(sh.scripts[0]).toContain("git remote prune origin");
  });

  it("refuses to touch an unmerged branch or a dirty tree", async () => {
    const sh = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "wip/x" }, sh as never);
    expect(sh.scripts[0]).toContain("NOT_MERGED");
    expect(sh.scripts[0]).toContain("DIRTY");

    const unmerged = await gitCleanupMergedTool.execute({ branch: "wip/x" }, failingShell(10, "NOT_MERGED") as never);
    expect(data(unmerged).ok).toBe(false);
    // The refusal has to name the ONE legitimate way it can be wrong, or the agent
    // retries the same call and gets the same answer.
    expect(data(unmerged).error).toMatch(/squash/i);
    expect(data(unmerged).error).toMatch(/force:true/);

    const dirty = await gitCleanupMergedTool.execute({ branch: "wip/x" }, failingShell(4, "DIRTY") as never);
    expect(data(dirty).error).toMatch(/uncommitted changes/);
  });

  it("skips the merge check only when the caller declared force", async () => {
    const guarded = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "x" }, guarded as never);
    expect(guarded.scripts[0]).not.toContain("\nMERGED=1\n");

    const forced = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "x", force: true }, forced as never);
    expect(forced.scripts[0]).toContain("\nMERGED=1\n");
  });

  it("says there is nothing to do rather than failing on an already-clean checkout", async () => {
    for (const [code, sentinel, expected] of [
      [9, "NOTHING_TO_CLEAN", /nothing to clean up/i],
      [11, "NO_SUCH_BRANCH", /already been deleted/i],
    ] as const) {
      const r = await gitCleanupMergedTool.execute({ branch: "x" }, failingShell(code, sentinel) as never);
      expect(data(r).error).toMatch(expected);
    }
  });

  it("scopes into a repo subdirectory, and refuses one that walks out of the workspace", async () => {
    const scoped = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "x", repo: "Builderforce.ai" }, scoped as never);
    expect(scoped.scripts[0].startsWith('cd "Builderforce.ai" || exit 1\n')).toBe(true);

    const escape = recordingShell();
    await gitCleanupMergedTool.execute({ branch: "x", repo: "../elsewhere" }, escape as never);
    expect(escape.scripts[0].startsWith("cd ")).toBe(false);
  });
});

describe("commitPathCandidates", () => {
  it("always tries the path exactly as given first", () => {
    expect(commitPathCandidates("src/a.ts")).toEqual(["src/a.ts"]);
    expect(commitPathCandidates("src/a.ts", "app")[0]).toBe("src/a.ts");
  });

  it("offers the repo prefix stripped — the file tools' paths are workspace-relative", () => {
    expect(commitPathCandidates("Builderforce.ai/api/src/x.ts", "Builderforce.ai")).toEqual([
      "Builderforce.ai/api/src/x.ts",
      "api/src/x.ts",
    ]);
  });

  it("offers the repo's LAST segment stripped — the exact 'api/api/src/…' failure", () => {
    expect(commitPathCandidates("api/src/x.ts", "Builderforce.ai/api")).toEqual([
      "api/src/x.ts",
      "src/x.ts",
    ]);
  });

  it("adds nothing when there is no repo, or the path does not repeat it", () => {
    expect(commitPathCandidates("api/src/x.ts")).toEqual(["api/src/x.ts"]);
    expect(commitPathCandidates("api/src/x.ts", "frontend")).toEqual(["api/src/x.ts"]);
    // A repo argument that would escape the workspace is not a repo at all.
    expect(commitPathCandidates("api/src/x.ts", "../api")).toEqual(["api/src/x.ts"]);
  });
});
