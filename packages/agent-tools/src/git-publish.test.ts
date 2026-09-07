import { describe, it, expect } from "vitest";
import { buildCoreToolRegistry } from "./core-tools.js";
import { gitCommitTool, gitPushTool, openPullRequestTool } from "./git-tools.js";
import type { Capability } from "./capabilities.js";
import type { ToolResult } from "./tool.js";

/**
 * Publishing from a LOCAL surface: commit → push → pull request.
 *
 * The behaviour under test is not "does it run git" but "what can it NOT do": the tools
 * exist because an agent asked to "commit and push to main" had no verb for it, found
 * `run_command`, and shelled `git add -A && git commit && git push` — every file in a
 * shared working tree, unreviewed, onto the base branch. Each assertion below pins one
 * of the three things that went wrong there.
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

describe("git_commit", () => {
  it("refuses without explicit paths — never commits the whole working tree", async () => {
    // `git add -A` in a tree shared with a human sweeps their in-flight work into the
    // agent's commit. An agent that cannot say what it changed must not commit.
    for (const paths of [undefined, [], ["  "]]) {
      const r = await gitCommitTool.execute({ message: "m", paths }, recordingShell() as never);
      expect(data(r).ok).toBe(false);
      expect(data(r).error).toMatch(/paths is required/);
    }
  });

  it("stages ONLY the named paths", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "fix", paths: ["src/a.ts", "src/b.ts"] }, sh as never);
    // Each path is resolved through `pick` first (see commitPathCandidates) and then
    // staged from its own variable — so the assertion is that BOTH named paths, and
    // nothing else, reach `git add`.
    expect(sh.scripts[0]).toContain("P0=\"$(pick 'src/a.ts')\"");
    expect(sh.scripts[0]).toContain("P1=\"$(pick 'src/b.ts')\"");
    expect(sh.scripts[0]).toContain('git add -- "$P0" "$P1"');
    expect(sh.scripts[0]).not.toContain("git add -A");
    expect(sh.scripts[0]).not.toContain("git add .");
  });

  it("guards the base branch when no ticket branch is named", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"] }, sh as never);
    expect(sh.scripts[0]).toContain("ON_BASE_BRANCH");
  });

  it("commits ON the base branch only when the caller declared allowBaseBranch", async () => {
    // "commit and push to main" had no reachable path: push took `allowBaseBranch`, but
    // the commit before it could never land on main, so an explicit human instruction
    // ended in a refusal every time. The declaration is the same act push already has —
    // and it is what the surface's approval prompt names.
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"], allowBaseBranch: true }, sh as never);
    expect(sh.scripts[0]).not.toContain("ON_BASE_BRANCH");
    expect(sh.scripts[0]).toContain("P0=\"$(pick 'a.ts')\"");
    // A named ticket branch still wins over the declaration: it says where to commit.
    const withBranch = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"], allowBaseBranch: true, branch: "ticket/1-x" }, withBranch as never);
    expect(withBranch.scripts[0]).toContain('git checkout -b "ticket/1-x"');
  });

  it("names the declared route when refused on the base branch", async () => {
    const r = await gitCommitTool.execute({ message: "m", paths: ["a.ts"] }, failingShell(5, "ON_BASE_BRANCH") as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).error).toMatch(/open_pull_request/);
    expect(data(r).error).toMatch(/allowBaseBranch:true/);
  });

  it("switches to (or creates) the named ticket branch instead", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"], branch: "ticket/2394-mobile" }, sh as never);
    expect(sh.scripts[0]).toContain('git checkout -b "ticket/2394-mobile"');
  });

  it("quotes a commit message containing quotes and shell metacharacters", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "it's $(rm -rf /) `x` \"q\"", paths: ["a.ts"] }, sh as never);
    // Single-quoted with the embedded quote escaped — nothing can break out and run.
    expect(sh.scripts[0]).toContain(`git commit -m 'it'\\''s $(rm -rf /) \`x\` "q"'`);
  });

  it("reports NOTHING_STAGED as a fact, not a broken tool", async () => {
    const r = await gitCommitTool.execute({ message: "m", paths: ["a.ts"] }, failingShell(6, "NOTHING_STAGED") as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).error).toMatch(/do not report a commit that did not happen/);
  });
});

describe("git_push", () => {
  it("refuses the base branch by default and names the review route", async () => {
    const sh = recordingShell();
    await gitPushTool.execute({}, sh as never);
    expect(sh.scripts[0]).toContain("ON_BASE_BRANCH");

    const r = await gitPushTool.execute({}, failingShell(5, "ON_BASE_BRANCH") as never);
    expect(data(r).ok).toBe(false);
    expect(data(r).error).toMatch(/open_pull_request/);
    expect(data(r).error).toMatch(/allowBaseBranch:true/);
  });

  it("drops the guard ONLY when the caller declared allowBaseBranch", async () => {
    const sh = recordingShell();
    await gitPushTool.execute({ allowBaseBranch: true }, sh as never);
    expect(sh.scripts[0]).not.toContain("ON_BASE_BRANCH");
  });

  it("sets the upstream so a new ticket branch pushes on the first try", async () => {
    const sh = recordingShell();
    await gitPushTool.execute({}, sh as never);
    expect(sh.scripts[0]).toContain('git push -u origin "$CUR"');
  });
});

describe("open_pull_request", () => {
  it("pushes the branch first when it has no upstream", async () => {
    const sh = recordingShell();
    await openPullRequestTool.execute({ title: "t", body: "b" }, sh as never);
    expect(sh.scripts[0]).toContain('git rev-parse --abbrev-ref "@{upstream}"');
    expect(sh.scripts[0]).toContain("gh pr create");
  });

  it("never opens a pull request from the base branch onto itself", async () => {
    const sh = recordingShell();
    await openPullRequestTool.execute({ title: "t", body: "b" }, sh as never);
    expect(sh.scripts[0]).toContain("ON_BASE_BRANCH");
  });

  it("passes through requested reviewers, rejecting unsafe ones", async () => {
    const sh = recordingShell();
    await openPullRequestTool.execute({ title: "t", body: "b", reviewers: ["octocat", "org/team", "bad; rm -rf /"] }, sh as never);
    expect(sh.scripts[0]).toContain('--reviewer "octocat"');
    expect(sh.scripts[0]).toContain('--reviewer "org/team"');
    expect(sh.scripts[0]).not.toContain("rm -rf");
  });

  it("says the branch is safe when gh is missing, rather than losing the work", async () => {
    const r = await openPullRequestTool.execute({ title: "t", body: "b" }, failingShell(7, "NO_GH_CLI") as never);
    expect(data(r).error).toMatch(/committed and pushed/);
  });
});

describe("surface gating", () => {
  const registry = buildCoreToolRegistry();
  const names = (caps: Capability[]) => registry.toolsForCapabilities(new Set(caps)).map((t) => t.name);
  const PUBLISH = ["git_commit", "git_push", "open_pull_request"];

  it("is gated on git.write, NOT shell", () => {
    // The container derives its schema from its capabilities and has no handler for
    // these — advertising them there would 400 mid-run. It already publishes by a
    // different mechanism, so `shell` alone must not unlock them.
    const shellOnly = names(["shell"]);
    for (const t of PUBLISH) expect(shellOnly).not.toContain(t);

    const withGitWrite = names(["shell", "git.write"]);
    for (const t of PUBLISH) expect(withGitWrite).toContain(t);
  });

  it("leaves the read-only git tools on shell, where every surface already has them", () => {
    const shellOnly = names(["shell"]);
    for (const t of ["git_status", "git_diff", "git_history", "git_sync_latest", "git_undo", "git_redo"]) {
      expect(shellOnly).toContain(t);
    }
  });
});
