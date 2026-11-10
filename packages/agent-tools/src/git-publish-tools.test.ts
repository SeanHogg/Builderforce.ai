import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitCommitTool, openPullRequestTool } from "./git-publish-tools.js";
import type { ToolResult } from "./tool.js";

/** Model-supplied paths that must reach the script as LITERAL text, never as shell syntax. */
const HOSTILE_PATHS = ["$(touch pwned)", "`touch pwned2`", "`id`", 'a"b', "it's", "$HOME"];

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

/** A shell that REALLY runs the script with bash, in `dir`. */
function bashShell(dir: string) {
  return {
    caps: {
      shell: {
        async run(command: string) {
          const r = spawnSync("bash", ["-s"], { cwd: dir, input: command, encoding: "utf8" });
          return { ok: r.status === 0, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`, exitCode: r.status ?? undefined };
        },
      },
    },
  };
}

describe("git_commit: a nonexistent model-supplied path", () => {
  it("regression: is spliced into MISSING as its own single-quoted word, never inside double quotes", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["$(touch pwned)", "it's"], allowBaseBranch: true }, sh as never);
    const script = sh.scripts[0]!;
    expect(script).toContain(`MISSING="$MISSING "'$(touch pwned)'`);
    expect(script).toContain(`MISSING="$MISSING "'it'\\''s'`);
    // No line holds the path inside a double-quoted string.
    expect(script).not.toContain(`"$MISSING $(touch pwned)"`);
  });

  it.skipIf(!hasBash || !hasGit)("regression: runs no command substitution and names the LITERAL path (executed with bash)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-commit-quote-"));
    try {
      expect(spawnSync("git", ["init", "-q"], { cwd: dir }).status).toBe(0);
      // A first commit: `git rev-parse --abbrev-ref HEAD` fails in an empty repository.
      expect(spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir }).status).toBe(0);
      const out = data(await gitCommitTool.execute({ message: "m", paths: HOSTILE_PATHS, allowBaseBranch: true }, bashShell(dir) as never));
      expect(out.ok).toBe(false);
      expect(out.output).toContain(`MISSING_PATHS: ${HOSTILE_PATHS.join(" ")}`);
      for (const p of HOSTILE_PATHS) expect(out.error).toContain(p);
      expect(existsSync(join(dir, "pwned"))).toBe(false);
      expect(existsSync(join(dir, "pwned2"))).toBe(false);
      expect(out.output).not.toMatch(/uid=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("option injection through a ref argument", () => {
  it("regression: a branch starting with '-' is not handed to git checkout", async () => {
    const sh = recordingShell();
    await gitCommitTool.execute({ message: "m", paths: ["a.ts"], branch: "--orphan" }, sh as never);
    expect(sh.scripts[0]).not.toContain("--orphan");
    expect(sh.scripts[0]).toContain("ON_BASE_BRANCH");
  });

  it("regression: a reviewer or base starting with '-' is dropped from gh pr create", async () => {
    const sh = recordingShell();
    await openPullRequestTool.execute({ title: "t", body: "b", base: "-x", reviewers: ["--web", "alice"] }, sh as never);
    const script = sh.scripts[0]!;
    expect(script).not.toContain("--web");
    expect(script).not.toContain('BASE="-x"');
    expect(script).toContain('--reviewer "alice"');
  });
});
