import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNodeShell } from "./nodeShell.js";

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
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

async function expectGone(pid: number): Promise<void> {
  for (let i = 0; i < 40 && alive(pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(alive(pid)).toBe(false);
}

describe("buildNodeShell", () => {
  it("returns the combined output and the exit code", async () => {
    const shell = buildNodeShell({ cwd: dir });
    const ok = await shell.run(`node -e "console.log('hi')"`);
    expect(ok).toMatchObject({ ok: true, exitCode: 0 });
    expect(ok.stdout).toContain("hi");
    const failed = await shell.run(`node -e "process.exit(3)"`);
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
