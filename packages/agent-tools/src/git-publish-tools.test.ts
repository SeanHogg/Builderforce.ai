import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitCleanupMergedTool, gitCommitTool, openPullRequestTool } from "./git-publish-tools.js";
import { toBashNullDevice } from "./node-posix-shell.js";
import type { ToolResult } from "./tool.js";

/** Model-supplied paths that must reach the script as LITERAL text, never as shell syntax. */
const HOSTILE_PATHS = ["$(touch pwned)", "`touch pwned2`", "`id`", 'a"b', "it's", "$HOME"];

/** Free text (message / title / body) that must arrive byte-for-byte: substitutions, quotes and a cmd-style `2>nul`. */
const HOSTILE_TEXT = "fix $(touch pwned3) and `touch pwned4` — it's \"quoted\" \\ $HOME; echo x 2>nul";

const hasBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const hasGit = spawnSync("git", ["--version"]).status === 0;

const data = (r: ToolResult) => r.data as { ok?: boolean; error?: string; output?: string };

/** A shell that only records the script it was handed. */
function recordingShell() {
  const scripts: string[] = [];
  return {
    scripts,
    caps: { shell: { async run(command: string) { scripts.push(command); return { ok: true, stdout: "" }; } } },
  };
}

/**
 * A shell that REALLY runs the script in `dir` the way the hosts do: `bash -c <script>`, after the
 * hosts' own `toBashNullDevice` rewrite (clients/vscode processTree.spawnCommand). `prelude` is
 * prepended (a stub `gh`).
 */
function bashShell(dir: string, prelude = "") {
  return {
    caps: {
      shell: {
        async run(command: string) {
          const r = spawnSync("bash", ["-c", toBashNullDevice(`${prelude}${command}`)], { cwd: dir, encoding: "utf8" });
          return { ok: r.status === 0, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`, exitCode: r.status ?? undefined };
        },
      },
    },
  };
}

const git = (dir: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });

/** A temp repository with one commit (`git rev-parse --abbrev-ref HEAD` fails in an empty one). */
function tempRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  expect(git(dir, "init", "-q").status).toBe(0);
  expect(git(dir, "commit", "-q", "--allow-empty", "-m", "init").status).toBe(0);
  return dir;
}

const noPwned = (dir: string) => {
  for (const f of ["pwned", "pwned2", "pwned3", "pwned4"]) expect(existsSync(join(dir, f))).toBe(false);
};

describe("git_commit: a nonexistent model-supplied path", () => {
  it("regression: is spliced into MISSING as its own single-quoted word, never inside double quotes", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["$(touch pwned)", "it's"], allowBaseBranch: true }, sh as never);
    const script = sh.scripts[0]!;
    expect(script).toContain(`MISSING="$MISSING "'$(touch pwned)'`);
    expect(script).toContain(`MISSING="$MISSING "'it'\\''s'`);
    expect(script).not.toContain(`"$MISSING $(touch pwned)"`);
  });

  it.skipIf(!hasBash || !hasGit)("regression: runs no command substitution and names the LITERAL path (bash -c)", async () => {
    const dir = tempRepo("bf-commit-quote-");
    try {
      const out = data(await gitCommitTool.execute({ message: "m", paths: HOSTILE_PATHS, allowBaseBranch: true }, bashShell(dir) as never));
      expect(out.ok).toBe(false);
      expect(out.output).toContain(`MISSING_PATHS: ${HOSTILE_PATHS.join(" ")}`);
      for (const p of HOSTILE_PATHS) expect(out.error).toContain(p);
      noPwned(dir);
      expect(out.output).not.toMatch(/uid=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasBash || !hasGit)("hostile free text reaches git / gh byte-for-byte (bash -c)", () => {
  it("regression: a commit message with substitutions, quotes and 2>nul is committed verbatim", async () => {
    const dir = tempRepo("bf-commit-msg-");
    try {
      writeFileSync(join(dir, "a.ts"), "1");
      const out = data(await gitCommitTool.execute({ message: HOSTILE_TEXT, paths: ["a.ts"], branch: "ticket/x" }, bashShell(dir) as never));
      expect(out.ok).toBe(true);
      expect(git(dir, "log", "-1", "--format=%B").stdout.trim()).toBe(HOSTILE_TEXT);
      noPwned(dir);
      expect(existsSync(join(dir, "nul"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("regression: a pull-request title and body are handed to gh as literal arguments", async () => {
    const root = mkdtempSync(join(tmpdir(), "bf-pr-"));
    const dir = join(root, "work");
    try {
      expect(git(root, "init", "-q", "--bare", "remote.git").status).toBe(0);
      expect(git(root, "init", "-q", "work").status).toBe(0);
      expect(git(dir, "commit", "-q", "--allow-empty", "-m", "init").status).toBe(0);
      expect(git(dir, "remote", "add", "origin", "../remote.git").status).toBe(0);
      expect(git(dir, "checkout", "-q", "-b", "ticket/x").status).toBe(0);
      // A stub `gh` that records its argv, NUL-separated.
      const prelude = "gh() { printf '%s\\0' \"$@\" > gh-args.bin; }\n";
      const title = `T ${HOSTILE_TEXT}`;
      const body = `B ${HOSTILE_TEXT}\nsecond line`;
      const out = data(await openPullRequestTool.execute({ title, body, base: "main", reviewers: ["alice"] }, bashShell(dir, prelude) as never));
      expect(out.ok).toBe(true);
      const argv = readFileSync(join(dir, "gh-args.bin"), "utf8").split("\0").slice(0, -1);
      expect(argv).toEqual(["pr", "create", "--base", "main", "--head", "ticket/x", "--title", title, "--body", body, "--reviewer", "alice"]);
      noPwned(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a supplied branch / base / reviewer that is not a valid name", () => {
  const refused = (r: ToolResult, action: string, field: string) => {
    expect(data(r)).toMatchObject({ ok: false, action });
    expect(data(r).error).toContain(field);
  };

  it("regression: git_commit refuses an invalid branch instead of committing on the current branch", async () => {
    const sh = recordingShell();
    refused(await gitCommitTool.execute({ message: "m", paths: ["a.ts"], branch: "feat/a b", allowBaseBranch: true }, sh as never), "commit", "branch 'feat/a b'");
    refused(await gitCommitTool.execute({ message: "m", paths: ["a.ts"], branch: "--orphan" }, sh as never), "commit", "branch '--orphan'");
    expect(sh.scripts).toEqual([]);
  });

  it("regression: open_pull_request refuses an invalid base or reviewer instead of dropping it", async () => {
    const sh = recordingShell();
    refused(await openPullRequestTool.execute({ title: "t", body: "b", base: "-x" }, sh as never), "pull_request", "base '-x'");
    refused(await openPullRequestTool.execute({ title: "t", body: "b", reviewers: ["alice", "--web"] }, sh as never), "pull_request", "reviewers '--web'");
    expect(sh.scripts).toEqual([]);
  });

  it("regression: git_cleanup_merged refuses an invalid branch or base instead of targeting HEAD / the default", async () => {
    const sh = recordingShell();
    refused(await gitCleanupMergedTool.execute({ branch: "ticket#12" }, sh as never), "cleanup", "branch 'ticket#12'");
    refused(await gitCleanupMergedTool.execute({ baseBranch: "main;rm" }, sh as never), "cleanup", "baseBranch 'main;rm'");
    expect(sh.scripts).toEqual([]);
  });

  it("still runs with valid or absent values", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"], branch: "ticket/1-x" }, sh as never);
    await openPullRequestTool.execute({ title: "t", body: "b", base: "", reviewers: ["org/team-a"] }, sh as never);
    await gitCleanupMergedTool.execute({}, sh as never);
    expect(sh.scripts).toHaveLength(3);
    expect(sh.scripts[1]).toContain('--reviewer "org/team-a"');
  });
});
