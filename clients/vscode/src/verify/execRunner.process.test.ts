/** The verifier's process runner against REAL processes: exit codes, the timeout tree-kill, and output volume. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { DID_NOT_FINISH, execRunner } from "./execRunner";

const node = process.execPath;
const dir = mkdtempSync(path.join(tmpdir(), "exec-runner-"));
// Windows holds a directory a just-killed process used as its cwd for a moment: retry, then let the OS temp sweep it.
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* still locked: a temp dir, left for the OS */
  }
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe("execRunner (real processes)", () => {
  it("passes the real exit code through", async () => {
    expect(await execRunner([node, "-e", "process.exit(0)"], { cwd: dir })).toEqual({ exitCode: 0 });
    expect(await execRunner([node, "-e", "process.exit(3)"], { cwd: dir })).toEqual({ exitCode: 3 });
  });

  it("a program that cannot start is non-zero, never a pass", async () => {
    const r = await execRunner(["definitely-not-a-program-xyz"], { cwd: dir });
    expect(r.exitCode).not.toBe(0);
  });

  it("regression: large output (far over the old 1 MB maxBuffer) does not flip a passing run to fail", async () => {
    const script = "process.stdout.write('x'.repeat(8*1024*1024)); process.stderr.write('y'.repeat(2*1024*1024)); process.exitCode = 0;";
    expect(await execRunner([node, "-e", script], { cwd: dir, timeout: 60_000 })).toEqual({ exitCode: 0 });
  });

  it("regression: a timeout is 124 and kills the WHOLE tree (the grandchild too)", async () => {
    const pidFile = path.join(dir, "grandchild.pid");
    const parent = [
      "const cp=require('child_process');",
      "const c=cp.spawn(process.execPath,['-e','setTimeout(()=>{},120000)'],{stdio:'ignore'});",
      `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));`,
      "setTimeout(()=>{},120000);",
    ].join("");
    const started = Date.now();
    const r = await execRunner([node, "-e", parent], { cwd: dir, timeout: 2_000 });
    expect(r.exitCode).toBe(DID_NOT_FINISH);
    expect(Date.now() - started).toBeLessThan(15_000);
    if (!existsSync(pidFile)) return; // the parent never got to spawn (a very slow machine): nothing to assert
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    expect(await until(() => !alive(grandchild), 10_000)).toBe(true);
  }, 30_000);
});
