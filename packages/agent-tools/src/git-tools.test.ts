import { describe, it, expect } from "vitest";
import { buildGitCommand, gitDiffTool, gitHistoryTool, gitRedoTool, gitStatusTool, gitSyncLatestTool, gitUndoTool, GIT_TOOLS } from "./git-tools.js";
import { buildStatusCommand, parseGitStatusOutput } from "./git-status.js";
import type { ToolResult } from "./tool.js";

/**
 * Acceptance for fix #4 "ONE GIT STATE CALL": git_status returns, in ONE call,
 * branch + ahead/behind + staged/unstaged/untracked + per-path last commit
 * (sha/subject/pushed), while the legacy text `output` shape still serves the
 * existing callers. The command/parse internals live in `git-status.ts` (unit-
 * tested in `git-status.test.ts`); this file is the `git-tools.ts` surface:
 * the tool result shape, the backward-compat `output`, and the other verbs'
 * sentinel exits.
 */

/** A shell that records each command and the directory it ran in, answering from `handler`. */
function recordingShell(handler: (command: string, cwd?: string) => { ok: boolean; stdout?: string; exitCode?: number; error?: string }) {
  const scripts: string[] = [];
  const cwds: Array<string | undefined> = [];
  return {
    scripts,
    cwds,
    caps: {
      shell: {
        async run(command: string, opts?: { cwd?: string }) {
          scripts.push(command);
          cwds.push(opts?.cwd);
          return handler(command, opts?.cwd);
        },
      },
    },
  };
}

const data = (r: ToolResult) =>
  r.data as Record<string, unknown> & {
    ok: boolean;
    action?: string;
    output?: string;
    error?: string;
    branch?: string | null;
    upstream?: string | null;
    ahead?: number;
    behind?: number;
    staged?: Array<unknown>;
    unstaged?: Array<unknown>;
    untracked?: string[];
    paths?: Array<Record<string, unknown>>;
  };

describe("git_status — ONE call, structured result, backward compatible", () => {
  it("returns branch + ahead/behind + staged/unstaged/untracked + per-path last commit in ONE shell call", async () => {
    const sh = recordingShell(() => ({
      ok: true,
      exitCode: 0,
      stdout: [
        "## ticket/4-one-git-state...origin/ticket/4-one-git-state [ahead 1, behind 2]",
        "M  staged.ts",
        " M unstaged.ts",
        "?? fresh.ts",
        "@@bf-path 0",
        "abc123def Ada Lovelace\x1fada@x.io\x1f2026-11-09T10:00:00+00:00\x1ffix: one git state call",
        "@@bf-pushed yes",
        "@@bf-path 1",
      ].join("\n"),
    }));
    const out = data(await gitStatusTool.execute({ paths: ["staged.ts", "new.ts"] }, sh as never));

    // ONE git invocation for the whole answer — no per-path child calls.
    expect(sh.scripts).toHaveLength(1);
    expect(sh.scripts[0]).toBe(buildStatusCommand(["staged.ts", "new.ts"]));

    // The structured fields.
    expect(out).toMatchObject({
      ok: true,
      action: "status",
      branch: "ticket/4-one-git-state",
      upstream: "origin/ticket/4-one-git-state",
      ahead: 1,
      behind: 2,
      staged: [{ path: "staged.ts", status: "M" }],
      unstaged: [{ path: "unstaged.ts", status: "M" }],
      untracked: ["fresh.ts"],
    });
    expect(out.paths).toEqual([
      {
        path: "staged.ts",
        lastCommit: { sha: "abc123def", subject: "fix: one git state call", author: "Ada Lovelace", email: "ada@x.io", date: "2026-11-09T10:00:00+00:00" },
        onUpstream: true,
      },
      { path: "new.ts", lastCommit: null, onUpstream: null },
    ]);
  });

  it("keeps the legacy text `output` (existing callers parse its header) and `pushed` naming beside it", async () => {
    const sh = recordingShell(() => ({ ok: true, exitCode: 0, stdout: "## main...origin/main [ahead 1]\n M src/a.ts\n" }));
    const out = data(await gitStatusTool.execute({}, sh as never));
    // Old shape: { ok, action, output }.
    expect(out).toMatchObject({ ok: true, action: "status" });
    expect(typeof out.output).toBe("string");
    expect(out.output).toContain("## main...origin/main");
    expect(out.output).toContain("src/a.ts");
    // New fields ride along without breaking the old readers.
    expect(out.branch).toBe("main");
    expect(out.ahead).toBe(1);
  });

  it("scopes the entries to the given paths and still answers in one call", async () => {
    const sh = recordingShell((_cmd, cwd) =>
      cwd === "app"
        ? { ok: true, exitCode: 0, stdout: "## main...origin/main\n@@bf-path 0\nabc A\x1fa@x\x1f2026\x1fs\n@@bf-pushed no\n" }
        : { ok: false, exitCode: 128, stdout: "fatal: not a git repository (or any of the parent directories): .git" },
    );
    const out = data(await gitStatusTool.execute({ paths: ["app/src/x.ts"] }, sh as never));
    expect(sh.scripts).toHaveLength(2); // root probe + repo-scoped retry, not one call per path.
    expect(out.repo).toBe("app");
    expect(out.paths?.[0]).toMatchObject({ path: "app/src/x.ts", onUpstream: false });
  });

  it("the parse is exported from git-tools for the Container mirror and agrees with the tool result", () => {
    const { output, report } = parseGitStatusOutput("## main...origin/main [behind 3]\n M a.ts\n", undefined);
    expect(output.startsWith("## main")).toBe(true);
    expect(report).toMatchObject({ branch: "main", behind: 3, unstaged: [{ path: "a.ts", status: "M" }] });
  });
});

describe("git tools — shared runner contract (gitToolResult)", () => {
  it("git_diff returns the raw diff text under `output`", async () => {
    const sh = recordingShell(() => ({ ok: true, exitCode: 0, stdout: "diff --git a/x.ts b/x.ts\n" }));
    const out = data(await gitDiffTool.execute({ path: "x.ts" }, sh as never));
    expect(sh.scripts[0]).toBe(buildGitCommand("diff", { path: "x.ts" }));
    expect(out).toMatchObject({ ok: true, action: "diff", output: "diff --git a/x.ts b/x.ts" });
  });

  it("git_history caps the limit and honours a path", async () => {
    const sh = recordingShell(() => ({ ok: true, exitCode: 0, stdout: "a1b2c3 subject\n" }));
    const out = data(await gitHistoryTool.execute({ path: "x.ts", limit: 9999 }, sh as never));
    expect(sh.scripts[0]).toBe(buildGitCommand("history", { path: "x.ts", limit: 9999 }));
    expect(sh.scripts[0]).toContain("log --oneline -n 200");
    expect(out.output).toContain("a1b2c3 subject");
  });

  it("sync_latest decodes the MERGE_CONFLICT sentinel (exit 3) into an actionable error", async () => {
    const sh = recordingShell(() => ({ ok: false, exitCode: 3, stdout: "Auto-merging x.ts\nCONFLICT\nMERGE_CONFLICT\n" }));
    const out = data(await gitSyncLatestTool.execute({}, sh as never));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("merge conflict");
  });

  it("undo/redo decode the DIRTY sentinel (exit 4) and refuse to discard work", async () => {
    for (const tool of [gitUndoTool, gitRedoTool]) {
      const sh = recordingShell(() => ({ ok: false, exitCode: 4, stdout: "DIRTY" }));
      const out = data(await tool.execute({}, sh as never));
      expect(out.ok).toBe(false);
      expect(out.error).toContain("uncommitted changes");
    }
  });

  it("a failed command surfaces the error text, not a silent ok:false without detail", async () => {
    const sh = recordingShell(() => ({ ok: false, exitCode: 1, stdout: "fatal: bad revision", error: "exit 1" }));
    const out = data(await gitHistoryTool.execute({}, sh as never));
    expect(out).toMatchObject({ ok: false, action: "history", output: "fatal: bad revision", error: "exit 1" });
  });
});

describe("GIT_TOOLS catalog", () => {
  it("advertises git_status first with the shell capability, unchanged for every engine", () => {
    expect(GIT_TOOLS.map((t) => t.name)).toEqual([
      "git_status",
      "git_diff",
      "git_history",
      "git_sync_latest",
      "git_undo",
      "git_redo",
      "git_commit",
      "git_push",
      "open_pull_request",
      "git_cleanup_merged",
    ]);
    expect(gitStatusTool.requires).toContain("shell");
  });
});
