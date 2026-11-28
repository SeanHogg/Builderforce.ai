/**
 * The editor shell's BACKGROUND jobs — what `run_command` `background` / `yieldMs`,
 * `command_status` and `command_stop` run on.
 *
 * Module-level on purpose: the tool adapter builds a fresh capability provider per call
 * (`fileTools.ts`), so a job started by one call must still be there for the next.
 *
 * A job belongs to the RUN that started it (its `owner`, the run key): its id is scoped
 * to that run — `job-1` of one run is not `job-1` of another, and `command_status` /
 * `command_stop` from another run is told there is no such job. The host kills a run's
 * jobs when the run settles (finish, fail or Stop — `killRunJobs`) and every job when the
 * extension deactivates (`killAllJobs`), so no run leaves a dev server behind. A job
 * started with a `signal` also dies with it. Output is a bounded tail; a finished job's
 * full output (to {@link EDITOR_COMMAND_BUFFER_CHARS}) is retained for `output_filter` (`localShellOutputs.ts`).
 */

import { BACKGROUND_JOB_LIMIT_ERROR, backgroundWaitAbort, createBackgroundJobRegistry, EDITOR_COMMAND_BUFFER_CHARS, waitForBackgroundJob } from "@builderforce/tool-output-policy";
import type { ChildProcess } from "child_process";
import type { ShellJobStart, ShellJobStatus } from "@builderforce/agent-tools";
import { killTree } from "@builderforce/agent-tools/node-process";
import { spawnCommand } from "./processTree";
import { forgetRunOutputs, retainOutput } from "./localShellOutputs";
import { invalidateRunCache } from "./localShellCache";
import { isSubAgentHandle } from "../child/childRuns";
import { messageOf } from "../shared/messageOf";

/** The run a job belongs to; `undefined` = a caller with no run (a hook, a test). */
export type JobOwner = number | undefined;

interface Job {
  id: string;
  owner: JobOwner;
  child: ChildProcess;
  status: "running" | "exited" | "killed";
  exitCode?: number;
  output: string;
  truncated: boolean;
  /** Everything it printed, up to {@link EDITOR_COMMAND_BUFFER_CHARS}, retained when it finishes. */
  full: string;
  outputId?: string;
  done: Promise<void>;
}

/** Keyed by owner AND id, so a lookup from another run cannot reach the job. */
const jobs = createBackgroundJobRegistry<Job, number>();

export interface StartJobOptions {
  cwd: string;
  /** A POSIX interpreter to run the command under (`bash -c`), or null for the platform shell. */
  bash: string | null;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** The run that owns the job (see the module note). */
  owner?: JobOwner;
  /** Bound on the kept output tail. */
  maxOutput: number;
}

function statusOf(job: Job): ShellJobStatus {
  return {
    ok: job.status !== "killed" && (job.status === "running" || job.exitCode === 0),
    id: job.id,
    status: job.status,
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    output: job.output.trim(),
    ...(job.truncated ? { truncated: true } : {}),
    ...(job.outputId ? { outputId: job.outputId } : {}),
  };
}

const unknownJob = (id: string): ShellJobStatus => ({
  ok: false,
  id,
  status: "unknown",
  // A sub-agent handle (`a14`) polled with command_status meant wait_agents (chat #61651). Jobs are `job-N`.
  error: isSubAgentHandle(id)
    ? `"${id}" is a sub-agent, not a background command — use wait_agents (or message_agent) for it`
    : `no background job "${id}" in this run (it may belong to another run, or to one that has ended)`,
});

export function startJob(command: string, opts: StartJobOptions): ShellJobStart {
  if (opts.signal?.aborted) return { ok: false, error: "the run was stopped" };
  const owner = opts.owner;
  const id = jobs.reserve(owner);
  if (!id) return { ok: false, error: BACKGROUND_JOB_LIMIT_ERROR };
  let child: ChildProcess;
  try {
    child = spawnCommand(command, opts.bash, {
      cwd: opts.cwd,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  let settle!: () => void;
  const job: Job = { id, owner, child, status: "running", output: "", truncated: false, full: "", done: new Promise<void>((r) => { settle = r; }) };
  const append = (chunk: string): void => {
    if (job.full.length < EDITOR_COMMAND_BUFFER_CHARS) job.full += chunk.slice(0, EDITOR_COMMAND_BUFFER_CHARS - job.full.length);
    job.output += chunk;
    if (job.output.length > opts.maxOutput) {
      job.output = job.output.slice(job.output.length - opts.maxOutput);
      job.truncated = true;
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const onAbort = (): void => { void killJob(id, owner); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const finish = (code: number | null): void => {
    if (job.status === "running") job.status = "exited";
    if (typeof code === "number") job.exitCode = code;
    if (owner !== undefined && job.full.trim() && !job.outputId) job.outputId = retainOutput(owner, job.full.trim());
    job.full = "";
    opts.signal?.removeEventListener("abort", onAbort);
    settle();
  };
  child.on("error", (e) => { append(`\n${e.message}`); finish(null); });
  child.on("close", (code) => finish(code));
  jobs.set(id, job, owner);
  return { ok: true, id };
}

/**
 * A job's state, after waiting up to `waitMs` for it to finish. Aborting `signal` ends
 * the WAIT early with the status so far — the job itself runs on.
 */
export async function pollJob(id: string, waitMs = 0, opts: { owner?: JobOwner; signal?: AbortSignal } = {}): Promise<ShellJobStatus> {
  const job = jobs.get(id, opts.owner);
  if (!job) return unknownJob(id);
  if (job.status === "running" && waitMs > 0 && !opts.signal?.aborted) {
    await waitForBackgroundJob(job.done, waitMs, backgroundWaitAbort(opts.signal));
  }
  return statusOf(job);
}

/** Kill a job's process tree and report how it ended (waits briefly for the exit). */
export async function killJob(id: string, owner?: JobOwner): Promise<ShellJobStatus> {
  const job = jobs.get(id, owner);
  if (!job) return unknownJob(id);
  if (job.status === "running") {
    job.status = "killed";
    if (job.child.pid) killTree(job.child.pid);
    await waitForBackgroundJob(job.done, 3_000);
  }
  return { ...statusOf(job), ...(job.status === "killed" ? { error: "stopped" } : {}) };
}

/** Kill every job a run still has running — called when the run settles — and drop the
 *  run's retained outputs and cached results with it. */
export async function killRunJobs(owner: JobOwner): Promise<void> {
  const mine = [...jobs.values()].filter((job) => job.owner === owner && job.status === "running");
  await Promise.all(mine.map((job) => killJob(job.id, owner)));
  forgetRunOutputs(owner);
  invalidateRunCache(owner);
}

/** Kill every running job of every run — the extension is deactivating. */
export async function killAllJobs(): Promise<void> {
  const running = [...jobs.values()].filter((job) => job.status === "running");
  await Promise.all(running.map((job) => killJob(job.id, job.owner)));
}
