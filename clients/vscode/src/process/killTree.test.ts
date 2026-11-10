import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runTree, taskkillPath } from "./killTree";

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return test();
}

describe("runTree / killTree", () => {
  it("on timeout kills the WHOLE tree: the child's own child dies too", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-killtree-"));
    const pidFile = path.join(dir, "grandchild.pid");
    try {
      const script = [
        "const { spawn } = require('node:child_process');",
        "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const r = await runTree(process.execPath, ["-e", script], { cwd: dir, env: process.env, timeoutMs: 2_000, maxBuffer: 1_000_000 });
      expect(r).toMatchObject({ started: true, timedOut: true, exitCode: null });
      const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
      expect(grandchild).toBeGreaterThan(0);
      expect(await until(() => !alive(grandchild), 5_000)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("a normal run: its exit code and output; a missing program is not started", async () => {
    const ok = await runTree(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(3)"], { cwd: os.tmpdir(), env: process.env, timeoutMs: 10_000, maxBuffer: 1_000 });
    expect(ok).toEqual({ started: true, exitCode: 3, stdout: "hi", stderr: "" });
    const missing = await runTree(path.join(os.tmpdir(), "no-such-program-bf"), [], { cwd: os.tmpdir(), env: process.env, timeoutMs: 1_000, maxBuffer: 1_000 });
    expect(missing.started).toBe(false);
  });

  it("taskkill comes from the Windows system folder, never PATH", () => {
    expect(taskkillPath({ SystemRoot: "C:\\Windows" })).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(taskkillPath({})).toBeUndefined();
  });
});
