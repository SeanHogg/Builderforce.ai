import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childEnv, DETAIL_CAP, runShell, ShellFailure, stripAnsi, tailOf } from "./knowledgeShell";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

const dirs: string[] = [];
const temp = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "kg-shell-")); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const zero = (code: number | null): boolean => code === 0;
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 40; i++) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};

describe("output handling", () => {
  it("keeps only the last 64 KB", () => {
    const big = "x".repeat(70_000);
    expect(tailOf("", big)).toHaveLength(64 * 1024);
    expect(tailOf("head-", "tail")).toBe("head-tail");
    expect(tailOf("a".repeat(64 * 1024), "END").endsWith("END")).toBe(true);
  });

  it("strips colour and cursor codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m \u001b[2K\u001b[1Gdone")).toBe("red done");
  });

  it("drops BUILDERFORCE_* variables from the child environment, case-insensitively, and keeps the rest", () => {
    const env = childEnv({ PATH: "/bin", BUILDERFORCE_TOKEN: "s", builderforce_x: "y", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});

describe("runShell", () => {
  it("reports a command that ran and failed with its exit code and the cleaned tail, capped at 2 KB", async () => {
    const cwd = await temp();
    const script = "process.stdout.write('a'.repeat(200000) + '\\u001b[31mTAIL-MARK\\u001b[0m'); process.exit(4)";
    await writeFile(join(cwd, "noisy.js"), script);
    const err = await runShell("node noisy.js", cwd, { ok: zero, label: "check" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShellFailure);
    const failure = err as ShellFailure;
    expect(failure.kind).toBe("exit");
    expect(failure.code).toBe(4);
    expect(failure.message).toBe("check failed (exit 4).");
    expect(failure.output.length).toBeLessThanOrEqual(DETAIL_CAP);
    expect(failure.output.endsWith("TAIL-MARK")).toBe(true);
  });

  it("kills the whole tree on timeout: a grandchild does not outlive the check", async () => {
    const cwd = await temp();
    await writeFile(join(cwd, "child.js"), "setInterval(() => {}, 1000);");
    await writeFile(join(cwd, "parent.js"), "const c = require('child_process').spawn(process.execPath, ['child.js'], { stdio: 'ignore' }); require('fs').writeFileSync('pid.txt', String(c.pid)); setInterval(() => {}, 1000);");
    const err = await runShell("node parent.js", cwd, { ok: zero, timeoutMs: 1500, label: "check" }).catch((e: unknown) => e);
    expect((err as ShellFailure).kind).toBe("timeout");
    const pid = Number(await readFile(join(cwd, "pid.txt"), "utf8"));
    expect(pid).toBeGreaterThan(0);
    expect(await gone(pid)).toBe(true);
  }, 30_000);

  it("kills the tree when the signal aborts, and refuses to start when already aborted", async () => {
    const cwd = await temp();
    const control = new AbortController();
    const run = runShell("node -e \"setInterval(() => {}, 1000)\"", cwd, { ok: zero, signal: control.signal, label: "check" }).catch((e: unknown) => e);
    setTimeout(() => control.abort(), 300);
    expect(((await run) as ShellFailure).kind).toBe("aborted");
    const again = await runShell("node -e \"0\"", cwd, { ok: zero, signal: control.signal }).catch((e: unknown) => e);
    expect((again as ShellFailure).kind).toBe("aborted");
  }, 30_000);

  it("tells a command that could not start apart from one that failed", async () => {
    const err = await runShell("node -e \"0\"", join(tmpdir(), "kg-does-not-exist-dir"), { ok: zero, label: "check" }).catch((e: unknown) => e);
    expect((err as ShellFailure).kind).toBe("launch");
    expect((err as ShellFailure).message).toMatch(/could not run/);
  });

  it("does not pass BUILDERFORCE_* to the child", async () => {
    const cwd = await temp();
    process.env["BUILDERFORCE_TEST_SECRET"] = "leak";
    try {
      await writeFile(join(cwd, "env.js"), "process.exit(process.env.BUILDERFORCE_TEST_SECRET === undefined ? 0 : 9)");
      await expect(runShell("node env.js", cwd, { ok: zero })).resolves.toBeUndefined();
    } finally {
      delete process.env["BUILDERFORCE_TEST_SECRET"];
    }
  });
});
