import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findBash } from "./node-posix-shell.js";
import { isSearchCommand, searchNoMatch, withPipefail } from "./shell-command-shape.js";

describe("withPipefail", () => {
  it("runs a bash-routed pipeline under pipefail", () => {
    expect(withPipefail("pnpm install | cat", "/bin/bash", "win32")).toBe("set -o pipefail\npnpm install | cat");
  });

  it("probes a POSIX sh for the option before setting it (old dash would exit on a bad set)", () => {
    expect(withPipefail("a | b", null, "linux")).toBe("(set -o pipefail) 2>/dev/null && set -o pipefail\na | b");
  });

  it("leaves cmd.exe, pipe-less commands, `set -e` scripts, `||` and early-closing stages alone", () => {
    expect(withPipefail("dir | findstr x", null, "win32")).toBe("dir | findstr x");
    expect(withPipefail("npm test", "/bin/bash", "linux")).toBe("npm test");
    expect(withPipefail("a || b", "/bin/bash", "linux")).toBe("a || b");
    expect(withPipefail("echo 'a | b'", "/bin/bash", "linux")).toBe("echo 'a | b'");
    const script = 'set -e\nBASE="$(git remote show origin 2>/dev/null | sed -n p)"';
    expect(withPipefail(script, "/bin/bash", "linux")).toBe(script);
    expect(withPipefail("git log | head -5", "/bin/bash", "linux")).toBe("git log | head -5");
    expect(withPipefail("ps | grep -q node", "/bin/bash", "linux")).toBe("ps | grep -q node");
  });

  it("regression: a failing stage before a pipe exits non-zero (chat #60338: `pnpm install … | tail` reported exit 0)", () => {
    const bash = process.platform === "win32" ? findBash() : "/bin/sh";
    if (!bash) return; // no POSIX shell on this machine: nothing routes here
    const command = 'node -e "process.exit(3)" | cat';
    const plain = spawnSync(bash, ["-c", command]);
    const guarded = spawnSync(bash, ["-c", withPipefail(command, process.platform === "win32" ? bash : null, process.platform)]);
    expect(plain.status).toBe(0);
    // A /bin/sh without pipefail (old dash) keeps the old behaviour rather than breaking.
    const shHasPipefail = spawnSync(bash, ["-c", "set -o pipefail"]).status === 0;
    expect(guarded.status).toBe(shHasPipefail ? 3 : 0);
  });
});

describe("withPipefail — a search before the last stage", () => {
  it("leaves a pipeline alone when a search feeds a later stage (no match = exit 1 = a count of 0, not a failure)", () => {
    expect(withPipefail("grep -rn foo src | wc -l", "/bin/bash", "linux")).toBe("grep -rn foo src | wc -l");
    expect(withPipefail("grep foo f | sort | uniq", "/bin/bash", "linux")).toBe("grep foo f | sort | uniq");
    expect(withPipefail("cd api && rg foo | wc -l", "/bin/bash", "linux")).toBe("cd api && rg foo | wc -l");
    expect(withPipefail("git grep -n foo | sort", "/bin/bash", "linux")).toBe("git grep -n foo | sort");
  });

  it("still guards a pipeline whose search is LAST (searchNoMatch rescues its exit 1)", () => {
    expect(withPipefail("git log | grep fix", "/bin/bash", "linux")).toBe("set -o pipefail\ngit log | grep fix");
  });

  it("regression: `grep … | wc -l` with no match exits 0 once routed", () => {
    const bash = process.platform === "win32" ? findBash() : "/bin/sh";
    if (!bash) return;
    for (const command of ['printf "a\\n" | grep zzz | wc -l', 'printf "a\\n" | grep zzz | sort | uniq']) {
      const run = spawnSync(bash, ["-c", withPipefail(command, process.platform === "win32" ? bash : null, process.platform)]);
      expect(run.status).toBe(0);
    }
  });
});

describe("searchNoMatch", () => {
  it("a search that exits 1 with no output found nothing: ok, matches 0", () => {
    for (const c of ["grep -rn TODO src", "rg foo", "findstr /s foo *.ts", "git grep -n foo", "git log | grep fix", "Select-String foo x.txt"]) {
      expect(isSearchCommand(c)).toBe(true);
      const r = searchNoMatch(c, { ok: false, exitCode: 1, stdout: "(no output)" });
      expect(r).toMatchObject({ ok: true, matches: 0 });
      expect(r.exitCode).toBeUndefined();
    }
  });

  it("anything else is unchanged: output on exit 1, exit 2, a chain, a non-search", () => {
    const failed = { ok: false, exitCode: 1, stdout: "" };
    expect(searchNoMatch("grep foo missing.txt", { ok: false, exitCode: 1, stdout: "grep: missing.txt: No such file" }).ok).toBe(false);
    expect(searchNoMatch("grep -E '(' f", { ok: false, exitCode: 2, stdout: "" }).ok).toBe(false);
    expect(searchNoMatch("cd x && grep foo", failed)).toBe(failed);
    expect(searchNoMatch("npm test", failed)).toBe(failed);
    expect(searchNoMatch("grep foo", { ok: false, aborted: true, exitCode: 1 }).ok).toBe(false);
  });
});
