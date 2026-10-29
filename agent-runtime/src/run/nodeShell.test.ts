import { existsSync, readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNodeShell, shellInvocation } from "./nodeShell.js";

/**
 * PRD 35 §3.3: Stop settles the run in ≤2 s with no child process left. The command here
 * writes its own pid and then idles for a minute; the test proves the shell kills the tree
 * (not just the shell wrapper) on abort and on the foreground ceiling.
 */

let dir: string;
let idler: string;
let pidFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "node-shell-"));
  pidFile = path.join(dir, "pid");
  idler = path.join(dir, "idle.js");
  await writeFile(idler, `require("node:fs").writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);`);
  // Scripts, not `node -e "…"`: nested quotes are the one thing the platform shells disagree on.
  await writeFile(path.join(dir, "hello.js"), `console.log("hi");`);
  await writeFile(path.join(dir, "exit3.js"), `process.exit(3);`);
  await writeFile(path.join(dir, "where.js"), `console.log(process.cwd());`);
  await mkdir(path.join(dir, "sub"));
});

afterEach(async () => {
  // The idler's cwd is `dir`; on Windows a directory with a live process in it cannot be removed
  // (EBUSY), and under parallel load the tree can still be dying when the test body returns. So the
  // process is confirmed dead FIRST (killed here if the test did not already), then the removal retries.
  await ensureDead(recordedPid());
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** The pid the idler wrote, or undefined when it never started. */
function recordedPid(): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, "utf8"));
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

/** Kill a left-over process and wait until it has actually exited. */
async function ensureDead(pid: number | undefined): Promise<void> {
  if (pid === undefined || !alive(pid)) return;
  try {
    process.kill(pid);
  } catch {
    // Already gone between the check and the kill: that is the outcome wanted.
  }
  await untilGone(pid);
}

const idleCommand = () => `node "${idler}" "${pidFile}"`;

async function waitForPid(): Promise<number> {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the command never started");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until the process has exited (the exit is awaited, never raced), up to a generous bound for a loaded machine. */
async function untilGone(pid: number): Promise<void> {
  for (let i = 0; i < 200 && alive(pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
}

async function expectGone(pid: number): Promise<void> {
  await untilGone(pid);
  expect(alive(pid)).toBe(false);
}

describe("buildNodeShell — the working directory is the shell's, not the command's", () => {
  const where = (cwd?: string) => buildNodeShell({ cwd: dir }).run(`node "${path.join(dir, "where.js")}"`, cwd ? { cwd } : undefined);
  const real = (p: string) => realpathSync(p);

  it("runs in the workspace root by default and in the named directory when given one", async () => {
    expect(real((await where()).stdout?.trim() ?? "")).toBe(real(dir));
    expect(real((await where("sub")).stdout?.trim() ?? "")).toBe(real(path.join(dir, "sub")));
    expect(real((await where(".")).stdout?.trim() ?? "")).toBe(real(dir));
  });

  it("refuses a directory outside the workspace or one that is not there, without running anything", async () => {
    for (const cwd of ["..", path.join("sub", "..", "..")]) {
      expect(await where(cwd)).toMatchObject({ ok: false, error: expect.stringContaining("outside the workspace") });
    }
    expect(await where("missing")).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
  });
});

describe("shellInvocation — interpreter routing", () => {
  it("runs a command routed to bash as `bash -c`, with a cmd-style null device rewritten", () => {
    expect(shellInvocation("git log 2>nul | head -5", "C:\\Program Files\\Git\\bin\\bash.exe")).toEqual({
      shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: ["-c", "git log 2>/dev/null | head -5"],
    });
  });
});

describe("shellInvocation", () => {
  it("hands the shell the command without argv quoting, and keeps the command's own exit code", () => {
    const command = 'echo "a b"';
    const { args } = shellInvocation(command);
    if (process.platform === "win32") {
      const encoded = args[args.indexOf("-EncodedCommand") + 1] ?? "";
      const script = Buffer.from(encoded, "base64").toString("utf16le");
      expect(script).toContain(command);
      expect(script).toContain("exit $LASTEXITCODE");
    } else {
      expect(args.at(-1)).toBe(command);
    }
  });
});

describe("buildNodeShell", () => {
  it("returns the combined output and the exit code", async () => {
    const shell = buildNodeShell({ cwd: dir });
    const ok = await shell.run(`node "${path.join(dir, "hello.js")}"`);
    expect(ok).toMatchObject({ ok: true, exitCode: 0 });
    expect(ok.stdout).toContain("hi");
    const failed = await shell.run(`node "${path.join(dir, "exit3.js")}"`);
    expect(failed).toMatchObject({ ok: false, exitCode: 3 });
  });

  it("kills the command's process and settles within 2 s when the run is stopped", async () => {
    const stop = new AbortController();
    const shell = buildNodeShell({ cwd: dir });
    const running = shell.run(idleCommand(), { signal: stop.signal });
    const pid = await waitForPid();

    const stoppedAt = Date.now();
    stop.abort();
    const result = await running;

    expect(Date.now() - stoppedAt).toBeLessThan(2_000);
    expect(result).toMatchObject({ ok: false, aborted: true });
    await expectGone(pid);
  });

  it("does not start a command for a run that is already stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    const result = await buildNodeShell({ cwd: dir }).run(idleCommand(), { signal: stop.signal });
    expect(result).toMatchObject({ ok: false, aborted: true });
  });

  it("kills a command that outlives the foreground ceiling and reports it as not finished", async () => {
    const shell = buildNodeShell({ cwd: dir, timeoutMs: 600 });
    const running = shell.run(idleCommand());
    const pid = await waitForPid();

    const result = await running;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not finish");
    await expectGone(pid);
  });
});
