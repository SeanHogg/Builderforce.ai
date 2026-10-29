import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => ({ calls: [] as Array<{ command: string; workdir: string }> }));

// Only the process launch is faked: the directory it is handed is what is under test.
vi.mock("../../agents/bash-tools.exec-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/bash-tools.exec-runtime.js")>()),
  runExecProcess: vi.fn(async (opts: { command: string; workdir: string }) => {
    exec.calls.push({ command: opts.command, workdir: opts.workdir });
    return { kill: () => undefined, promise: Promise.resolve({ status: "completed", exitCode: 0, aggregated: "ok" }) };
  }),
}));

import { onPremShell } from "./onprem-prefetch-port.js";

/**
 * The PreFetch executor's shell is the same `ShellCapability` as every other node shell: the
 * working directory arrives as `ShellRunOptions.cwd` and is the process's `workdir` — validated by
 * the ONE `resolveShellCwd`, so a directory outside the root, or one that is not there, runs nothing.
 */
describe("onPremShell — the working directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "prefetch-shell-"));
  mkdirSync(path.join(root, "app"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  beforeEach(() => void (exec.calls.length = 0));

  it("starts a command in the named directory, and one without in the root", async () => {
    const shell = onPremShell(root);
    await shell.run("git status", { cwd: "app" });
    await shell.run("git status");
    expect(exec.calls.map((c) => path.resolve(c.workdir))).toEqual([path.resolve(root, "app"), path.resolve(root)]);
    // The directory is never written into the command.
    expect(exec.calls.every((c) => c.command === "git status")).toBe(true);
  });

  it("refuses a directory outside the root, or one that is not there, without starting anything", async () => {
    const shell = onPremShell(root);
    expect(await shell.run("ls", { cwd: "../elsewhere" })).toMatchObject({ ok: false, error: expect.stringContaining("outside the workspace") });
    expect(await shell.run("ls", { cwd: "nope" })).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    expect(exec.calls).toEqual([]);
  });
});
