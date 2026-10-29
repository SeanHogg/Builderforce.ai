import { describe, it, expect } from "vitest";
import {
  buildGitCommand,
  buildListCheckoutsCommand,
  gitCommitTool,
  gitDiffTool,
  gitPushTool,
  gitRedoTool,
  gitStatusTool,
  gitSyncLatestTool,
  gitUndoTool,
  inferRepoFromPath,
} from "./git-tools.js";
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
    // The Container image's execTool runs these exact strings; drift here is a
    // cross-surface behaviour change.
    expect(buildGitCommand("status")).toBe("git status --short --branch");
    expect(buildGitCommand("diff")).toBe("git --no-pager diff");
    expect(buildGitCommand("history", { limit: 5 })).toBe("git --no-pager log --oneline -n 5");
  });

  it("builds the same command for every checkout: the directory is the shell's cwd, never a `cd`", () => {
    expect(buildGitCommand("diff", { path: "src" })).toBe('git --no-pager diff -- "src"');
    for (const action of ["status", "diff", "history", "sync_latest", "undo", "redo"] as const) {
      expect(buildGitCommand(action)).not.toMatch(/\bcd\b/);
    }
  });

  it("refuses a repo that would walk OUT of the workspace", async () => {
    // The directory becomes the shell's working directory: traversal is an escape, not merely a wider scope.
    for (const repo of ["../elsewhere", "a/../../etc", "..", "/etc"]) {
      const sh = mockShell(() => ({ ok: true, exitCode: 0, stdout: "## main" }));
      await gitStatusTool.execute({ repo }, sh as never);
      expect(sh.cwds).not.toContain(repo);
    }
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
    }
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
    expect(sh.scripts[0]).toBe('git --no-pager diff -- "Builderforce.ai/packages/x.ts"');
    expect(sh.scripts[1]).toBe('git --no-pager diff -- "packages/x.ts"');
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
    expect(sh.scripts[0]).toBe('git --no-pager diff -- "Builderforce.ai/foo.ts"');
    expect(sh.cwds).toEqual(["other-project"]);
    expect(data(r).ok).toBe(true);
    expect(data(r).repo).toBe("other-project");
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
    expect(sh.scripts[1]).toBe('git --no-pager diff -- "src/x.ts"');
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
