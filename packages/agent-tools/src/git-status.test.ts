import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGitCommand, gitStatusTool } from "./git-tools.js";
import { buildStatusCommand, GIT_STATUS_COMMAND, parseGitStatusOutput, unquoteGitPath } from "./git-status.js";
import { findBash } from "./node-posix-shell.js";
import type { ToolResult } from "./tool.js";

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

const data = (r: ToolResult) => r.data as Record<string, unknown> & { ok: boolean; output?: string; paths?: Array<Record<string, unknown>> };

describe("git_status — the command", () => {
  it("is byte-for-byte the old one-liner without paths (Container mirror, cmd.exe routing, ship verification)", () => {
    expect(buildGitCommand("status")).toBe("git status --short --branch");
    expect(buildStatusCommand([])).toBe(GIT_STATUS_COMMAND);
    expect(buildStatusCommand(["  ", ""])).toBe(GIT_STATUS_COMMAND);
  });

  it("with paths is ONE script: status limited to the paths, then a log + merge-base per path", () => {
    const cmd = buildStatusCommand(["src/a.ts", "my file.ts"]);
    expect(cmd.split("\n")[0]).toBe("git status --short --branch -- 'src/a.ts' 'my file.ts' || exit $?");
    expect(cmd.match(/git --no-pager log -1/g)).toHaveLength(2);
    expect(cmd.match(/git merge-base --is-ancestor/g)).toHaveLength(2);
    expect(cmd).toContain("'@{u}'");
  });

  it("quotes a hostile path rather than running it", () => {
    const cmd = buildStatusCommand(["x'; rm -rf / #"]);
    expect(cmd).toContain(`'x'\\''; rm -rf / #'`);
  });

  it("tries a workspace-root path re-expressed inside the repo too", () => {
    const cmd = buildStatusCommand(["app/src/x.ts"], "app");
    expect(cmd.split("\n")[0]).toBe("git status --short --branch -- 'app/src/x.ts' 'src/x.ts' || exit $?");
    expect(cmd).toContain(`[ -n "$L" ] || L="$(git --no-pager log -1`);
  });
});

describe("git_status — the parse", () => {
  it("reads branch, upstream, ahead/behind and the entry lists from the short format", () => {
    const { output, report } = parseGitStatusOutput(
      ["## main...origin/main [ahead 2, behind 1]", "M  staged.ts", " M unstaged.ts", "MM both.ts", "R  old.ts -> new.ts", "?? fresh.ts", "UU clash.ts", '?? "sp ace\\303\\251.ts"'].join("\n"),
    );
    expect(output.startsWith("## main...origin/main")).toBe(true);
    expect(report).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1, clean: false });
    expect(report.staged).toEqual([{ path: "staged.ts", status: "M" }, { path: "both.ts", status: "M" }, { path: "new.ts", status: "R", from: "old.ts" }]);
    expect(report.unstaged).toEqual([{ path: "unstaged.ts", status: "M" }, { path: "both.ts", status: "M" }]);
    expect(report.untracked).toEqual(["fresh.ts", "sp aceé.ts"]);
    expect(report.conflicted).toEqual(["clash.ts"]);
  });

  it("knows a branch with no upstream, a detached HEAD, a fresh repo and a gone upstream", () => {
    expect(parseGitStatusOutput("## feature").report).toMatchObject({ branch: "feature", upstream: null, ahead: 0, behind: 0, clean: true });
    expect(parseGitStatusOutput("## HEAD (no branch)").report).toMatchObject({ branch: null, detached: true });
    expect(parseGitStatusOutput("## No commits yet on main").report).toMatchObject({ branch: "main", noCommits: true });
    expect(parseGitStatusOutput("## t/1...origin/t/1 [gone]").report).toMatchObject({ upstream: "origin/t/1", upstreamGone: true });
  });

  it("reads each path's last commit and whether it is on the upstream", () => {
    const stdout = [
      "## main...origin/main",
      "@@bf-path 0",
      "abc123 Ada\x1fada@x.io\x1f2026-11-08T10:00:00+00:00\x1ffix: thing",
      "@@bf-pushed yes",
      "@@bf-path 1",
    ].join("\n");
    const { output, report } = parseGitStatusOutput(stdout, ["a.ts", "new.ts"]);
    expect(output).toBe("## main...origin/main");
    expect(report.paths).toEqual([
      { path: "a.ts", lastCommit: { sha: "abc123", subject: "fix: thing", author: "Ada", email: "ada@x.io", date: "2026-11-08T10:00:00+00:00" }, onUpstream: true },
      { path: "new.ts", lastCommit: null, onUpstream: null },
    ]);
  });

  it("says nothing about 'pushed' when there is no upstream to compare with", () => {
    const stdout = ["## local", "@@bf-path 0", "abc Ada\x1fa@x\x1f2026\x1fs", "@@bf-pushed no"].join("\n");
    expect(parseGitStatusOutput(stdout, ["a.ts"]).report.paths?.[0]?.onUpstream).toBeNull();
  });

  it("unquotes git's C-style paths", () => {
    expect(unquoteGitPath('"a\\tb\\"c"')).toBe('a\tb"c');
    expect(unquoteGitPath("plain.ts")).toBe("plain.ts");
  });
});

describe("git_status tool — one call, one shell invocation", () => {
  it("returns the structured report beside the raw output, in one shell call", async () => {
    const sh = recordingShell(() => ({ ok: true, exitCode: 0, stdout: "## main...origin/main [ahead 1]\n M src/a.ts\n" }));
    const out = data(await gitStatusTool.execute({}, sh as never));
    expect(sh.scripts).toEqual(["git status --short --branch"]);
    expect(out).toMatchObject({ ok: true, action: "status", branch: "main", upstream: "origin/main", ahead: 1, behind: 0, unstaged: [{ path: "src/a.ts", status: "M" }] });
    expect(out.output).toContain("src/a.ts");
  });

  it("with paths, still ONE shell call, scoped into the checkout the first path names", async () => {
    const sh = recordingShell((_cmd, cwd) =>
      cwd === "app"
        ? { ok: true, exitCode: 0, stdout: "## main...origin/main\n@@bf-path 0\nabc Ada\x1fa@x\x1f2026\x1fs\n@@bf-pushed yes\n" }
        : { ok: false, exitCode: 128, stdout: "fatal: not a git repository (or any of the parent directories): .git" },
    );
    const out = data(await gitStatusTool.execute({ paths: ["app/src/x.ts"] }, sh as never));
    expect(sh.cwds).toEqual([undefined, "app"]);
    expect(sh.scripts[1]).toBe(buildStatusCommand(["app/src/x.ts"], "app"));
    expect(out.repo).toBe("app");
    expect(out.paths).toEqual([{ path: "app/src/x.ts", lastCommit: { sha: "abc", subject: "s", author: "Ada", email: "a@x", date: "2026" }, onUpstream: true }]);
  });
});

// The real thing: a remote, a clone, a commit pushed by someone else, and a local commit not yet pushed.
const bash = findBash();
describe.skipIf(!bash)("git_status against a real repository", () => {
  const root = mkdtempSync(join(tmpdir(), "bf-git-status-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const shell = (cwd: string) => ({
    caps: {
      shell: {
        async run(command: string) {
          try {
            return { ok: true, exitCode: 0, stdout: execFileSync(bash!, ["-c", command], { cwd, encoding: "utf8" }) };
          } catch (e) {
            const err = e as { status?: number; stdout?: string; stderr?: string };
            return { ok: false, exitCode: err.status ?? 1, stdout: `${err.stdout ?? ""}${err.stderr ?? ""}` };
          }
        },
      },
    },
  });

  it("answers committed / pushed / by whom for each path in one call", async () => {
    const remote = join(root, "remote.git");
    const clone = join(root, "clone");
    git(root, "init", "--bare", "-b", "main", remote);
    git(root, "clone", remote, clone);
    const id = (name: string) => ["-c", `user.name=${name}`, "-c", `user.email=${name.toLowerCase()}@x.io`];
    writeFileSync(join(clone, "pushed.ts"), "a\n");
    git(clone, "add", "pushed.ts");
    git(clone, ...id("Other"), "commit", "-m", "other session's commit");
    git(clone, "push", "-u", "origin", "main");
    writeFileSync(join(clone, "local.ts"), "b\n");
    git(clone, "add", "local.ts");
    git(clone, ...id("Me"), "commit", "-m", "not pushed yet");
    writeFileSync(join(clone, "dirty.ts"), "c\n");

    const out = data(await gitStatusTool.execute({ paths: ["pushed.ts", "local.ts", "dirty.ts"] }, shell(clone) as never));
    expect(out).toMatchObject({ ok: true, branch: "main", upstream: "origin/main", ahead: 1, behind: 0, untracked: ["dirty.ts"], staged: [], unstaged: [] });
    const [pushed, local, dirty] = out.paths!;
    expect(pushed).toMatchObject({ path: "pushed.ts", onUpstream: true, lastCommit: { author: "Other", subject: "other session's commit" } });
    expect(local).toMatchObject({ path: "local.ts", onUpstream: false, lastCommit: { author: "Me", subject: "not pushed yet" } });
    expect(dirty).toEqual({ path: "dirty.ts", lastCommit: null, onUpstream: null });
  });
});
