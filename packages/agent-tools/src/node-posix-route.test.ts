import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_POSIX_SHELL, findBash, posixRoute, resetBashCache, runRouted } from "./node-posix-shell.js";

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
