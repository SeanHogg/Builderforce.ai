import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findBash } from "./node-posix-shell.js";
import { isSearchCommand, searchNoMatch, shapeTrimmed, stripTrailingTrim, withPipefail } from "./shell-command-shape.js";

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

describe("stripTrailingTrim", () => {
  it("drops a trailing tail / head, with 2>&1, -n N or -N", () => {
    expect(stripTrailingTrim("pnpm install --lockfile-only 2>&1 | tail -20")).toEqual({ command: "pnpm install --lockfile-only", trim: { kind: "tail", lines: 20 } });
    expect(stripTrailingTrim("git log --oneline | head -n 5")).toEqual({ command: "git log --oneline", trim: { kind: "head", lines: 5 } });
    expect(stripTrailingTrim("pnpm type-check | tail -n40")).toEqual({ command: "pnpm type-check", trim: { kind: "tail", lines: 40 } });
  });

  it("keeps the stages that do real work", () => {
    expect(stripTrailingTrim("grep -rn foo src | sort | head -3")).toEqual({ command: "grep -rn foo src | sort", trim: { kind: "head", lines: 3 } });
  });

  it("leaves a quoted trim, an `||` fallback, a bare tail and a non-trailing one alone", () => {
    for (const c of ['bash -c "make | tail -5"', "make || tail -5", "tail -5 log.txt", "git log | head -5 > out.txt", "tail -f app.log"]) {
      expect(stripTrailingTrim(c)).toEqual({ command: c });
    }
  });
});

describe("shapeTrimmed", () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

  it("shows the head and the tail of the real output, and where the rest is", () => {
    const out = shapeTrimmed(lines, { kind: "tail", lines: 20 }, "out-7");
    expect(out.startsWith("line 1\n")).toBe(true);
    expect(out.endsWith("line 200")).toBe(true);
    expect(out).toContain("120 lines omitted");
    expect(out).toContain('"outputId": "out-7"');
  });

  it("keeps at least as many lines as the trim asked for", () => {
    const out = shapeTrimmed(lines, { kind: "tail", lines: 100 });
    expect(out).toContain("line 101\n");
    expect(out).toContain("60 lines omitted");
  });

  it("returns a short output whole", () => {
    expect(shapeTrimmed("a\nb", { kind: "head", lines: 5 })).toBe("a\nb");
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
