import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBash } from "./node-posix-shell.js";
import { gitCleanupMergedTool } from "./git-tools.js";
import {
  checkConventionWorktreeShell,
  DIRTY_WORKTREE_EXIT,
  removeFoundWorktreeShell,
  worktreeNameFor,
  worktreeNameShell,
  worktreePathFor,
} from "./worktree-path.js";

const posixShell = (): string | null => (process.platform === "win32" ? findBash() : "/bin/sh");
const removalLines = (): string[] => [...checkConventionWorktreeShell("TARGET"), removeFoundWorktreeShell()];

describe("git_cleanup_merged's worktree removal (real git)", () => {
  // The two ways a convention worktree comes to exist: git_commit's script adds `$ORIG/../<name>`
  // (absolute, unnormalised); the run_command refusal tells the model `git worktree add ../<name>`
  // from the top level. The cleanup must find and remove either.
  it.each([
    ["git_commit's absolute `$ORIG/../` form", 'git worktree add "$(git rev-parse --show-toplevel)/../feature-x-wt" -b feature/x'],
    ["the run_command refusal's relative form", `git worktree add -b feature/x ${worktreePathFor("feature/x")}`],
  ])("removes a worktree added by %s", (_how, add) => {
    const bash = posixShell();
    if (!bash || spawnSync("git", ["--version"]).status !== 0) return;
    const root = mkdtempSync(join(tmpdir(), "bf-wt-"));
    try {
      const repo = join(root, "repo");
      const setup = [
        `git init -q "${repo.replace(/\\/g, "/")}"`,
        `cd "${repo.replace(/\\/g, "/")}"`,
        "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init",
        add,
      ].join(" && ");
      expect(spawnSync(bash, ["-c", setup], { encoding: "utf8" }).status).toBe(0);
      expect(existsSync(join(root, "feature-x-wt"))).toBe(true);
      const cleanup = [`cd "${repo.replace(/\\/g, "/")}"`, "TARGET=feature/x", ...removalLines()].join("\n");
      expect(spawnSync(bash, ["-c", cleanup], { encoding: "utf8" }).status).toBe(0);
      expect(existsSync(join(root, "feature-x-wt"))).toBe(false);
      expect(spawnSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf8" }).stdout).not.toContain("feature-x-wt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("regression: git_cleanup_merged keeps a worktree with uncommitted edits and changes NOTHING — branch, worktree and checkout as they were", async () => {
    const bash = posixShell();
    if (!bash || spawnSync("git", ["--version"]).status !== 0) return;
    const root = mkdtempSync(join(tmpdir(), "bf-wt-"));
    try {
      const repo = join(root, "repo").replace(/\\/g, "/");
      const setup = [
        `git init -q "${repo}"`,
        `cd "${repo}"`,
        "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init",
        "git checkout -q -b work",
        `git worktree add -q -b feature/x ${worktreePathFor("feature/x")}`,
        'echo work > "../feature-x-wt/edit.txt"',
      ].join(" && ");
      expect(spawnSync(bash, ["-c", setup], { encoding: "utf8" }).status).toBe(0);
      // The REAL cleanup script, through the tool, on a real shell in the checkout.
      const shell = {
        async run(command: string) {
          const r = spawnSync(bash, ["-c", command], { cwd: repo, encoding: "utf8" });
          return { ok: r.status === 0, exitCode: r.status ?? undefined, stdout: `${r.stdout}${r.stderr}` };
        },
      };
      const result = await gitCleanupMergedTool.execute({ branch: "feature/x", baseBranch: "main" }, { caps: { shell } } as never);
      expect(result.data).toMatchObject({ ok: false, error: expect.stringContaining("was kept and the branch was NOT deleted") });
      expect(existsSync(join(root, "feature-x-wt", "edit.txt"))).toBe(true);
      expect(spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", "refs/heads/feature/x"]).status).toBe(0);
      // Refused before the fetch / `git checkout "$BASE"`: the checkout is still on its branch.
      expect(spawnSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim()).toBe("work");
      expect(DIRTY_WORKTREE_EXIT).toBe(14);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("THE worktree path convention", () => {
  it("is `../<branch>-wt` from the repository top level, every `/` a `-`", () => {
    expect(worktreePathFor("main")).toBe("../main-wt");
    expect(worktreePathFor("agentNode/issue-42/fix")).toBe("../agentNode-issue-42-fix-wt");
  });

  it("the shell spelling git_cleanup_merged runs names the same directory as the TS one", () => {
    const bash = posixShell();
    if (!bash) return; // no POSIX shell on this machine: the cleanup script cannot run here either
    for (const branch of ["main", "feature/login", "a/b/c-d", "ticket/2394-mobile"]) {
      const run = spawnSync(bash, ["-c", `TARGET='${branch}'; printf '%s' "${worktreeNameShell("TARGET")}"`], { encoding: "utf8" });
      expect(run.stdout).toBe(worktreeNameFor(branch));
    }
  });
});
