/**
 * `run_command` never switches the branch of a checkout with uncommitted changes — driven at
 * the surface the run uses (`runShellCommand` over a fake shell), so the command that would
 * have switched is proven never to reach the shell.
 */

import { describe, expect, it, vi } from "vitest";
import { runShellCommand } from "./shell-tools.js";
import type { ShellCapability, ShellResult } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

/** A shell whose `git status --porcelain` answers `status`; every other command succeeds. */
function fakeShell(status: ShellResult, extra: Partial<ShellCapability> = {}): { shell: ShellCapability; calls: { command: string; cwd?: string }[] } {
  const calls: { command: string; cwd?: string }[] = [];
  const shell = {
    run: vi.fn(async (command: string, opts?: { cwd?: string }) => {
      calls.push({ command, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
      return command.includes("status --porcelain") ? status : { ok: true, exitCode: 0, stdout: "switched" };
    }),
    ...extra,
  } as unknown as ShellCapability;
  return { shell, calls };
}

function ctxWith(shell: ShellCapability): ToolContext {
  return { caps: { capabilities: new Set(["shell"]), shell } } as never;
}

const DIRTY: ShellResult = { ok: true, exitCode: 0, stdout: " M src/a.ts\n M src/b.ts\n?? notes.md\nA  src/c.ts\n" };
const CLEAN: ShellResult = { ok: true, exitCode: 0, stdout: "" };
const NOT_A_REPO: ShellResult = { ok: false, exitCode: 128, stdout: "fatal: not a git repository (or any of the parent directories): .git" };

describe("run_command — a branch switch over uncommitted changes", () => {
  it("regression: dirty tree + git checkout main is refused", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "git checkout main", cwd: "repo" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch", cwd: "repo" });
    const error = String((r.data as { error: string }).error);
    expect(error).toContain("4 uncommitted change(s) (src/a.ts, src/b.ts, notes.md, and 1 more)");
    expect(error).toContain("git_commit with `branch`");
    expect(error).toContain("git show main:<path>");
    expect(error).toContain("git worktree add ../<repo>-main-wt main");
    expect(error).toContain("git restore <path>");
    // The status check ran in the command's directory; the switch never ran.
    expect(calls).toEqual([{ command: "git status --porcelain", cwd: "repo" }]);
  });

  it("refuses the switch inside a compound command, and a background one, before anything runs", async () => {
    const start = vi.fn(async () => ({ ok: true, id: "job-1" }));
    const { shell, calls } = fakeShell(DIRTY, { start, poll: vi.fn() } as Partial<ShellCapability>);
    const r = await runShellCommand({ command: "git fetch && git switch -c wip", background: true }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(start).not.toHaveBeenCalled();
    expect(calls.map((c) => c.command)).toEqual(["git status --porcelain"]);
  });

  it("checks the `git -C <dir>` checkout the command names", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    await runShellCommand({ command: "git -C repos/api checkout dev" }, ctxWith(shell));
    expect(calls[0]?.command).toBe('git -C "repos/api" status --porcelain');
  });

  it("`cd sub && git checkout main` checks sub — the checkout the switch affects — and refuses it dirty", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "cd sub && git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(calls.map((c) => c.command)).toEqual(['git -C "sub" status --porcelain']);
  });

  it("`cd sub && git -C inner switch x` checks sub/inner, relative to the run's directory", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "cd sub && git -C inner switch x", cwd: "repo" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(calls).toEqual([{ command: 'git -C "sub/inner" status --porcelain', cwd: "repo" }]);
  });

  it("a clean tree switches as written", async () => {
    const { shell, calls } = fakeShell(CLEAN);
    const r = await runShellCommand({ command: "git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(calls.map((c) => c.command)).toEqual(["git status --porcelain", "git checkout main"]);
  });

  it("a status that fails (not a repository) leaves the command to git", async () => {
    const { shell, calls } = fakeShell(NOT_A_REPO);
    const r = await runShellCommand({ command: "git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(calls.map((c) => c.command)).toEqual(["git status --porcelain", "git checkout main"]);
  });

  it("a file restore is not a switch: no status check, it runs", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    await runShellCommand({ command: "git checkout -- src/a.ts" }, ctxWith(shell));
    expect(calls.map((c) => c.command)).toEqual(["git checkout -- src/a.ts"]);
  });
});
