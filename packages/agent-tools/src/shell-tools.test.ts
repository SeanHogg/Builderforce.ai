import { describe, expect, it, vi } from "vitest";
import type { ShellCapability, ShellJobStatus } from "./capabilities.js";
import { runCommandTool } from "./core-tools.js";
import { commandStatusTool, commandStopTool, cwdArg } from "./shell-tools.js";
import type { ToolContext } from "./tool.js";

function ctxWith(shell: Partial<ShellCapability> & Pick<ShellCapability, "run">, signal?: AbortSignal): ToolContext & { caps: { shell: ShellCapability } } {
  return {
    caps: { capabilities: new Set(["shell", "shell.jobs"]), shell: shell as ShellCapability },
    ...(signal ? { signal } : {}),
  } as never;
}

const okRun = () => vi.fn(async (_command: string, _opts?: { signal?: AbortSignal; cwd?: string }) => ({ ok: true, exitCode: 0, stdout: "done" }));

describe("run_command — where it runs (PRD 35 E3)", () => {
  it("runs in the run's default checkout and says so", async () => {
    const run = okRun();
    const r = await runCommandTool.execute({ command: "npm test" }, ctxWith({ run, defaultRepo: "app" }));
    // The directory is the shell's working directory (an option), never a `cd` in the command.
    expect(run).toHaveBeenCalledWith("npm test", { cwd: "app" });
    expect(r.data.cwd).toBe("app");
  });

  it("an explicit cwd wins, and '.' means the workspace root", async () => {
    const run = okRun();
    await runCommandTool.execute({ command: "npm test", cwd: "api/" }, ctxWith({ run, defaultRepo: "app" }));
    await runCommandTool.execute({ command: "ls", cwd: "." }, ctxWith({ run, defaultRepo: "app" }));
    expect(run.mock.calls).toEqual([["npm test", { cwd: "api" }], ["ls"]]);
  });

  it("refuses a cwd outside the workspace without running anything", async () => {
    const run = okRun();
    for (const cwd of ["../x", "/etc", "C:\\Windows", "a;rm -rf /"]) {
      const r = await runCommandTool.execute({ command: "ls", cwd }, ctxWith({ run }));
      expect(r.data.ok).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a command that enters a directory itself alone", async () => {
    const run = okRun();
    await runCommandTool.execute({ command: "cd api && npm test" }, ctxWith({ run, defaultRepo: "app" }));
    expect(run).toHaveBeenCalledWith("cd api && npm test");
  });

  it("is unchanged with no default and no cwd", async () => {
    const run = okRun();
    await runCommandTool.execute({ command: "npm test" }, ctxWith({ run }));
    expect(run).toHaveBeenCalledWith("npm test");
  });

  it("hands a multi-line script to the shell untouched, with the directory as its cwd", async () => {
    const run = okRun();
    await runCommandTool.execute({ command: "set -e\nnpm test", cwd: "app" }, ctxWith({ run }));
    expect(run).toHaveBeenCalledWith("set -e\nnpm test", { cwd: "app" });
  });

  it("starts a background job in the directory too", async () => {
    const start = vi.fn(async (_command: string, _opts?: { cwd?: string }) => ({ ok: true, id: "j1" }));
    await runCommandTool.execute({ command: "npm run dev", cwd: "app", background: true }, ctxWith({ run: okRun(), start, poll: vi.fn() }));
    expect(start).toHaveBeenCalledWith("npm run dev", { cwd: "app" });
  });

  it("reads the cwd argument", () => {
    expect(cwdArg(undefined)).toBeUndefined();
    expect(cwdArg("./app")).toBe("app");
    expect(cwdArg("..")).toBeNull();
  });
});

describe("run_command — Stop reaches the shell (PRD 35 E10)", () => {
  it("hands the call's signal to the shell", async () => {
    const run = okRun();
    const ac = new AbortController();
    await runCommandTool.execute({ command: "npm test" }, ctxWith({ run }, ac.signal));
    expect(run.mock.calls[0]![1]?.signal).toBe(ac.signal);
  });
});

describe("run_command — background jobs (PRD 35 E6)", () => {
  const jobShell = (status: ShellJobStatus) => ({
    run: okRun(),
    start: vi.fn(async () => ({ ok: true, id: "job-1" })),
    poll: vi.fn(async () => status),
    kill: vi.fn(async () => ({ ...status, status: "killed" as const, ok: false })),
  });

  it("background:true returns a job id at once", async () => {
    const shell = jobShell({ ok: true, id: "job-1", status: "running" });
    const r = await runCommandTool.execute({ command: "npm run dev", background: true }, ctxWith(shell));
    expect(r.data).toMatchObject({ ok: true, background: true, id: "job-1", status: "running" });
    expect(shell.poll).not.toHaveBeenCalled();
    expect(shell.run).not.toHaveBeenCalled();
  });

  it("yieldMs hands back a still-running job, or the finished result", async () => {
    const running = jobShell({ ok: true, id: "job-1", status: "running", output: "compiling" });
    const r1 = await runCommandTool.execute({ command: "npm test", yieldMs: 2000 }, ctxWith(running));
    expect(running.poll).toHaveBeenCalledWith("job-1", { waitMs: 2000 });
    expect(r1.data).toMatchObject({ background: true, id: "job-1", status: "running", output: "compiling" });

    const finished = jobShell({ ok: true, id: "job-1", status: "exited", exitCode: 0, output: "12 passed" });
    const r2 = await runCommandTool.execute({ command: "npm test", yieldMs: 2000 }, ctxWith(finished));
    expect(r2.data).toMatchObject({ ok: true, exitCode: 0, stdout: "12 passed" });
  });

  it("runs in the foreground, with a note, where the shell has no background jobs", async () => {
    const run = okRun();
    const r = await runCommandTool.execute({ command: "npm test", background: true }, ctxWith({ run }));
    expect(run).toHaveBeenCalledWith("npm test");
    expect(String(r.data.note)).toMatch(/foreground/);
  });

  it("command_status polls and command_stop kills", async () => {
    const shell = jobShell({ ok: true, id: "job-1", status: "running" });
    const status = await commandStatusTool.execute({ id: "job-1", waitMs: 500 }, ctxWith(shell));
    expect(shell.poll).toHaveBeenCalledWith("job-1", { waitMs: 500 });
    expect(status.data.status).toBe("running");
    const stopped = await commandStopTool.execute({ id: "job-1" }, ctxWith(shell));
    expect(shell.kill).toHaveBeenCalledWith("job-1");
    expect(stopped.data.status).toBe("killed");
    expect((await commandStatusTool.execute({}, ctxWith(shell))).data.ok).toBe(false);
  });
});

describe("run_command / command_status — a wait a steer may cut short (PRD 35 E10)", () => {
  const jobShell = (status: ShellJobStatus) => ({
    run: okRun(),
    start: vi.fn(async (_c: string, _o?: { signal?: AbortSignal }) => ({ ok: true, id: "job-1" })),
    poll: vi.fn(async (_id: string, _o?: { waitMs?: number; signal?: AbortSignal }) => status),
    kill: vi.fn(async () => ({ ...status, status: "killed" as const, ok: false })),
  });

  it("the call's signal bounds the yieldMs WAIT, never the job's lifetime", async () => {
    const shell = jobShell({ ok: true, id: "job-1", status: "running" });
    const ac = new AbortController();
    await runCommandTool.execute({ command: "npm test", yieldMs: 5000 }, ctxWith(shell, ac.signal));
    expect(shell.start.mock.calls[0]![1]).toBeUndefined();
    expect(shell.poll).toHaveBeenCalledWith("job-1", { waitMs: 5000, signal: ac.signal });
  });

  it("an interrupted yieldMs wait hands back the still-running job and says why", async () => {
    const ac = new AbortController();
    const shell = jobShell({ ok: true, id: "job-1", status: "running", output: "half" });
    shell.poll.mockImplementation(async () => {
      ac.abort();
      return { ok: true, id: "job-1", status: "running", output: "half" };
    });
    const r = await runCommandTool.execute({ command: "npm test", yieldMs: 5000 }, ctxWith(shell, ac.signal));
    expect(r.data).toMatchObject({ ok: true, background: true, id: "job-1", status: "running", output: "half" });
    expect(String(r.data.note)).toMatch(/interrupted/);
    expect(shell.kill).not.toHaveBeenCalled();
  });

  it("starts no job once the call is already stopped", async () => {
    const shell = jobShell({ ok: true, id: "job-1", status: "running" });
    const ac = new AbortController();
    ac.abort();
    const r = await runCommandTool.execute({ command: "npm run dev", background: true }, ctxWith(shell, ac.signal));
    expect(r.data).toMatchObject({ ok: false, aborted: true });
    expect(shell.start).not.toHaveBeenCalled();
  });

  it("command_status hands its signal to the wait", async () => {
    const shell = jobShell({ ok: true, id: "job-1", status: "running" });
    const ac = new AbortController();
    await commandStatusTool.execute({ id: "job-1", waitMs: 60_000 }, ctxWith(shell, ac.signal));
    expect(shell.poll).toHaveBeenCalledWith("job-1", { waitMs: 60_000, signal: ac.signal });
  });
});
