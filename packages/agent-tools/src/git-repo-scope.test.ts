import { describe, it, expect } from "vitest";
import {
  buildGitCommand,
  buildListCheckoutsCommand,
  buildUnbornDiffCommands,
  gitCommitTool,
  gitDiffTool,
  gitPushTool,
  gitRedoTool,
  gitStatusTool,
  gitSyncLatestTool,
  gitUndoTool,
  inferRepoFromPath,
} from "./git-tools.js";
import { safeGitArg } from "./git-repo-scope.js";
import type { ToolResult } from "./tool.js";

const NOT_A_REPO = "fatal: not a git repository (or any of the parent directories): .git";

/** A shell that records each command and the directory it was asked to run in (`ShellRunOptions.cwd`). */
function mockShell(handler: (command: string, cwd?: string) => { ok: boolean; stdout?: string; exitCode?: number; error?: string }) {
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

const data = (r: ToolResult) => r.data as {
  ok?: boolean;
  error?: string;
  repo?: string;
  candidates?: string[];
  output?: string;
};

/**
 * The workspace root is not always the repository root. A folder holding several
 * checkouts side by side (`/code/`, with `/code/app` and `/code/api` each a repo)
 * makes `git status` fail with a bare "not a git repository" — which the agent read
 * as "git is unusable here" and gave up on. `repo` scopes the command into the right
 * checkout instead.
 */
describe("buildGitCommand repo scoping", () => {
  it("is byte-for-byte unchanged when no repo is given", () => {
    // `runGitTool` is the one consumer of these strings (the unborn-HEAD fallback lives there too);
    // pinning the text keeps the commands the shell sees stable.
    expect(buildGitCommand("status")).toBe("git status --short --branch");
    expect(buildGitCommand("diff")).toBe("git --no-pager diff HEAD");
    expect(buildGitCommand("history", { limit: 5 })).toBe("git --no-pager log --oneline -n 5");
  });

  it("builds the same command for every checkout: the directory is the shell's cwd, never a `cd`", () => {
    expect(buildGitCommand("diff", { path: "src" })).toBe('git --no-pager diff HEAD -- "src"');
    expect(buildGitCommand("diff", { pathspecs: ["app/page.tsx", "page.tsx", "$(x)"] })).toBe('git --no-pager diff HEAD -- "app/page.tsx" "page.tsx"');
    expect(buildGitCommand("history", { limit: 5, pathspecs: ["a/b.ts", "b.ts"] })).toBe('git --no-pager log --oneline -n 5 -- "a/b.ts" "b.ts"');
    for (const action of ["status", "diff", "history", "sync_latest", "undo", "redo"] as const) {
      expect(buildGitCommand(action)).not.toMatch(/\bcd\b/);
    }
  });

  // DELIBERATE BEHAVIOUR CHANGE (was: a repo that walked out was silently dropped and the command
  // ran at the workspace root). The directory is now the shell's working directory, so an explicit
  // repo that is not a safe workspace-relative one is REFUSED and nothing runs — dropping it would
  // make git_undo / git_redo reset a different repository than the one the caller named.
  it("refuses a repo that would walk OUT of the workspace, running nothing", async () => {
    for (const repo of ["../elsewhere", "a/../../etc", "..", "/etc"]) {
      const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "## main" }));
      const out = data(await gitStatusTool.execute({ repo }, sh as never));
      expect(out).toEqual({
        ok: false,
        action: "status",
        error: `repo '${repo}' must be a directory inside the workspace (no '..', not absolute), so nothing was run`,
      });
      expect(sh.scripts).toEqual([]);
      expect(sh.cwds).toEqual([]);
    }
  });

  it("refuses a whitespace-only repo (a repo that cannot be honoured), but treats an empty one as absent", async () => {
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "## main" }));
    expect(data(await gitUndoTool.execute({ repo: "   " }, sh as never))).toMatchObject({ ok: false, action: "undo" });
    expect(sh.scripts).toEqual([]);
    await gitStatusTool.execute({ repo: "" }, sh as never);
    expect(sh.scripts).toEqual(["git status --short --branch"]);
  });

  it("takes a Windows-style separator as the same directory instead of refusing it with a message about '..'", async () => {
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "## main" }));
    await gitStatusTool.execute({ repo: "apps\\web" }, sh as never);
    expect(sh.cwds).toEqual(["apps/web"]);
    // …while a backslash traversal is still an escape.
    const escaped = data(await gitStatusTool.execute({ repo: "..\\elsewhere" }, sh as never));
    expect(escaped.ok).toBe(false);
    expect(sh.cwds).toEqual(["apps/web"]);
  });

  it("refuses an escaping repo for the publish tools too, running nothing", async () => {
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "ok" }));
    const pushed = data(await gitPushTool.execute({ repo: "../x" }, sh as never));
    expect(pushed).toMatchObject({ ok: false, action: "push", error: expect.stringContaining("must be a directory inside the workspace") });
    const committed = data(await gitCommitTool.execute({ message: "m", paths: ["a.ts"], repo: "../x" }, sh as never));
    expect(committed).toMatchObject({ ok: false, action: "commit" });
    expect(sh.scripts).toEqual([]);
  });

  it("still accepts a directory whose name contains dots", async () => {
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "## main" }));
    await gitStatusTool.execute({ repo: "Builderforce.ai" }, sh as never);
    expect(sh.cwds).toEqual(["Builderforce.ai"]);
    expect(sh.scripts).toEqual(["git status --short --branch"]);
  });

  // The multi-line actions took no `repo` at all, so in a folder that CONTAINS
  // checkouts they could only ever run at the root — where there is no repository.
  // `git_status` accepted `repo` and worked; these failed one call later and said
  // nothing about why.
  describe("multi-line actions", () => {
    for (const action of ["sync_latest", "undo", "redo"] as const) {
      it(`${action} runs in the checkout as the shell's cwd, with its script untouched`, async () => {
        const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "ok" }));
        const tool = { sync_latest: gitSyncLatestTool, undo: gitUndoTool, redo: gitRedoTool }[action];
        await tool.execute({ repo: "app" }, sh as never);
        expect(sh.cwds).toEqual(["app"]);
        expect(sh.scripts[0]).toBe(buildGitCommand(action));
        expect(sh.scripts[0]!.startsWith("cd ")).toBe(false);
      });

      it(`${action} is the same script with no repo`, () => {
        expect(buildGitCommand(action)).toBe(buildGitCommand(action, {}));
        expect(buildGitCommand(action).startsWith("cd ")).toBe(false);
      });

      it(`${action} refuses a repo that would walk out of the workspace`, async () => {
        const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "ok" }));
        const tool = { sync_latest: gitSyncLatestTool, undo: gitUndoTool, redo: gitRedoTool }[action];
        const out = data(await tool.execute({ repo: "../elsewhere" }, sh as never));
        expect(out).toMatchObject({ ok: false, action, error: expect.stringContaining("must be a directory inside the workspace") });
        // Not run at the root in its place: undo/redo would reset the WRONG repository.
        expect(sh.scripts).toEqual([]);
      });
    }

    it("sync_latest still aborts the whole script when the checkout directory is missing", async () => {
      // The host refuses to start a command in a directory that is not there; the script (whose
      // own `set -e` guards the rest) is never started at the root, in ONE shell call, and the
      // tool reports the cause rather than a misleading "not a repository" walk through candidates.
      const sh = mockShell(() => ({ ok: false, error: "the directory 'app' does not exist in the workspace" }));
      const out = data(await gitSyncLatestTool.execute({ repo: "app" }, sh as never));
      expect(sh.scripts).toHaveLength(1);
      expect(sh.cwds).toEqual(["app"]);
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/does not exist/);
    });
  });
});

describe("safeGitArg", () => {
  it("keeps ordinary ref and path tokens", () => {
    expect(safeGitArg("ticket/2394-mobile-board")).toBe("ticket/2394-mobile-board");
    expect(safeGitArg("org/team-a")).toBe("org/team-a");
  });

  it("regression: refuses a leading '-', which git or gh would read as an option", () => {
    expect(safeGitArg("-D")).toBeNull();
    expect(safeGitArg("--upload-pack=x")).toBeNull();
    expect(safeGitArg("--web")).toBeNull();
  });

  it("refuses shell metacharacters", () => {
    expect(safeGitArg("a;b")).toBeNull();
    expect(safeGitArg("$(id)")).toBeNull();
  });
});

describe("inferRepoFromPath", () => {
  it("takes the first nested segment", () => {
    expect(inferRepoFromPath("Builderforce.ai/packages/x.ts")).toBe("Builderforce.ai");
    expect(inferRepoFromPath("app\\src\\a.ts")).toBe("app");
  });

  it("rejects a bare filename, traversal, and empty", () => {
    expect(inferRepoFromPath("README.md")).toBeNull();
    expect(inferRepoFromPath("../elsewhere/x.ts")).toBeNull();
    expect(inferRepoFromPath("")).toBeNull();
    expect(inferRepoFromPath(undefined)).toBeNull();
  });
});

describe("runGitTool at a multi-checkout workspace root", () => {
  it("infers repo from a path's first segment and retries scoped", async () => {
    const sh = mockShell((_cmd, cwd) => {
      if (cwd === "Builderforce.ai") {
        return { ok: true, exitCode: 0, stdout: "M packages/x.ts" };
      }
      return { ok: false, exitCode: 128, stdout: NOT_A_REPO };
    });
    const r = await gitDiffTool.execute({ path: "Builderforce.ai/packages/x.ts" }, sh as never);
    expect(data(r).ok).toBe(true);
    expect(data(r).repo).toBe("Builderforce.ai");
    expect(sh.scripts[0]).toBe(buildGitCommand("diff", { path: "Builderforce.ai/packages/x.ts" }));
    expect(sh.scripts[1]).toBe(buildGitCommand("diff", { pathspecs: ["Builderforce.ai/packages/x.ts", "packages/x.ts"] }));
    expect(sh.cwds).toEqual([undefined, "Builderforce.ai"]);
  });

  it("names candidate checkouts in the error and never mentions list_files", async () => {
    const sh = mockShell((cmd) => {
      if (cmd === buildListCheckoutsCommand()) {
        return { ok: true, exitCode: 0, stdout: "Builderforce.ai\nbuilderforce-inference\n" };
      }
      return { ok: false, exitCode: 128, stdout: NOT_A_REPO };
    });
    const r = await gitStatusTool.execute({}, sh as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).error).toMatch(/Builderforce\.ai/);
    expect(data(r).error).toMatch(/builderforce-inference/);
    expect(data(r).error).not.toMatch(/list_files/);
    expect(data(r).candidates).toEqual(["Builderforce.ai", "builderforce-inference"]);
    expect(sh.scripts[0]).toBe("git status --short --branch");
    expect(sh.scripts[1]).toBe(buildListCheckoutsCommand());
  });

  it("lets an explicit repo win over a path that would infer a different checkout", async () => {
    const sh = mockShell((_cmd, cwd) => {
      if (cwd === "other-project") {
        return { ok: true, exitCode: 0, stdout: "M foo" };
      }
      return { ok: false, exitCode: 128, stdout: NOT_A_REPO };
    });
    const r = await gitDiffTool.execute(
      { path: "Builderforce.ai/foo.ts", repo: "other-project" },
      sh as never,
    );
    expect(sh.scripts).toHaveLength(1);
    expect(sh.scripts[0]).toBe(buildGitCommand("diff", { path: "Builderforce.ai/foo.ts" }));
    expect(sh.cwds).toEqual(["other-project"]);
    expect(data(r).ok).toBe(true);
    expect(data(r).repo).toBe("other-project");
  });

  it("regression: an explicit repo + a workspace-relative path re-expresses the path inside the repo", async () => {
    // Live run: `repo: "Builderforce.ai"` + `path: "Builderforce.ai/docs/specs/make.md"` ran
    // `git diff -- "Builderforce.ai/docs/…"` inside the repo, matched nothing and returned "(no output)".
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "diff --git a/docs/x.md b/docs/x.md" }));
    await gitDiffTool.execute({ path: "Builderforce.ai/docs/x.md", repo: "Builderforce.ai" }, sh as never);
    // The path as given AND re-expressed inside the repo are both pathspecs (a no-match pathspec is harmless).
    expect(sh.scripts).toEqual(['git --no-pager diff HEAD -- "Builderforce.ai/docs/x.md" "docs/x.md"']);
    expect(sh.cwds).toEqual(["Builderforce.ai"]);
  });

  it("an explicit repo + a path without the repo prefix passes the path through unchanged", async () => {
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "x" }));
    await gitDiffTool.execute({ path: "docs/x.md", repo: "Builderforce.ai" }, sh as never);
    expect(sh.scripts).toEqual([buildGitCommand("diff", { path: "docs/x.md" })]);
    expect(sh.cwds).toEqual(["Builderforce.ai"]);
  });

  it("regression: an explicit repo whose own folder is named like the path's first segment keeps BOTH pathspecs", async () => {
    // `repo: "app"` + `path: "app/page.tsx"` where the repo really has app/page.tsx: stripping alone would lose it.
    const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "x" }));
    await gitDiffTool.execute({ path: "app/page.tsx", repo: "app" }, sh as never);
    expect(sh.scripts).toEqual(['git --no-pager diff HEAD -- "app/page.tsx" "page.tsx"']);
    expect(sh.cwds).toEqual(["app"]);
  });

  it("regression: git_diff diffs against HEAD (staged + unstaged) in ONE plain git invocation", () => {
    // Plain `git diff` is the unstaged half only, so an already-`git add`ed edit read as "no changes".
    const cmd = buildGitCommand("diff", { path: "docs/x.md" });
    expect(cmd).toBe('git --no-pager diff HEAD -- "docs/x.md"');
    // No `||` / `2>/dev/null`: a Windows host without bash refuses them.
    expect(cmd).not.toMatch(/\|\||2>/);
    expect(buildUnbornDiffCommands({ pathspecs: ["docs/x.md"] })).toEqual([
      'git --no-pager diff --cached -- "docs/x.md"',
      'git --no-pager diff -- "docs/x.md"',
    ]);
  });

  it("an unborn HEAD falls back to the staged diff plus the unstaged diff, without git's fatal text", async () => {
    const sh = mockShell((cmd) => {
      if (cmd.includes("diff HEAD")) return { ok: false, exitCode: 128, stdout: "fatal: bad revision 'HEAD'" };
      if (cmd.includes("--cached")) return { ok: true, exitCode: 0, stdout: "diff --git a/new.ts b/new.ts\n" };
      return { ok: true, exitCode: 0, stdout: "diff --git a/old.ts b/old.ts\n" };
    });
    const r = await gitDiffTool.execute({ path: "src", repo: "proj" }, sh as never);
    expect(sh.scripts).toEqual([
      'git --no-pager diff HEAD -- "src"',
      'git --no-pager diff --cached -- "src"',
      'git --no-pager diff -- "src"',
    ]);
    expect(sh.cwds).toEqual(["proj", "proj", "proj"]);
    expect(data(r).ok).toBe(true);
    expect(data(r).output).toContain("new.ts");
    expect(data(r).output).toContain("old.ts");
    expect(data(r).output).not.toMatch(/fatal/);
  });

  it("regression: a timed-out HEAD diff whose partial stdout merely contains the unborn-HEAD words does NOT run the fallback", async () => {
    const sh = mockShell(() => ({
      ok: false,
      stdout: "diff --git a/git-tools.ts b/git-tools.ts\n+const UNBORN_HEAD = /bad revision 'HEAD'|unknown revision/;\n",
      error: "timed out",
    }));
    const r = await gitDiffTool.execute({ repo: "proj" }, sh as never);
    expect(sh.scripts).toEqual(["git --no-pager diff HEAD"]);
    expect(data(r).ok).toBe(false);
  });

  it("any other diff failure is returned as is, with no fallback", async () => {
    const sh = mockShell(() => ({ ok: false, exitCode: 129, stdout: "fatal: unrecognized argument: --bogus" }));
    const r = await gitDiffTool.execute({ repo: "proj" }, sh as never);
    expect(sh.scripts).toHaveLength(1);
    expect(data(r).ok).toBe(false);
    expect(data(r).output).toContain("unrecognized argument");
  });
});

/** A shell at a multi-checkout root: only commands run with `app` as their cwd find a repository. */
function rootOfCheckouts(defaultRepo?: string) {
  const sh = mockShell((cmd, cwd) => {
    if (cmd === buildListCheckoutsCommand()) return { ok: true, exitCode: 0, stdout: "app\napi\n" };
    if (cwd === "app") return { ok: true, exitCode: 0, stdout: "## main" };
    return { ok: false, exitCode: 128, stdout: NOT_A_REPO };
  });
  if (defaultRepo) Object.assign(sh.caps.shell, { defaultRepo });
  return sh;
}

// PRD 35 E3 — characterization of today's remedy on the PUBLISH path, before the default.
describe("runPublishTool at a multi-checkout workspace root (no default repo)", () => {
  it("names the candidate checkouts when the root is not a repository", async () => {
    const sh = rootOfCheckouts();
    const r = await gitPushTool.execute({}, sh as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).candidates).toEqual(["app", "api"]);
    expect(sh.scripts[sh.scripts.length - 1]).toBe(buildListCheckoutsCommand());
  });
});

describe("the run's default repo (ShellCapability.defaultRepo)", () => {
  it("git tools retry in the default checkout before naming candidates", async () => {
    const sh = rootOfCheckouts("app");
    const r = await gitStatusTool.execute({}, sh as never);
    expect(data(r).ok).toBe(true);
    expect(data(r).repo).toBe("app");
    expect(sh.scripts).toEqual(["git status --short --branch", "git status --short --branch"]);
    expect(sh.cwds).toEqual([undefined, "app"]);
  });

  it("an explicit repo wins over the default", async () => {
    const sh = rootOfCheckouts("api");
    const r = await gitStatusTool.execute({ repo: "app" }, sh as never);
    expect(sh.scripts).toEqual(["git status --short --branch"]);
    expect(sh.cwds).toEqual(["app"]);
    expect(data(r).repo).toBe("app");
  });

  it("a path that names another checkout is tried before the default", async () => {
    const sh = rootOfCheckouts("api");
    const r = await gitDiffTool.execute({ path: "app/src/x.ts" }, sh as never);
    expect(data(r).repo).toBe("app");
    expect(sh.scripts[1]).toBe(buildGitCommand("diff", { pathspecs: ["app/src/x.ts", "src/x.ts"] }));
    expect(sh.cwds[1]).toBe("app");
    expect(sh.scripts).toHaveLength(2);
  });

  it("still names the candidates when the default is not a repository either", async () => {
    const sh = rootOfCheckouts("gone");
    const r = await gitStatusTool.execute({}, sh as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).candidates).toEqual(["app", "api"]);
  });

  it("publish tools use the default checkout", async () => {
    const sh = rootOfCheckouts("app");
    const r = await gitPushTool.execute({}, sh as never);
    expect(data(r).repo).toBe("app");
    expect(sh.cwds[1]).toBe("app");
    expect(sh.scripts[1]!.startsWith("cd ")).toBe(false);
  });

  it("a commit in the default checkout resolves workspace-root paths inside it", async () => {
    const sh = rootOfCheckouts("app");
    await gitCommitTool.execute({ message: "fix", paths: ["app/src/x.ts"], branch: "ticket/1-fix" }, sh as never);
    const scoped = sh.scripts[1]!;
    expect(sh.cwds[1]).toBe("app");
    expect(scoped.startsWith("cd ")).toBe(false);
    expect(scoped).toContain("'src/x.ts'");
  });
});

describe("a root known not to be a checkout (the verdict is cached per shell)", () => {
  it("with a default repo, a later call goes to the default directly", async () => {
    const sh = rootOfCheckouts("app");
    await gitStatusTool.execute({}, sh as never);
    const before = sh.scripts.length;
    const r = await gitStatusTool.execute({}, sh as never);
    expect(data(r).repo).toBe("app");
    expect(sh.scripts.slice(before)).toEqual(["git status --short --branch"]);
    expect(sh.cwds.slice(before)).toEqual(["app"]);
  });

  it("publish tools share the verdict", async () => {
    const sh = rootOfCheckouts("app");
    await gitStatusTool.execute({}, sh as never);
    const before = sh.scripts.length;
    await gitPushTool.execute({}, sh as never);
    expect(sh.scripts.slice(before)).toHaveLength(1);
    expect(sh.cwds[before]).toBe("app");
    expect(sh.scripts[before]!.startsWith("cd ")).toBe(false);
  });

  it("without a default repo the root is still tried every time", async () => {
    const sh = rootOfCheckouts();
    await gitStatusTool.execute({}, sh as never);
    const before = sh.scripts.length;
    await gitStatusTool.execute({}, sh as never);
    expect(sh.scripts[before]).toBe("git status --short --branch");
  });
});
