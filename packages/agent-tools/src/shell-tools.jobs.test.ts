import { describe, expect, it, vi } from "vitest";
import type { ShellCapability, ShellJobStatus } from "./capabilities.js";
import { runCommandTool } from "./core-tools.js";
import { commandStatusTool, commandStopTool } from "./shell-tools.js";
import type { ToolContext } from "./tool.js";

const prose = "word ".repeat(2_000);

/** A shell whose jobs answer `status`; `compress` (C8) is on when `compressor` is given. */
function ctxWith(status: ShellJobStatus, compressor?: (text: string) => string): ToolContext {
  const shell = {
    run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "done" })),
    start: vi.fn(async () => ({ ok: true, id: "job-1" })),
    poll: vi.fn(async () => status),
    kill: vi.fn(async () => status),
  } as unknown as ShellCapability;
  return {
    caps: {
      capabilities: new Set(["shell", "shell.jobs"]),
      shell,
      ...(compressor ? { semantic: { compress: async (text: string) => ({ ok: true, text: compressor(text), originalTokens: 2000, keptTokens: 1000 }) } } : {}),
    },
    ...(compressor ? { compressLargeOutputs: true } : {}),
  } as never;
}

describe("run_command yieldMs — a job the sandbox no longer knows", () => {
  it("names the job id in the reply, so the model can poll or stop it", async () => {
    const ctx = ctxWith({ ok: false, id: "job-1", status: "unknown", error: "no background job \"job-1\" in this run" });
    const r = await runCommandTool.execute({ command: "npm test", yieldMs: 1000 }, ctx);
    expect(r.data).toMatchObject({ ok: false, id: "job-1", error: expect.stringContaining("no background job") });
  });

  it("a job that exited normally carries no extra id", async () => {
    const r = await runCommandTool.execute({ command: "npm test", yieldMs: 1000 }, ctxWith({ ok: true, id: "job-1", status: "exited", exitCode: 0, output: "fine" }));
    expect(r.data).not.toHaveProperty("id");
  });
});

describe("command_status / command_stop — a finished job's output is compressed like a foreground command's", () => {
  const exited: ShellJobStatus = { ok: true, id: "job-1", status: "exited", exitCode: 0, output: prose };
  const half = (text: string) => text.slice(0, text.length / 2);

  it("compresses a successful job's output when the host turned C8 on", async () => {
    const status = await commandStatusTool.execute({ id: "job-1" }, ctxWith(exited, half));
    expect(String(status.data.output).length).toBeLessThan(prose.length);
    expect(status.data).toMatchObject({ id: "job-1", status: "exited", exitCode: 0 });
    const stop = await commandStopTool.execute({ id: "job-1" }, ctxWith(exited, half));
    expect(String(stop.data.output).length).toBeLessThan(prose.length);
  });

  it("leaves it verbatim without C8, for a failing job, and for a job still running", async () => {
    expect((await commandStatusTool.execute({ id: "job-1" }, ctxWith(exited))).data.output).toBe(prose);
    const failed: ShellJobStatus = { ok: false, id: "job-1", status: "exited", exitCode: 1, output: prose };
    expect((await commandStatusTool.execute({ id: "job-1" }, ctxWith(failed, half))).data.output).toBe(prose);
    const running: ShellJobStatus = { ok: true, id: "job-1", status: "running", output: prose };
    expect((await commandStatusTool.execute({ id: "job-1" }, ctxWith(running, half))).data.output).toBe(prose);
  });
});
