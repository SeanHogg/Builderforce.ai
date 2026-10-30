import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_BASH_FOR_POWERSHELL, NO_POSIX_SHELL, findBash, posixRoute, resetBashCache, runRouted } from "./node-posix-shell.js";

/**
 * THE interpreter-routing rule every node shell shares (the on-prem host's and the editor's): on
 * Windows a POSIX script goes to bash, a command the default shell cannot even attempt is retried
 * ONCE under bash, a stopped command is never retried, and a POSIX script with no bash says so.
 * The platform is faked, so the Windows branch is exercised on every machine.
 */
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const CMD_CANNOT_RUN = "'frobnicate' is not recognized as an internal or external command";

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const setPlatform = (value: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { ...realPlatform, value });
};
const onWindows = (): void => setPlatform("win32");
const bashFound = () => findBash({ ProgramFiles: "C:\\Program Files" }, (p) => p === GIT_BASH);
const bashAbsent = () => findBash({}, () => false);

beforeEach(resetBashCache);
afterEach(() => Object.defineProperty(process, "platform", realPlatform));

describe("posixRoute", () => {
  it("sends a POSIX script to bash on Windows, and a plain command to the default shell", () => {
    onWindows();
    bashFound();
    expect(posixRoute("set -e\ngit status")).toEqual({ bash: GIT_BASH });
    expect(posixRoute("npm test")).toEqual({ bash: null });
  });

  it("refuses a POSIX script when the Windows machine has no bash, naming the cause", () => {
    onWindows();
    bashAbsent();
    expect(posixRoute("git log | head -5")).toEqual({ error: NO_POSIX_SHELL });
    expect(posixRoute("npm test")).toEqual({ bash: null });
  });

  it("routes nothing off Windows — the default shell is already POSIX", () => {
    setPlatform("linux");
    expect(posixRoute("set -e\ngit status")).toEqual({ bash: null });
  });
});

describe("runRouted", () => {
  const result = (over: Record<string, unknown>) => ({ ok: false as boolean, stdout: "", ...over });

  it("runs a POSIX script once, under bash", async () => {
    onWindows();
    bashFound();
    const exec = vi.fn(async (_bash: string | null) => result({ ok: true }));
    await runRouted("set -e\nls", exec);
    expect(exec.mock.calls).toEqual([[GIT_BASH]]);
  });

  it("retries once under bash when the default shell could not even attempt the command", async () => {
    onWindows();
    bashFound();
    const exec = vi.fn(async (bash: string | null) => (bash ? result({ ok: true, stdout: "ran" }) : result({ stdout: CMD_CANNOT_RUN })));
    expect(await runRouted("frobnicate", exec)).toMatchObject({ ok: true, stdout: "ran" });
    expect(exec.mock.calls).toEqual([[null], [GIT_BASH]]);
  });

  it("does not run a genuinely failing program twice", async () => {
    onWindows();
    bashFound();
    const exec = vi.fn(async () => result({ stdout: "1 test failed" }));
    await runRouted("npm test", exec);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("never restarts a stopped command under another interpreter", async () => {
    onWindows();
    bashFound();
    const exec = vi.fn(async () => result({ aborted: true, stdout: CMD_CANNOT_RUN }));
    await runRouted("frobnicate", exec);
    expect(exec).toHaveBeenCalledTimes(1);
    const stop = new AbortController();
    stop.abort();
    const exec2 = vi.fn(async () => result({ stdout: CMD_CANNOT_RUN }));
    await runRouted("frobnicate", exec2, stop.signal);
    expect(exec2).toHaveBeenCalledTimes(1);
  });

  it("does not run a POSIX script at all when there is no bash, and says why", async () => {
    onWindows();
    bashAbsent();
    const exec = vi.fn(async () => result({ ok: true }));
    expect(await runRouted("set -e\nls", exec)).toEqual({ ok: false, error: NO_POSIX_SHELL });
    expect(exec).not.toHaveBeenCalled();
  });
});

/**
 * Off Windows the rule is a STRICT no-op: the default shell is already POSIX, so a host without
 * /bin/bash (Alpine, NixOS) must not have `grep` refused, and a failing command must never be run
 * again - a retry repeats its side effects.
 */
describe("off Windows — nothing is routed and nothing is re-run", () => {
  it("does not refuse a unix utility when there is no bash", async () => {
    setPlatform("linux");
    bashAbsent();
    expect(posixRoute("grep -r foo . | head -5")).toEqual({ bash: null });
    const exec = vi.fn(async (_bash: string | null) => ({ ok: true, stdout: "x" }));
    expect(await runRouted("grep -r foo . | head -5", exec)).toMatchObject({ ok: true });
    expect(exec.mock.calls).toEqual([[null]]);
  });

  it("never reruns a failing command, even when its output looks like a cmd.exe complaint", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      setPlatform(platform);
      bashFound();
      const exec = vi.fn(async (_bash: string | null) => ({ ok: false, stdout: "Environment variable -e not defined" }));
      await runRouted("make deploy", exec);
      expect(exec).toHaveBeenCalledTimes(1);
    }
  });
});

describe("the retry signature", () => {
  it("fires for cmd.exe reading `set -e`, and not for a program that ran and printed a similar line", async () => {
    onWindows();
    bashFound();
    const reran = vi.fn(async (bash: string | null) => (bash ? { ok: true, stdout: "" } : { ok: false, stdout: "Environment variable -e not defined" }));
    await runRouted("frobnicate", reran);
    expect(reran).toHaveBeenCalledTimes(2);
    const real = vi.fn(async () => ({ ok: false, stdout: "Environment variable DATABASE_URL not defined" }));
    await runRouted("frobnicate", real);
    expect(real).toHaveBeenCalledTimes(1);
  });

});

/** The on-prem host's choice: bash for EVERY command whenever one exists. */
describe("defaultInterpreter: bash (the on-prem host)", () => {
  const bashDefault = { defaultInterpreter: "bash" as const };

  it("routes a plain chain to bash when bash exists, and runs it once", async () => {
    onWindows();
    bashFound();
    expect(posixRoute("npm run build && npm test", bashDefault)).toEqual({ bash: GIT_BASH });
    const exec = vi.fn(async (_bash: string | null) => ({ ok: false, stdout: "1 test failed" }));
    await runRouted("npm run build && npm test", exec, undefined, bashDefault);
    expect(exec.mock.calls).toEqual([[GIT_BASH]]);
  });

  it("falls back to the platform shell when there is no bash, refusing only a script that needs POSIX", () => {
    onWindows();
    bashAbsent();
    expect(posixRoute("npm test", bashDefault)).toEqual({ bash: null });
    expect(posixRoute("set -e\nls", bashDefault)).toEqual({ error: NO_BASH_FOR_POWERSHELL });
  });

  // No bash: the default shell is Windows PowerShell 5.1, so what it can run is judged by PowerShell's
  // rules, not cmd.exe's (which the editor's default uses).
  it("with no bash, lets PowerShell run what it aliases, and answers a && chain with the install-Git guidance", () => {
    onWindows();
    bashAbsent();
    // What PowerShell runs correctly: aliased verbs with plain arguments, $(…) subexpressions, quoted text.
    for (const ok of ["ls src", "cat package.json", "rm build/old.txt", "mv a.txt b.txt", "pwd", 'echo "a && b"', "rm -Recurse -Force build", "ls -Force src", "echo hello", "curl https://example.com", "git rev-parse $(git branch --show-current)", "npm run build --if-present=true"]) {
      expect(posixRoute(ok, bashDefault), ok).toEqual({ bash: null });
    }
    // What it cannot: chains, unix flags on an alias (bound by prefix or not at all), diff (Compare-Object compares
    // argument strings - it runs and answers wrong), POSIX redirects / substitution / input / env prefixes, unix utilities.
    for (const needsBash of [
      "npm run build && npm test", "a || b", "git log | head -5", "grep -r foo .",
      "ls -la src", "rm -rf build", "rm -f a.txt", "cat -n f.ts", "cp -r a b", "git status | rm -rf x",
      "diff a.txt b.txt", "find . -name '*.ts'", "curl -s https://example.com", "wget -q https://example.com/x", "kill -9 123", "echo -n hi", "npm test 2>/dev/null", "echo `date`", "sort < in.txt", "NODE_ENV=test npm run build",
    ]) {
      expect(posixRoute(needsBash, bashDefault), needsBash).toEqual({ error: NO_BASH_FOR_POWERSHELL });
    }
    // The guidance tells the model what to do next: where it is, and the native equivalents.
    expect(NO_BASH_FOR_POWERSHELL).toContain("Windows PowerShell 5.1");
    expect(NO_BASH_FOR_POWERSHELL).toMatch(/Remove-Item -Recurse -Force.*Get-ChildItem -Force/);
    // The editor's cmd.exe default is judged by cmd's rules, as before.
    expect(posixRoute("ls -la src")).toEqual({ error: NO_POSIX_SHELL });
  });

  it("leaves the editor's default alone: per-command routing, a plain command stays in the platform shell", () => {
    onWindows();
    bashFound();
    expect(posixRoute("npm run build && npm test")).toEqual({ bash: null });
  });

  it("does nothing off Windows", () => {
    setPlatform("linux");
    bashFound();
    expect(posixRoute("npm test", bashDefault)).toEqual({ bash: null });
  });
});
