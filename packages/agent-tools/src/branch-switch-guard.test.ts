/**
 * `run_command` never switches the branch of a checkout with uncommitted changes — driven at
 * the surface the run uses (`runShellCommand` over a fake shell), so the command that would
 * have switched is proven never to reach the shell.
 */

import { describe, expect, it, vi } from "vitest";
import { runShellCommand } from "./shell-tools.js";
import { parsePorcelainPaths, pendingChangesSummary } from "./git-status.js";
import type { ShellCapability, ShellResult } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

interface Call {
  command: string;
  cwd?: string;
  fresh?: boolean;
}

/**
 * A shell whose `git … status --porcelain` answers `status`, `rev-parse` answers `revParse`,
 * `for-each-ref` answers `remote`; every other command succeeds.
 */
function fakeShell(
  status: ShellResult,
  extra: Partial<ShellCapability> = {},
  answers: { revParse?: ShellResult; remote?: ShellResult } = {},
): { shell: ShellCapability; calls: Call[] } {
  const calls: Call[] = [];
  const shell = {
    run: vi.fn(async (command: string, opts?: { cwd?: string; fresh?: boolean }) => {
      calls.push({ command, ...(opts?.cwd ? { cwd: opts.cwd } : {}), ...(opts?.fresh ? { fresh: true } : {}) });
      if (command.includes("status --porcelain --branch")) return status;
      if (command.includes("rev-parse --verify")) return answers.revParse ?? { ok: true, exitCode: 0, stdout: "3f5c2a9e1b7d4c6f8a0b2d4e6f8a0c2e4b6d8f0a" };
      if (command.includes("for-each-ref")) return answers.remote ?? { ok: true, exitCode: 0, stdout: "(no output)" };
      return { ok: true, exitCode: 0, stdout: "switched" };
    }),
    ...extra,
  } as unknown as ShellCapability;
  return { shell, calls };
}

function ctxWith(shell: ShellCapability): ToolContext {
  return { caps: { capabilities: new Set(["shell"]), shell } } as never;
}

const DIRTY: ShellResult = { ok: true, exitCode: 0, stdout: " M src/a.ts\n M src/b.ts\n?? notes.md\nR  old.ts -> src/c.ts\n" };
const CLEAN: ShellResult = { ok: true, exitCode: 0, stdout: "" };
const NOT_A_REPO: ShellResult = { ok: false, exitCode: 128, stdout: "fatal: not a git repository (or any of the parent directories): .git" };
const NO_COMMIT: ShellResult = { ok: false, exitCode: 1, stdout: "" };

const commands = (calls: readonly Call[]): string[] => calls.map((c) => c.command);
const errorOf = (r: { data: unknown }): string => String((r.data as { error: string }).error);

describe("run_command — a branch switch over uncommitted changes", () => {
  it("regression: dirty tree + git checkout main is refused", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "git checkout main", cwd: "repo" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch", cwd: "repo" });
    const error = errorOf(r);
    expect(error).toContain("4 uncommitted change(s) (src/a.ts, src/b.ts, notes.md, and 1 more)");
    expect(error).toContain("git_commit with `branch`");
    expect(error).toContain("git show main:<path>");
    expect(error).toContain("git worktree add ../main-wt main");
    expect(error).toContain("git restore <path>");
    expect(error).toContain("If this command commits or stashes first, run that part on its own, then the switch.");
    // The status check (fresh, in the command's directory) and the commit check ran; the switch never did.
    expect(calls).toEqual([
      { command: "git status --porcelain --branch", cwd: "repo", fresh: true },
      { command: 'git rev-parse --verify --quiet "main^{commit}"', cwd: "repo", fresh: true },
    ]);
  });

  it("names the worktree by THE convention (`/` → `-`), the path git_cleanup_merged removes", async () => {
    const { shell } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "git switch -c feature/login" }, ctxWith(shell));
    expect(errorOf(r)).toContain("git worktree add -b feature/login ../feature-login-wt");
  });

  it("refuses the switch inside a compound command, and a background one, before anything runs", async () => {
    const start = vi.fn(async () => ({ ok: true, id: "job-1" }));
    const { shell, calls } = fakeShell(DIRTY, { start, poll: vi.fn() } as Partial<ShellCapability>);
    const r = await runShellCommand({ command: "git fetch && git switch -c wip", background: true }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(start).not.toHaveBeenCalled();
    expect(commands(calls)).toEqual(["git status --porcelain --branch"]);
  });

  it("refuses a yieldMs run before the job starts", async () => {
    const start = vi.fn(async () => ({ ok: true, id: "job-1" }));
    const { shell } = fakeShell(DIRTY, { start, poll: vi.fn() } as Partial<ShellCapability>);
    const r = await runShellCommand({ command: "git switch main", yieldMs: 1000 }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(start).not.toHaveBeenCalled();
  });

  it("checks the `git -C <dir>` checkout the command names", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    await runShellCommand({ command: "git -C repos/api switch dev" }, ctxWith(shell));
    expect(calls[0]?.command).toBe('git -C "repos/api" status --porcelain --branch');
  });

  it("`cd sub && git checkout main` checks sub — the checkout the switch affects — and refuses it dirty", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "cd sub && git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(commands(calls)).toEqual(['git -C "sub" status --porcelain --branch', 'git -C "sub" rev-parse --verify --quiet "main^{commit}"']);
  });

  it("`cd sub && git -C inner switch x` checks sub/inner, relative to the run's directory", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "cd sub && git -C inner switch x", cwd: "repo" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(calls).toEqual([{ command: 'git -C "sub/inner" status --porcelain --branch', cwd: "repo", fresh: true }]);
  });

  it("a Windows `cd C:\\work\\api` is checked there, with forward slashes", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "cd C:\\work\\api && git switch main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(calls[0]?.command).toBe('git -C "C:/work/api" status --porcelain --branch');
  });

  it.each(["cd ~/repo && git switch main", 'cd "$REPO" && git switch main', "git -C %REPO% switch main"])(
    "fails closed when the checkout cannot be named to git safely: %s",
    async (command) => {
      const { shell, calls } = fakeShell(CLEAN);
      const r = await runShellCommand({ command }, ctxWith(shell));
      expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
      expect(errorOf(r)).toContain("could not be verified clean");
      expect(errorOf(r)).toContain("`cwd`");
      expect(calls).toEqual([]);
    },
  );

  it("a bare `git checkout <path>` that names no commit is a restore: it runs over a dirty tree", async () => {
    const { shell, calls } = fakeShell(DIRTY, {}, { revParse: NO_COMMIT });
    const r = await runShellCommand({ command: "git checkout src/a.ts" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual([
      "git status --porcelain --branch",
      'git rev-parse --verify --quiet "src/a.ts^{commit}"',
      'git for-each-ref --count=1 "--format=%(refname)" "refs/remotes/*/src/a.ts"',
      "git checkout src/a.ts",
    ]);
  });

  it("a bare `git checkout <x>` where only a remote branch `x` exists is still a switch (git would track it)", async () => {
    const { shell, calls } = fakeShell(DIRTY, {}, { revParse: NO_COMMIT, remote: { ok: true, exitCode: 0, stdout: "refs/remotes/origin/feature\n" } });
    const r = await runShellCommand({ command: "git checkout feature" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(commands(calls)).not.toContain("git checkout feature");
  });

  it("a host that reports an empty stdout as `(no output)` never turns that into a commit: `git checkout <path>` runs", async () => {
    const { shell, calls } = fakeShell(DIRTY, {}, { revParse: { ok: true, exitCode: 0, stdout: "(no output)" } });
    const r = await runShellCommand({ command: "git checkout src/a.ts" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(commands(calls).at(-1)).toBe("git checkout src/a.ts");
  });

  it("`git checkout main --` is unambiguously a commit: refused without asking rev-parse", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    const r = await runShellCommand({ command: "git checkout main --" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
    expect(commands(calls)).toEqual(["git status --porcelain --branch"]);
  });

  describe("a host that trims its output (the VS Code shell)", () => {
    it("a trimmed first entry (` M src/a.ts` arriving as `M src/a.ts`) still counts: refused", async () => {
      const { shell, calls } = fakeShell({ ok: true, exitCode: 0, stdout: "M src/a.ts" });
      const r = await runShellCommand({ command: "git switch main" }, ctxWith(shell));
      expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
      expect(errorOf(r)).toContain("1 uncommitted change(s) (src/a.ts)");
      expect(commands(calls)).not.toContain("git switch main");
    });

    it("the header-first form, trimmed, with a dirty entry: refused", async () => {
      const { shell } = fakeShell({ ok: true, exitCode: 0, stdout: "## main...origin/main\n M src/a.ts\n?? new.md" });
      const r = await runShellCommand({ command: "git switch dev" }, ctxWith(shell));
      expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
      expect(errorOf(r)).toContain("2 uncommitted change(s) (src/a.ts, new.md)");
    });

    it("a clean tree reported as `(no output)` — or as the header alone — switches", async () => {
      for (const stdout of ["(no output)", "## main...origin/main"]) {
        const { shell, calls } = fakeShell({ ok: true, exitCode: 0, stdout });
        const r = await runShellCommand({ command: "git switch dev" }, ctxWith(shell));
        expect(r.data).toMatchObject({ ok: true });
        expect(commands(calls)).toEqual(["git status --porcelain --branch", "git switch dev"]);
      }
    });
  });

  describe("git gives NO answer (the host stopped it before an exit code): fail closed", () => {
    const TIMED_OUT: ShellResult = { ok: false, error: "timed out after 120s", stdout: "" };

    it("a status that timed out refuses the switch — it could not be verified clean", async () => {
      const { shell, calls } = fakeShell(TIMED_OUT);
      const r = await runShellCommand({ command: "git switch main" }, ctxWith(shell));
      expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
      expect(errorOf(r)).toContain("state could not be read (timed out after 120s)");
      expect(errorOf(r)).toContain("`cwd`");
      expect(commands(calls)).toEqual(["git status --porcelain --branch"]);
    });

    it.each([
      ["rev-parse", { revParse: TIMED_OUT }],
      ["for-each-ref", { revParse: NO_COMMIT, remote: TIMED_OUT }],
    ])("an unanswered %s is not read as \"a path\": `git checkout <x>` over a dirty tree is refused", async (_which, answers) => {
      const { shell, calls } = fakeShell(DIRTY, {}, answers);
      const r = await runShellCommand({ command: "git checkout feature" }, ctxWith(shell));
      expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
      expect(commands(calls)).not.toContain("git checkout feature");
    });
  });

  it("a sha printed with a CRLF ending still names a commit", async () => {
    const { shell } = fakeShell(DIRTY, {}, { revParse: { ok: true, exitCode: 0, stdout: "3f5c2a9e1b7d4c6f8a0b2d4e6f8a0c2e4b6d8f0a\r\n" } });
    const r = await runShellCommand({ command: "git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: false, refused: "branch-switch" });
  });

  it("a clean tree switches as written", async () => {
    const { shell, calls } = fakeShell(CLEAN);
    const r = await runShellCommand({ command: "git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual(["git status --porcelain --branch", "git checkout main"]);
  });

  it("a status that fails (not a repository) leaves the command to git", async () => {
    const { shell, calls } = fakeShell(NOT_A_REPO);
    const r = await runShellCommand({ command: "git checkout main" }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual(["git status --porcelain --branch", "git checkout main"]);
  });

  it("a file restore is not a switch: no status check, it runs", async () => {
    const { shell, calls } = fakeShell(DIRTY);
    await runShellCommand({ command: "git checkout -- src/a.ts" }, ctxWith(shell));
    expect(commands(calls)).toEqual(["git checkout -- src/a.ts"]);
  });
});

describe("THE porcelain reader and pending-changes phrase", () => {
  it("reads entries in order — a rename as its new path, a quoted path unquoted — and skips headers and ignored files", () => {
    expect(parsePorcelainPaths('## main\n M a.ts\nR  old.ts -> new.ts\n?? "sp ace.md"\n!! dist/\n\n')).toEqual(["a.ts", "new.ts", "sp ace.md"]);
  });

  it("reads trimmed output and `(no output)`: a first `M a.ts` is an entry, `(no output)` is none", () => {
    expect(parsePorcelainPaths("M a.ts\n M b.ts\nMM c.ts")).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(parsePorcelainPaths("(no output)")).toEqual([]);
    expect(parsePorcelainPaths("## main")).toEqual([]);
  });

  it("names up to three paths and counts the rest", () => {
    expect(pendingChangesSummary(["a"])).toBe("1 uncommitted change(s) (a)");
    expect(pendingChangesSummary(["a", "b", "c", "d", "e"])).toBe("5 uncommitted change(s) (a, b, c, and 2 more)");
  });
});
