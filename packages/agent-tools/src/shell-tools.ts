/**
 * `run_command`'s execution, and its two BACKGROUND-job companions.
 *
 * Split from `core-tools.ts` (the catalog) because this is one subsystem:
 *   - WHERE a command runs: an explicit `cwd`, else the run's default checkout
 *     (`ShellCapability.defaultRepo`), else the workspace root;
 *   - Stop reaching the process: the call's `signal` goes to the shell, which kills it;
 *   - a long command that must not block the run: `background` starts a job and returns
 *     its id at once; `yieldMs` runs in the foreground up to that long, then hands the
 *     still-running job back. `command_status` polls a job, `command_stop` kills it.
 * A shell without `start` runs everything in the foreground and says so.
 */

import { defineTool, type ToolContext, type ToolDefinition, type ToolResult } from "./tool.js";
import { safeRepoArg, shellRunWithStop } from "./git-repo-scope.js";
import { compressShellResult } from "./compress.js";
import type { ShellJobStatus, ShellResult } from "./capabilities.js";

/** The longest a `yieldMs` / `waitMs` may hold the call (the foreground ceiling). */
const SHELL_WAIT_MAX_MS = 10 * 60 * 1000;

/** A wait argument clamped to [0, SHELL_WAIT_MAX_MS]; undefined when absent/invalid. */
function waitArg(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), SHELL_WAIT_MAX_MS) : undefined;
}

/**
 * The `cwd` argument: `undefined` = not given, `"."` = the workspace root on purpose,
 * `null` = refused (absolute, `..`, or a shell metacharacter), else the directory.
 */
export function cwdArg(v: unknown): string | null | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const dir = v.trim().split("\\").join("/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (dir === "" || dir === ".") return ".";
  return safeRepoArg(dir);
}

/** Where a command runs: the explicit `cwd`, else the default checkout — unless the
 *  command already enters a directory itself (`cd X && …`), which the model chose. */
function commandDir(command: string, cwd: string | undefined, defaultRepo: string | undefined): string | undefined {
  if (cwd) return cwd === "." ? undefined : cwd;
  if (/^\s*(cd|pushd)\s/i.test(command)) return undefined;
  return safeRepoArg(defaultRepo) ?? undefined;
}

const jobNote = (id: string): string =>
  `Running in the background (job ${id}). Keep working; check it with command_status { "id": "${id}" } (pass waitMs to wait for it), stop it with command_stop { "id": "${id}" }.`;

/** A finished job, shaped like a foreground result so the model reads one shape. */
function finishedJob(st: ShellJobStatus): ShellResult {
  return {
    ok: st.status === "exited" && st.exitCode === 0,
    ...(st.exitCode !== undefined ? { exitCode: st.exitCode } : {}),
    stdout: st.output ?? "",
    ...(st.status === "killed" ? { aborted: true, error: st.error ?? "the job was stopped" } : st.error ? { error: st.error } : {}),
  };
}

/** `run_command`'s body. */
export async function runShellCommand(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command.trim()) return { data: { ok: false, error: "command is required" } };
  const cwd = cwdArg(args.cwd);
  if (cwd === null) {
    return { data: { ok: false, error: "`cwd` must be a directory inside the workspace, relative to its root (no `..`, no absolute path)." } };
  }
  const shell = ctx.caps.shell!;
  // The directory is handed to the shell as its working directory, never written into the
  // command: `cd X && cmd` is not one language (Windows PowerShell 5.1 cannot parse `&&`).
  const dir = commandDir(command, cwd, shell.defaultRepo);
  const where = dir ? { cwd: dir } : {};
  const background = args.background === true;
  const yieldMs = waitArg(args.yieldMs);
  let note: string | undefined;

  if (background || yieldMs !== undefined) {
    if (shell.start && shell.poll) {
      if (ctx.signal?.aborted) return { data: { ok: false, aborted: true, error: "stopped before the command started", ...where } };
      // The job is the RUN's (the surface kills it when the run settles), so the call's
      // signal is NOT its lifetime: it only bounds the yieldMs wait below.
      const started = await (dir ? shell.start(command, { cwd: dir }) : shell.start(command));
      if (!started.ok || !started.id) return { data: { ok: false, error: started.error ?? "the background job did not start", ...where } };
      const id = started.id;
      if (background) return { data: { ok: true, background: true, id, status: "running", note: jobNote(id), ...where } };
      const st = await shell.poll(id, { waitMs: yieldMs, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (st.status === "running") {
        const why = ctx.signal?.aborted ? "The wait was interrupted" : `Still running after ${yieldMs}ms`;
        return { data: { ok: true, background: true, id, status: "running", output: st.output ?? "", note: `${why}, so it moved to the background. ${jobNote(id)}`, ...where } };
      }
      const r = await compressShellResult(finishedJob(st), ctx);
      return { data: { ...(r as unknown as Record<string, unknown>), ...where } };
    }
    note = "This surface has no background shell, so the command ran in the foreground.";
  }

  const r = await compressShellResult(await shellRunWithStop(ctx, command, dir), ctx);
  return { data: { ...(r as unknown as Record<string, unknown>), ...where, ...(note ? { note } : {}) } };
}

function jobId(args: Record<string, unknown>): string {
  return typeof args.id === "string" ? args.id.trim() : "";
}

export const commandStatusTool: ToolDefinition = defineTool({
  name: "command_status",
  description:
    "Check a BACKGROUND command started by run_command (background:true, or one that outlived its yieldMs): whether it is still running, its exit code, and the tail of its output. Pass waitMs to wait up to that long for it to finish first. Use this instead of re-running a long command.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The job id run_command returned." },
      waitMs: { type: "number", description: "Optional: wait up to this many milliseconds for the job to finish before answering (max 600000)." },
    },
    required: ["id"],
  },
  requires: ["shell.jobs"],
  async execute(args, ctx): Promise<ToolResult> {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const poll = ctx.caps.shell?.poll;
    if (!poll) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const waitMs = waitArg(args.waitMs);
    // The call's signal ends the WAIT (a steer, Stop), never the job.
    const st = await poll.call(ctx.caps.shell, id, { ...(waitMs !== undefined ? { waitMs } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
    return { data: st as unknown as Record<string, unknown> };
  },
});

export const commandStopTool: ToolDefinition = defineTool({
  name: "command_stop",
  description: "Stop a BACKGROUND command started by run_command — it and every process it started are killed. Returns its final output tail.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "The job id run_command returned." } },
    required: ["id"],
  },
  requires: ["shell.jobs"],
  async execute(args, ctx): Promise<ToolResult> {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const kill = ctx.caps.shell?.kill;
    if (!kill) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const st = await kill.call(ctx.caps.shell, id);
    return { data: st as unknown as Record<string, unknown> };
  },
});

/** The background-job tools, spliced into `CORE_TOOLS` right after `run_command`. */
export const SHELL_JOB_TOOLS: readonly ToolDefinition[] = [commandStatusTool, commandStopTool];
